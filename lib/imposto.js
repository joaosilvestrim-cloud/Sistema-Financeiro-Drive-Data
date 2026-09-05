import 'server-only'
import { q, q1 } from './db.js'
import { escopo } from './escopo.js'

// Provisão do imposto sobre o faturamento.
//
// A conta é a que a contabilidade faz: o DAS do Simples é pago no mês seguinte
// sobre o faturamento do mês anterior. Então a provisão de hoje sai da receita
// do último mês fechado, cliente por cliente, com a alíquota do anexo de cada
// um.
//
// Três cuidados que mudam o número.
//
// 1. Só entra o que é receita de verdade. Rendimento financeiro e movimento não
//    operacional aparecem como recebível no ERP e não compõem base de cálculo.
//    O filtro reaproveita a mesma classificação da tela de Preço e custo, para
//    as duas telas nunca discordarem sobre o que é receita.
//
// 2. Competência, não caixa. O imposto incide sobre o faturamento do mês, tenha
//    o cliente pago ou não. Usar o recebido daria um número menor e errado.
//
// 3. O mês corrente nunca entra. Ele está pela metade, e provisionar sobre meio
//    mês é subestimar a conta que vai chegar.

// Mês fechado anterior, no formato YYYY-MM.
export function competenciaPadrao(hoje = new Date()) {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function provisao(sessao, competencia = null) {
  const mes = competencia ?? competenciaPadrao()
  const { where, params } = escopo(sessao, 'i')

  const config = await q1(
    `select aliquota_anexo_iii, aliquota_anexo_v, anexo_padrao
       from core.tenant where id = $1`,
    [sessao.tenantId],
  )

  const linhas = await q(
    `select
       i.person_id,
       coalesce(p.nome, 'Sem cadastro')                     as cliente,
       coalesce(r.anexo, $${params.length + 2})             as anexo,
       r.anexo is not null                                  as classificado,
       sum(i.total)                                         as receita,
       count(*)                                             as titulos
     from core.installment i
     left join core.person p on p.id = i.person_id
     left join core.cliente_regime r
       on r.person_id = i.person_id and r.tenant_id = i.tenant_id
     join core.category cat on cat.id = i.category_id
     left join core.category_classe cc
       on cc.category_id = cat.id and cc.tenant_id = i.tenant_id
     where ${where}
       and i.deleted_at is null
       and i.kind = 'receivable'
       -- Só o que é receita operacional. Mesma regra da tela de Preço e custo.
       and coalesce(cc.classe, core.classe_sugerida(cat.tipo, cat.entrada_dre)) = 'receita'
       and to_char(i.data_competencia, 'YYYY-MM') = $${params.length + 1}
     group by 1, 2, 3, 4
     order by 5 desc`,
    [...params, mes, config?.anexo_padrao ?? 'III'],
  )

  const taxa = {
    III: Number(config?.aliquota_anexo_iii ?? 12),
    V: Number(config?.aliquota_anexo_v ?? 15),
  }

  const clientes = linhas.map((l) => {
    const aliquota = taxa[l.anexo] ?? taxa.III
    return {
      ...l,
      receita: Number(l.receita),
      aliquota,
      imposto: Number(l.receita) * (aliquota / 100),
    }
  })

  const porAnexo = ['III', 'V'].map((anexo) => {
    const doAnexo = clientes.filter((c) => c.anexo === anexo)
    return {
      anexo,
      aliquota: taxa[anexo],
      clientes: doAnexo.length,
      receita: doAnexo.reduce((a, c) => a + c.receita, 0),
      imposto: doAnexo.reduce((a, c) => a + c.imposto, 0),
    }
  }).filter((a) => a.clientes > 0)

  const receita = clientes.reduce((a, c) => a + c.receita, 0)
  const imposto = clientes.reduce((a, c) => a + c.imposto, 0)

  return {
    competencia: mes,
    config: { ...taxa, padrao: config?.anexo_padrao ?? 'III' },
    clientes,
    porAnexo,
    receita,
    imposto,
    // A alíquota média é o que a Tamires vai conferir contra a guia. Não é a
    // média das alíquotas, é imposto sobre receita, que é outra coisa quando os
    // clientes têm pesos diferentes.
    aliquotaMedia: receita > 0 ? (imposto / receita) * 100 : null,
    naoClassificados: clientes.filter((c) => !c.classificado).length,
  }
}

// O que já foi lançado como imposto no ERP, para conferir a provisão contra o
// realizado. Sem isso a tela seria um cálculo solto, sem prova.
export async function impostoLancado(sessao, competencia) {
  const { where, params } = escopo(sessao, 'i')
  return q(
    `select cat.nome as categoria, sum(i.total) as valor, count(*) as titulos
       from core.installment i
       join core.category cat on cat.id = i.category_id
      where ${where} and i.deleted_at is null and i.kind = 'payable'
        and cat.entrada_dre = 'IMPOSTOS_SOBRE_VENDAS'
        and to_char(i.data_competencia, 'YYYY-MM') = $${params.length + 1}
      group by 1
      order by 2 desc`,
    [...params, competencia],
  )
}

export async function classificarCliente(sessao, personId, anexo) {
  if (!['III', 'V'].includes(anexo)) throw new Error(`anexo ${anexo} nao existe`)
  await q(
    `insert into core.cliente_regime (tenant_id, person_id, anexo, definido_por)
     values ($1, $2, $3, $4)
     on conflict (tenant_id, person_id) do update
       set anexo = excluded.anexo, definido_por = excluded.definido_por,
           atualizado_em = now()`,
    [sessao.tenantId, personId, anexo, sessao.user?.id ?? null],
  )
}

export async function salvarAliquotas(sessao, { iii, v, padrao }) {
  const numero = (x, atual) => {
    const n = Number(String(x).replace(',', '.'))
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : atual
  }
  const atual = await q1(
    `select aliquota_anexo_iii, aliquota_anexo_v, anexo_padrao from core.tenant where id = $1`,
    [sessao.tenantId],
  )
  await q(
    `update core.tenant
        set aliquota_anexo_iii = $2, aliquota_anexo_v = $3, anexo_padrao = $4
      where id = $1`,
    [
      sessao.tenantId,
      numero(iii, atual.aliquota_anexo_iii),
      numero(v, atual.aliquota_anexo_v),
      ['III', 'V'].includes(padrao) ? padrao : atual.anexo_padrao,
    ],
  )
}

// Últimos meses fechados, para o seletor da tela.
export async function competenciasDisponiveis(sessao, quantos = 12) {
  const { where, params } = escopo(sessao, 'i')
  const linhas = await q(
    `select distinct to_char(i.data_competencia, 'YYYY-MM') as competencia
       from core.installment i
      where ${where} and i.deleted_at is null and i.kind = 'receivable'
        and i.data_competencia < date_trunc('month', current_date)
      order by 1 desc
      limit $${params.length + 1}`,
    [...params, quantos],
  )
  return linhas.map((l) => l.competencia)
}
