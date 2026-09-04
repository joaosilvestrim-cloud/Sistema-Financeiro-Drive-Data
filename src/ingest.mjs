import { tx, query } from './db.mjs'
import { stableHash } from './crypto.mjs'

// Grava o payload cru. O índice único em (connection_id, resource, external_id,
// hash) faz o de-para: salvar um registro sem mudar nada na Conta Azul gera
// evento no histórico, e aqui isso vira um no-op.
async function saveRaw(client, ctx, resource, externalId, payload, hash) {
  await client.query(
    `insert into raw.api_payload (tenant_id, connection_id, resource, external_id, hash, payload)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (connection_id, resource, external_id, hash) do nothing`,
    [ctx.tenantId, ctx.connectionId, resource, externalId, hash, payload],
  )
}

// Upsert genérico de dimensão. A chave natural é sempre (connection_id, external_id)
// porque os ids da Conta Azul só são únicos dentro de uma empresa.
export async function ingestDimension(ctx, table, colunas, registros) {
  if (!registros.length) return { total: 0 }
  const cols = ['tenant_id', 'connection_id', 'external_id', ...colunas]
  const setList = colunas.map((c) => `${c} = excluded.${c}`).concat('updated_at = now()').join(', ')

  await tx(async (client) => {
    for (const r of registros) {
      const valores = [ctx.tenantId, ctx.connectionId, r.external_id, ...colunas.map((c) => r[c] ?? null)]
      const placeholders = valores.map((_, i) => `$${i + 1}`).join(', ')
      await client.query(
        `insert into core.${table} (${cols.join(', ')}) values (${placeholders})
         on conflict (connection_id, external_id) do update set ${setList}`,
        valores,
      )
      await saveRaw(client, ctx, table, r.external_id, r.raw, stableHash(r.raw))
    }
  })
  return { total: registros.length }
}

// Mapas de id externo para id interno, usados para resolver as chaves das parcelas.
export async function loadDimensionMaps(ctx) {
  const carregar = async (table) => {
    const { rows } = await query(
      `select external_id, id from core.${table} where connection_id = $1`,
      [ctx.connectionId],
    )
    return new Map(rows.map((r) => [r.external_id, r.id]))
  }
  const [person, account, category, costCenter] = await Promise.all([
    carregar('person'), carregar('account'), carregar('category'), carregar('cost_center'),
  ])
  return { person, account, category, costCenter }
}

const CAMPOS_VERSAO = ['data_vencimento', 'data_competencia', 'status', 'total', 'pago', 'nao_pago']

// Campos que definem se a parcela mudou de verdade, já no formato em que ficam
// gravados.
//
// O hash sai daqui e não do payload cru por dois motivos, ambos descobertos com
// dado real:
//
// 1. A mesma parcela chega com formatos diferentes conforme o endpoint. A busca
//    traz um conjunto de campos, o detalhe traz outro. Hash sobre o payload
//    abriria versão nova a cada troca de caminho, sem mudança de negócio.
// 2. O detalhe não traz o cliente. Um campo ausente não é um campo que mudou.
//    Por isso o que entra no hash é o estado resultante, com o valor novo
//    quando existe e o valor guardado quando não veio, exatamente como o upsert
//    faz. Assim o hash sempre descreve a linha que está no banco.
//
// Sem isso, o histórico versionado, que é o diferencial do produto, encheria de
// versão fantasma e a comparação entre previsto e realizado perderia o sentido.
const CAMPOS_NEGOCIO = [
  'descricao', 'data_vencimento', 'data_competencia', 'status', 'kind',
  'total', 'pago', 'nao_pago',
  'person_id', 'account_id', 'category_id', 'cost_center_id',
]

const naoVeio = (v) => v === null || v === undefined

