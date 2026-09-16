import 'server-only'
import { q, q1 } from './db.js'
import { escopo } from './escopo.js'

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
      order by array_position(array['a_vencer','a_vencer_longe','d1_30','d31_60','d61_90','d90_mais'], faixa)`,
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
            avg(atraso_medio_dias)   as atraso_medio_dias,
            sum(titulos_pagos)       as titulos_pagos,
            sum(pagos_com_atraso)    as pagos_com_atraso,
            max(atraso_maximo_dias)  as atraso_maximo_dias
       from mart.customer_metrics
      where ${where}
      group by 1
      having sum(faturado) > 0
      order by 2 desc
      limit $${params.length + 1}`,
    [...params, limite],
  )
}


export async function recebiveisAbertos(sessao, limite = 60) {
  const { where, params } = escopo(sessao, 'i')
  return q(
    `select i.id as installment_id,
            i.descricao, i.data_vencimento, i.total, i.nao_pago, i.status_traduzido,
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

// A série mensal dos prazos, para a tela mostrar tendência e não só a foto.
// Média ponderada pelo valor: um mês com um título de R$ 100 não pode pesar
// o mesmo que um mês com R$ 100 mil.
export async function prazosSerie(sessao, meses = 18) {
  const { where, params } = escopo(sessao)
  return q(
    `select to_char(mes, 'YYYY-MM') as competencia,
            round((sum(prazo_medio_dias * valor) filter (where kind = 'receivable')
              / nullif(sum(valor) filter (where kind = 'receivable'), 0))::numeric, 1) as receber,
            round((sum(prazo_medio_dias * valor) filter (where kind = 'payable')
              / nullif(sum(valor) filter (where kind = 'payable'), 0))::numeric, 1) as pagar
       from mart.prazos_mensais
      where ${where} and mes >= date_trunc('month', current_date) - make_interval(months => ${Number(meses)})
      group by 1 order by 1`,
    params,
  )
}

// Pontualidade mês a mês: dos títulos liquidados naquele mês, quantos foram
// pagos até 3 dias depois do vencimento. A mesma tolerância do farol de
// clientes, porque compensação bancária e fim de semana não são atraso.
export async function pontualidadeMensal(sessao, meses = 18) {
  const { where, params } = escopo(sessao, 'i')
  return q(
    `with pagos as (
       select date_trunc('month', b.ultima) as mes,
              (b.ultima <= i.data_vencimento + 3)::int as no_prazo
         from (select installment_id, max(data_pagamento) as ultima
                 from core.settlement group by 1) b
         join core.installment i on i.id = b.installment_id
        where ${where} and i.deleted_at is null and i.kind = 'receivable'
          and coalesce(i.nao_pago, 0) <= 0.009 and i.data_vencimento is not null
          and b.ultima >= date_trunc('month', current_date) - make_interval(months => ${Number(meses)})
     )
     select to_char(mes, 'YYYY-MM') as competencia,
            count(*)::int as titulos,
            round(avg(no_prazo)::numeric, 3) as taxa
       from pagos
      group by 1
     having count(*) >= 3
      order by 1`,
    params,
  )
}

// Do que venceu, quanto voltou: a taxa de recuperação por idade da dívida,
// vinda da view que a projeção já usa. É a curva que responde "vencido de um
// ano atrás ainda vira dinheiro?".
export async function recuperacaoPorIdade(sessao) {
  const { where, params } = escopo(sessao)
  return q(
    `select faixa, sum(total) as total, sum(recebido) as recebido,
            round(sum(recebido) / nullif(sum(total), 0), 4) as taxa
       from mart.taxa_recuperacao
      where ${where}
      group by 1
      order by array_position(array['d61_90','d91_180','d181_360','d360_mais'], faixa)`,
    params,
  )
}

export async function prazosMedios(sessao) {
  const { where, params } = escopo(sessao)
  return q(
    // Duas casas, e o arredondamento acontece uma vez so na tela. Arredondar
    // aqui para uma casa e de novo na exibicao transformava 9,48 em 10, e o
    // bullet da IA, que le o valor exato, dizia nove enquanto o cartao dizia
    // dez, na mesma tela.
    `select kind,
            round(sum(valor * prazo_medio_dias) / nullif(sum(valor), 0), 2)  as prazo,
            round(sum(valor * atraso_medio_dias) / nullif(sum(valor), 0), 2) as atraso,
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

// Saldo atual de cada conta financeira.
//
// O distinct on pega a foto mais recente de cada conta, e nao a foto mais
// recente do banco inteiro. A diferenca aparece quando uma empresa sincroniza
// depois da outra: com um max() global as contas da empresa atrasada some da
// lista, e a tela mostraria caixa a menos.
export async function saldosPorConta(sessao) {
  const { where, params } = escopo(sessao, 'b')
  return q(
    `select * from (
       select distinct on (b.account_id)
              a.nome, a.tipo, b.saldo, b.snapshot_date
         from core.account_balance_snapshot b
         join core.account a on a.id = b.account_id
        where ${where}
        order by b.account_id, b.snapshot_date desc
     ) s
     order by s.saldo desc`,
    params,
  )
}

// Os lançamentos por trás de um desvio, para abrir dentro da linha.
//
// A tela diz "Serviços de terceiros estourou em julho". A pergunta seguinte é
// sempre qual nota fez isso, e ela costuma ser uma só. As chaves vêm da própria
// lista de desvios e o recorte repete o da view mart.anomalias, categoria nula
// virando "Sem categoria" e competência caindo para o vencimento, para que a
// soma do detalhe feche com o valor da linha.
export async function lancamentosDosDesvios(sessao, desvios) {
  if (!desvios?.length) return []
  const { where, params } = escopo(sessao, 'i')
  const n = params.length
  return q(
    `select
       coalesce(c.nome, 'Sem categoria')                                     as categoria,
       i.kind,
       to_char(coalesce(i.data_competencia, i.data_vencimento), 'YYYY-MM')   as competencia,
       coalesce(p.nome, 'Sem cadastro')                                      as pessoa,
       i.descricao,
       i.data_vencimento,
       i.total
     from core.installment i
     left join core.category c on c.id = i.category_id
     left join core.person p   on p.id = i.person_id
     join unnest($${n + 1}::text[], $${n + 2}::text[], $${n + 3}::text[])
       as alvo(categoria, kind, competencia)
       on alvo.categoria  = coalesce(c.nome, 'Sem categoria')
      and alvo.kind       = i.kind::text
      and alvo.competencia = to_char(coalesce(i.data_competencia, i.data_vencimento), 'YYYY-MM')
     where ${where}
       and i.deleted_at is null
     order by i.total desc`,
    [
      ...params,
      desvios.map((d) => d.categoria),
      desvios.map((d) => d.kind),
      desvios.map((d) => d.competencia),
    ],
  )
}
