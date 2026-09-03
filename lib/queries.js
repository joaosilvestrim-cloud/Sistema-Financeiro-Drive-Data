import 'server-only'
import { q, q1 } from './db'
import { escopo } from './session'

// Consultas do dashboard. Todas escopadas por tenant e, quando há empresa
// selecionada, também por conexão.

export async function kpis(sessao) {
  const { where, params } = escopo(sessao)
  return q1(
    `select
       sum(saldo_atual)     as saldo_atual,
       max(saldo_em)        as saldo_em,
       sum(a_receber)       as a_receber,
       sum(a_pagar)         as a_pagar,
       sum(receber_vencido) as receber_vencido,
       sum(pagar_vencido)   as pagar_vencido,
       sum(receber_30d)     as receber_30d,
       sum(pagar_30d)       as pagar_30d,
       sum(entradas_90d)    as entradas_90d,
       sum(saidas_90d)      as saidas_90d,
       sum(burn_diario)     as burn_diario
     from mart.kpi_overview where ${where}`,
    params,
  )
}

// Doze meses para trás e seis para frente. Realizado até hoje, previsto daqui
// em diante. As duas séries nunca se somam na mesma barra.
export async function fluxoMensal(sessao) {
  const { where, params } = escopo(sessao)
  return q(
    `select
       to_char(dia, 'YYYY-MM')                as competencia,
       sum(coalesce(entradas_realizadas, 0))  as entradas_realizadas,
       sum(coalesce(saidas_realizadas, 0))    as saidas_realizadas,
       sum(coalesce(entradas_previstas, 0))   as entradas_previstas,
       sum(coalesce(saidas_previstas, 0))     as saidas_previstas
     from mart.cashflow_daily
     where ${where}
       and dia >= date_trunc('month', current_date) - interval '11 months'
       and dia <  date_trunc('month', current_date) + interval '7 months'
     group by 1 order by 1`,
    params,
  )
}

export async function aging(sessao, kind = 'receivable') {
  const { where, params } = escopo(sessao)
  return q(
    `select faixa, sum(valor) as valor, sum(titulos) as titulos
       from mart.aging_snapshot
      where ${where} and kind = $${params.length + 1}
      group by 1
      order by array_position(array['a_vencer','d1_30','d31_60','d61_90','d90_mais'], faixa)`,
    [...params, kind],
  )
}

export async function topClientes(sessao, limite = 8) {
  const { where, params } = escopo(sessao)
  return q(
    `select cliente,
            sum(faturado)  as faturado,
            sum(em_aberto) as em_aberto,
            sum(vencido)   as vencido,
            avg(atraso_medio_dias) as atraso_medio_dias
       from mart.customer_metrics
      where ${where}
      group by 1
      having sum(faturado) > 0
      order by 2 desc
      limit $${params.length + 1}`,
    [...params, limite],
  )
}

export async function dreMeses(sessao, meses = 6) {
  const { where, params } = escopo(sessao)
  return q(
    `select competencia, kind,
            coalesce(grupo_dre, 'SEM_GRUPO') as grupo_dre,
            categoria,
            sum(total) as total
       from mart.dre_monthly
      where ${where}
        and mes >= date_trunc('month', current_date) - make_interval(months => $${params.length + 1})
        and mes <= date_trunc('month', current_date)
      group by 1, 2, 3, 4
      order by 1`,
    [...params, meses - 1],
  )
}

export async function recebiveisAbertos(sessao, limite = 60) {
  const { where, params } = escopo(sessao, 'i')
  return q(
    `select i.descricao, i.data_vencimento, i.total, i.nao_pago, i.status_traduzido,
            p.nome as cliente, c.nome as categoria,
            current_date - i.data_vencimento as dias_atraso
       from core.installment i
       left join core.person p   on p.id = i.person_id
       left join core.category c on c.id = i.category_id
      where ${where} and i.kind = 'receivable'
        and coalesce(i.nao_pago, 0) > 0 and i.deleted_at is null
      order by i.data_vencimento asc
      limit $${params.length + 1}`,
    [...params, limite],
  )
}

export async function conexoes(tenantId) {
  return q(
    `select c.*,
            (select count(*) from core.installment i where i.connection_id = c.id) as parcelas,
            (select r.status from core.sync_run r where r.connection_id = c.id
              order by r.started_at desc limit 1) as ultimo_status,
            (select r.items from core.sync_run r where r.connection_id = c.id
              order by r.started_at desc limit 1) as ultimo_itens,
            (select r.error from core.sync_run r where r.connection_id = c.id
              order by r.started_at desc limit 1) as ultimo_erro
       from core.connection c
      where c.tenant_id = $1
      order by c.nome`,
    [tenantId],
  )
}

export async function ultimasRodadas(tenantId, limite = 12) {
  return q(
    `select r.*, c.nome as conexao
       from core.sync_run r
       join core.connection c on c.id = r.connection_id
      where c.tenant_id = $1
      order by r.started_at desc
      limit $2`,
    [tenantId, limite],
  )
}