function estadoResultante(it, maps, atual) {
  const entrada = {
    descricao: it.descricao,
    data_vencimento: it.data_vencimento,
    data_competencia: it.data_competencia,
    status: it.status,
    kind: it.kind,
    total: it.total,
    pago: it.pago,
    nao_pago: it.nao_pago,
    person_id: maps.person.get(it.person_external_id) ?? null,
    account_id: maps.account.get(it.account_external_id) ?? null,
    category_id: maps.category.get(it.category_external_id) ?? null,
    cost_center_id: maps.costCenter.get(it.cost_center_external_id) ?? null,
  }
  const estado = {}
  for (const campo of CAMPOS_NEGOCIO) {
    estado[campo] = naoVeio(entrada[campo]) ? (atual?.[campo] ?? null) : entrada[campo]
  }
  // Datas voltam do banco como Date e da API como string. Sem normalizar, o
  // hash mudaria só por causa do tipo.
  for (const campo of ['data_vencimento', 'data_competencia']) {
    const v = estado[campo]
    if (v instanceof Date) estado[campo] = v.toISOString().slice(0, 10)
  }
  for (const campo of ['total', 'pago', 'nao_pago']) {
    if (estado[campo] !== null) estado[campo] = Number(estado[campo])
  }
  return estado
}

