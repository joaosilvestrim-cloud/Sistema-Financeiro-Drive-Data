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

// ------------------------------------------------------------ Fase 3

export async function prazosMedios(sessao) {
  const { where, params } = escopo(sessao)
  return q(
    `select kind,
            round(sum(valor * prazo_medio_dias) / nullif(sum(valor), 0), 1)  as prazo,
            round(sum(valor * atraso_medio_dias) / nullif(sum(valor), 0), 1) as atraso,
            sum(valor) as valor
       from mart.prazos_mensais
      where ${where} and mes >= date_trunc('month', current_date) - interval '12 months'
      group by 1`,
    params,
  )
}

export async function prazosPorMes(sessao) {
  const { where, params } = escopo(sessao)
  return q(
    `select to_char(mes, 'YYYY-MM') as competencia, kind,
            round(sum(valor * prazo_medio_dias) / nullif(sum(valor), 0), 1) as prazo
       from mart.prazos_mensais
      where ${where} and mes >= date_trunc('month', current_date) - interval '12 months'
      group by 1, 2 order by 1`,
    params,
  )
}

export async function sazonalidade(sessao, kind = 'receivable') {
  const { where, params } = escopo(sessao)
  return q(
    `select mes_do_ano, round(avg(indice), 2) as indice, max(anos) as anos, avg(media_do_mes) as media
       from mart.indice_sazonal
      where ${where} and kind = $${params.length + 1}
      group by 1 order by 1`,
    [...params, kind],
  )
}

export async function concentracao(sessao, limite = 10) {
  const { where, params } = escopo(sessao)
  return q(
    `select cliente, sum(faturado) as faturado,
            round(sum(faturado) / nullif(sum(sum(faturado)) over (), 0), 4) as participacao
       from mart.concentracao_clientes
      where ${where}
      group by 1 order by 2 desc limit $${params.length + 1}`,
    [...params, limite],
  )
}

export async function indiceHhi(sessao) {
  const { where, params } = escopo(sessao)
  // Recalcula sobre o escopo escolhido. Somar o HHI de duas empresas daria um
  // número sem significado, já que a base de cada uma é diferente.
  return q1(
    `with base as (
       select cliente, sum(faturado) as faturado
         from mart.customer_metrics where ${where} and faturado > 0 group by 1
     ), total as (select sum(faturado) as t from base)
     select round(sum(power(b.faturado / nullif(t.t, 0), 2))::numeric, 4) as hhi,
            count(*) as clientes
       from base b cross join total t`,
    params,
  )
}

export async function anomalias(sessao, corte = 3.5, limite = 12) {
  const { where, params } = escopo(sessao)
  return q(
    `select categoria, kind, to_char(mes, 'YYYY-MM') as competencia,
            valor, mediana, escore
       from mart.anomalias
      where ${where}
        and escore is not null
        and abs(escore) >= $${params.length + 1}
        and mes >= date_trunc('month', current_date) - interval '6 months'
        -- So mes fechado. O mes corrente esta pela metade e o futuro so tem o
        -- que ja foi lancado, entao os dois apareceriam como queda gigante
        -- contra a mediana e encheriam a tela de alarme falso.
        and mes < date_trunc('month', current_date)
      order by abs(escore) desc
      limit $${params.length + 2}`,
    [...params, corte, limite],
  )
}
