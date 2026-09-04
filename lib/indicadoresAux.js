import 'server-only'
import { q } from './db.js'
import { escopo } from './escopo.js'

// Indicadores que só existem quando uma série auxiliar foi preenchida.
//
// Todos seguem a mesma regra: a série entra por junção e o indicador só existe
// nos meses em que ela tem valor. Preencher meio ano não pode produzir linha
// inventada no resto, porque um número desses vira decisão.

// Realizado do mês contra a meta, com o desvio em valor e em percentual.
export async function realizadoContraMeta(sessao, meses = 12) {
  const { where, params } = escopo(sessao)
  return q(
    `with realizado as (
       select mes,
              sum(competencia) filter (where kind = 'receivable') as receita,
              sum(competencia) filter (where kind = 'payable')    as despesa
         from mart.monthly_series
        where ${where}
          and mes >= date_trunc('month', current_date) - make_interval(months => ${meses})
        group by 1
     ),
     metas as (
       select competencia as mes, tipo, sum(valor) as valor
         from mart.aux_mensal
        where tenant_id = $1 and tipo in ('meta_receita', 'meta_despesa', 'meta_resultado')
        group by 1, 2
     ),
     todos as (
       select mes from realizado union select mes from metas
     )
     select to_char(t.mes, 'YYYY-MM')                             as competencia,
            coalesce(max(r.receita), 0)                           as receita,
            coalesce(max(r.despesa), 0)                           as despesa,
            coalesce(max(r.receita), 0) - coalesce(max(r.despesa), 0) as resultado,
            max(m.valor) filter (where m.tipo = 'meta_receita')    as meta_receita,
            max(m.valor) filter (where m.tipo = 'meta_despesa')    as meta_despesa,
            max(m.valor) filter (where m.tipo = 'meta_resultado')  as meta_resultado
       from todos t
       left join realizado r on r.mes = t.mes
       left join metas m     on m.mes = t.mes
      where t.mes >= date_trunc('month', current_date) - make_interval(months => ${meses})
      group by 1
      order by 1`,
    params,
  )
}

// Receita e custo por pessoa. Mostra se crescer de time está virando resultado
// ou apenas diluindo margem.
export async function porColaborador(sessao, meses = 24) {
  const { where, params } = escopo(sessao)
  return q(
    `with realizado as (
       select mes,
              sum(competencia) filter (where kind = 'receivable') as receita,
              sum(competencia) filter (where kind = 'payable')    as despesa
         from mart.monthly_series
        where ${where}
          and mes >= date_trunc('month', current_date) - make_interval(months => ${meses})
          and mes <= date_trunc('month', current_date)
        group by 1
     ),
     pessoas as (
       select competencia as mes, sum(valor) as pessoas
         from mart.aux_mensal
        where tenant_id = $1 and tipo = 'headcount'
        group by 1
     )
     select to_char(r.mes, 'YYYY-MM') as competencia,
            r.receita, r.despesa, p.pessoas,
            case when p.pessoas > 0 then round((r.receita / p.pessoas)::numeric, 2) end as receita_por_pessoa,
            case when p.pessoas > 0 then round((r.despesa / p.pessoas)::numeric, 2) end as custo_por_pessoa,
            case when p.pessoas > 0
                 then round(((r.receita - r.despesa) / p.pessoas)::numeric, 2) end      as resultado_por_pessoa
       from realizado r
       join pessoas p on p.mes = r.mes
      order by 1`,
    params,
  )
}

// Receita por hora faturável e taxa de utilização.
//
// Utilização é faturável sobre disponível. Abaixo de 60% costuma ser
// ociosidade, acima de 85% costuma ser time no limite.
export async function porHora(sessao, meses = 24) {
  const { where, params } = escopo(sessao)
  return q(
    `with realizado as (
       select mes, sum(competencia) filter (where kind = 'receivable') as receita
         from mart.monthly_series
        where ${where}
          and mes >= date_trunc('month', current_date) - make_interval(months => ${meses})
          and mes <= date_trunc('month', current_date)
        group by 1
     ),
     horas as (
       select competencia as mes,
              sum(valor) filter (where tipo = 'horas_faturaveis')  as faturaveis,
              sum(valor) filter (where tipo = 'horas_disponiveis') as disponiveis
         from mart.aux_mensal
        where tenant_id = $1 and tipo in ('horas_faturaveis', 'horas_disponiveis')
        group by 1
     )
     select to_char(h.mes, 'YYYY-MM') as competencia,
            r.receita, h.faturaveis, h.disponiveis,
            case when h.faturaveis > 0 then round((r.receita / h.faturaveis)::numeric, 2) end     as receita_por_hora,
            case when h.disponiveis > 0 then round((h.faturaveis / h.disponiveis)::numeric, 4) end as utilizacao
       from horas h
       left join realizado r on r.mes = h.mes
      order by 1`,
    params,
  )
}

// Pipeline comercial mês a mês, do mês corrente em diante.
//
// A projeção estima novos negócios pela média histórica. O pipeline diz o que
// está de fato em negociação. Quando o pipeline fica bem abaixo, a projeção
// está contando com receita que ninguém está vendendo.
export async function pipelineFuturo(sessao) {
  return q(
    `select to_char(competencia, 'YYYY-MM') as competencia, sum(valor) as pipeline
       from mart.aux_mensal
      where tenant_id = $1 and tipo = 'pipeline'
        and competencia >= date_trunc('month', current_date)
      group by 1 order by 1`,
    [sessao.tenantId],
  )
}

// Receita nominal e receita real, deflacionada por um índice mensal.
//
// A série guarda o número do mês, por exemplo 0,45 para IPCA de 0,45%. O
// deflator acumula do primeiro mês da série em diante, então a receita real
// fica em poder de compra daquele mês. Sem isso, crescer 8% num ano de 6% de
// inflação parece o dobro do que é.
export async function receitaReal(sessao, meses = 24) {
  const { where, params } = escopo(sessao)
  return q(
    `with realizado as (
       select mes, sum(competencia) filter (where kind = 'receivable') as receita
         from mart.monthly_series
        where ${where}
          and mes >= date_trunc('month', current_date) - make_interval(months => ${meses})
          and mes <= date_trunc('month', current_date)
        group by 1
     ),
     indice as (
       select competencia as mes, sum(valor) as pct
         from mart.aux_mensal
        where tenant_id = $1 and tipo = 'indice_economico'
        group by 1
     ),
     deflator as (
       select mes, exp(sum(ln(1 + pct / 100.0)) over (order by mes)) as fator
         from indice
     )
     select to_char(r.mes, 'YYYY-MM')                  as competencia,
            r.receita                                  as nominal,
            round((r.receita / d.fator)::numeric, 2)   as real,
            round(d.fator::numeric, 4)                 as deflator
       from realizado r
       join deflator d on d.mes = r.mes
      order by 1`,
    params,
  )
}

// Quais tipos de série já têm valor. As telas usam isto para decidir entre
// mostrar o indicador ou explicar exatamente o que falta preencher.
export async function tiposPreenchidos(sessao) {
  const linhas = await q(
    `select distinct tipo from mart.aux_mensal where tenant_id = $1`,
    [sessao.tenantId],
  )
  return new Set(linhas.map((l) => l.tipo))
}