// Grava parcelas com versionamento SCD tipo 2.
// Quando o conteúdo muda, a versão vigente é fechada e uma nova é aberta. É
// desse histórico que sai a comparação entre o que estava previsto num momento
// passado e o que de fato aconteceu, que o ERP não guarda.
export async function ingestInstallments(ctx, maps, itens) {
  // `mudaram` carrega as parcelas que entraram ou foram alteradas nesta rodada.
  // Baixa nova sempre mexe no valor pago, entao parcela inalterada nao tem baixa
  // nova, e rebuscar as dela e chamada jogada fora na cota do cliente.
  const resumo = { novos: 0, alterados: 0, inalterados: 0, mudaram: [] }
  if (!itens.length) return resumo

  await tx(async (client) => {
    for (const it of itens) {
      await saveRaw(client, ctx, 'installment', it.external_id, it.raw, stableHash(it.raw))

      const { rows: existentes } = await client.query(
        `select id, hash, ${CAMPOS_NEGOCIO.join(', ')}
           from core.installment where connection_id = $1 and external_id = $2`,
        [ctx.connectionId, it.external_id],
      )
      const atual = existentes[0]
      const estado = estadoResultante(it, maps, atual)
      const hash = stableHash(estado)

      if (atual && atual.hash === hash) {
        // Sem mudança de negócio, então nenhuma versão nova. Ainda assim vale
        // preencher identificador que só um dos caminhos fornece: a busca não
        // devolve o id do evento e o detalhe devolve. Sem esta linha, o vínculo
        // com o evento nunca chegaria para uma parcela que não muda mais.
        await client.query(
          `update core.installment
              set last_seen_at = now(),
                  event_external_id = coalesce(event_external_id, $2)
            where id = $1`,
          [atual.id, it.event_external_id ?? null],
        )
        resumo.inalterados++
        continue
      }

      const { rows } = await client.query(
        `insert into core.installment (
           tenant_id, connection_id, external_id, event_external_id, status_traduzido,
           data_criacao, data_alteracao, hash,
           ${CAMPOS_NEGOCIO.join(', ')}
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         on conflict (connection_id, external_id) do update set
           event_external_id = coalesce(excluded.event_external_id, core.installment.event_external_id),
           status_traduzido = excluded.status_traduzido,
           data_alteracao = excluded.data_alteracao,
           hash = excluded.hash,
           descricao = excluded.descricao,
           data_vencimento = excluded.data_vencimento,
           data_competencia = excluded.data_competencia,
           status = excluded.status,
           kind = excluded.kind,
           total = excluded.total, pago = excluded.pago, nao_pago = excluded.nao_pago,
           person_id = excluded.person_id,
           account_id = excluded.account_id,
           category_id = excluded.category_id,
           cost_center_id = excluded.cost_center_id,
           last_seen_at = now(),
           deleted_at = null
         returning id`,
        [
          ctx.tenantId, ctx.connectionId, it.external_id, it.event_external_id,
          it.status_traduzido, it.data_criacao, it.data_alteracao, hash,
          ...CAMPOS_NEGOCIO.map((c) => estado[c]),
        ],
      )
      const id = rows[0].id

      await client.query(
        `update core.installment_version set valid_to = now()
          where installment_id = $1 and valid_to is null`,
        [id],
      )
      await client.query(
        `insert into core.installment_version
           (installment_id, tenant_id, connection_id, ${CAMPOS_VERSAO.join(', ')}, hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, ctx.tenantId, ctx.connectionId, ...CAMPOS_VERSAO.map((c) => estado[c] ?? null), hash],
      )

      resumo.mudaram.push(it)
      if (atual) resumo.alterados++
      else resumo.novos++
    }
  })
  return resumo
}

export async function ingestSettlements(ctx, maps, baixas) {
  if (!baixas.length) return { total: 0 }
  await tx(async (client) => {
    for (const b of baixas) {
      const hash = stableHash(b.raw)
      await saveRaw(client, ctx, 'settlement', b.external_id, b.raw, hash)
      await client.query(
        `insert into core.settlement (
           tenant_id, connection_id, external_id, installment_id,
           data_pagamento, valor, valor_bruto, taxa, juros, desconto, account_id,
           reconciliacao_external_id, hash
         )
         select $1, $2, $3, i.id, $5, $6, $7, $8, $9, $10, $11, $12, $13
           from core.installment i
          where i.connection_id = $2 and i.external_id = $4
         on conflict (connection_id, external_id) do update set
           data_pagamento = excluded.data_pagamento,
           valor = excluded.valor, valor_bruto = excluded.valor_bruto, taxa = excluded.taxa,
           juros = excluded.juros, desconto = excluded.desconto,
           account_id = coalesce(excluded.account_id, core.settlement.account_id),
           -- Sem coalesce de propósito. Conciliação pode ser desfeita no ERP, e
           -- guardar o valor antigo faria a tela dizer que está conciliado o que
           -- voltou a estar pendente.
           reconciliacao_external_id = excluded.reconciliacao_external_id,
           hash = excluded.hash, last_seen_at = now()`,
        [
          ctx.tenantId, ctx.connectionId, b.external_id, b.installment_external_id,
          b.data_pagamento, b.valor, b.valor_bruto, b.taxa, b.juros, b.desconto,
          maps.account.get(b.account_external_id) ?? null,
          b.reconciliacao_external_id ?? null, hash,
        ],
      )
    }
  })
  return { total: baixas.length }
}

export async function snapshotBalances(ctx, saldos) {
  if (!saldos.length) return { total: 0 }
  await tx(async (client) => {
    for (const s of saldos) {
      await client.query(
        `insert into core.account_balance_snapshot
           (tenant_id, connection_id, account_id, snapshot_date, saldo)
         values ($1, $2, $3, current_date, $4)
         on conflict (account_id, snapshot_date) do update
           set saldo = excluded.saldo, captured_at = now()`,
        [ctx.tenantId, ctx.connectionId, s.account_id, s.saldo],
      )
    }
  })
  return { total: saldos.length }
}

export async function getWatermark(connectionId, resource) {
  const { rows } = await query(
    'select value from core.sync_watermark where connection_id = $1 and resource = $2',
    [connectionId, resource],
  )
  return rows[0]?.value ?? null
}

export async function setWatermark(connectionId, resource, value) {
  await query(
    `insert into core.sync_watermark (connection_id, resource, value)
     values ($1, $2, $3)
     on conflict (connection_id, resource) do update set value = excluded.value, updated_at = now()`,
    [connectionId, resource, value],
  )
}
