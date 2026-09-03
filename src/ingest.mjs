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

// Grava parcelas com versionamento SCD tipo 2.
// Quando o conteúdo muda, a versão vigente é fechada e uma nova é aberta. É
// desse histórico que sai a comparação entre o que estava previsto num momento
// passado e o que de fato aconteceu, que o ERP não guarda.
export async function ingestInstallments(ctx, maps, itens) {
  const resumo = { novos: 0, alterados: 0, inalterados: 0 }
  if (!itens.length) return resumo

  await tx(async (client) => {
    for (const it of itens) {
      const hash = stableHash(it.raw)
      await saveRaw(client, ctx, 'installment', it.external_id, it.raw, hash)

      const { rows: existentes } = await client.query(
        `select id, hash from core.installment where connection_id = $1 and external_id = $2`,
        [ctx.connectionId, it.external_id],
      )
      const atual = existentes[0]

      if (atual && atual.hash === hash) {
        await client.query('update core.installment set last_seen_at = now() where id = $1', [atual.id])
        resumo.inalterados++
        continue
      }

      const { rows } = await client.query(
        `insert into core.installment (
           tenant_id, connection_id, external_id, event_external_id, kind, descricao,
           data_vencimento, data_competencia, status, status_traduzido,
           total, pago, nao_pago, person_id, account_id, category_id, cost_center_id,
           data_criacao, data_alteracao, hash
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         on conflict (connection_id, external_id) do update set
           event_external_id = coalesce(excluded.event_external_id, core.installment.event_external_id),
           kind = coalesce(excluded.kind, core.installment.kind),
           descricao = excluded.descricao,
           data_vencimento = excluded.data_vencimento,
           data_competencia = excluded.data_competencia,
           status = excluded.status,
           status_traduzido = excluded.status_traduzido,
           total = excluded.total, pago = excluded.pago, nao_pago = excluded.nao_pago,
           person_id = coalesce(excluded.person_id, core.installment.person_id),
           account_id = coalesce(excluded.account_id, core.installment.account_id),
           category_id = coalesce(excluded.category_id, core.installment.category_id),
           cost_center_id = coalesce(excluded.cost_center_id, core.installment.cost_center_id),
           data_alteracao = excluded.data_alteracao,
           hash = excluded.hash,
           last_seen_at = now(),
           deleted_at = null
         returning id`,
        [
          ctx.tenantId, ctx.connectionId, it.external_id, it.event_external_id, it.kind, it.descricao,
          it.data_vencimento, it.data_competencia, it.status, it.status_traduzido,
          it.total, it.pago, it.nao_pago,
          maps.person.get(it.person_external_id) ?? null,
          maps.account.get(it.account_external_id) ?? null,
          maps.category.get(it.category_external_id) ?? null,
          maps.costCenter.get(it.cost_center_external_id) ?? null,
          it.data_criacao, it.data_alteracao, hash,
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
        [id, ctx.tenantId, ctx.connectionId, ...CAMPOS_VERSAO.map((c) => it[c] ?? null), hash],
      )

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
           data_pagamento, valor, juros, desconto, account_id, hash
         )
         select $1, $2, $3, i.id, $5, $6, $7, $8, $9, $10
           from core.installment i
          where i.connection_id = $2 and i.external_id = $4
         on conflict (connection_id, external_id) do update set
           data_pagamento = excluded.data_pagamento,
           valor = excluded.valor, juros = excluded.juros, desconto = excluded.desconto,
           account_id = coalesce(excluded.account_id, core.settlement.account_id),
           hash = excluded.hash, last_seen_at = now()`,
        [
          ctx.tenantId, ctx.connectionId, b.external_id, b.installment_external_id,
          b.data_pagamento, b.valor, b.juros, b.desconto,
          maps.account.get(b.account_external_id) ?? null, hash,
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
