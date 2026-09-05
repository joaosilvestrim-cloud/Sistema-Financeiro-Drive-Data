import 'server-only'
import { q, q1 } from './db.js'
import { escopo } from './escopo.js'

// A memória da previsão.
//
// É a razão de guardarmos uma versão de cada parcela a cada mudança. O ERP só
// sabe o estado de agora: se um título de dezembro foi adiado três vezes, ele
// mostra a data atual e nada mais. Aqui fica o rastro.
//
// Duas leituras, com maturidades diferentes.
//
// 1. O que mudou desde que passamos a olhar. Funciona no primeiro dia, porque
//    basta uma parcela ter mudado uma vez.
//
// 2. Qualidade da previsão mês a mês, que compara o que o ERP previa para um
//    mês em momentos diferentes. Essa precisa de pelo menos dois meses de
//    observação para dizer alguma coisa, e não há atalho: não existe como
//    recuperar histórico que nunca foi gravado. É por isso que começar a
//    guardar cedo é o ativo.

export async function mudancas(sessao, limite = 60) {
  const { where, params } = escopo(sessao, 'i')
  return q(
    `with primeira as (
       select distinct on (v.installment_id)
              v.installment_id, v.data_vencimento, v.total, v.pago, v.status, v.valid_from
         from core.installment_version v
         join core.installment i on i.id = v.installment_id
        where ${where}
        order by v.installment_id, v.valid_from
     ),
     atual as (
       select v.installment_id, v.data_vencimento, v.total, v.pago, v.status, v.valid_from
         from core.installment_version v
         join core.installment i on i.id = v.installment_id
        where ${where} and v.valid_to is null
     )
     select
       i.kind,
       i.descricao,
       coalesce(p.nome, 'Sem cadastro')                as pessoa,
       pr.data_vencimento                              as vencimento_antes,
       at.data_vencimento                              as vencimento_agora,
       pr.total                                        as valor_antes,
       at.total                                        as valor_agora,
       pr.pago                                         as pago_antes,
       at.pago                                         as pago_agora,
       pr.status                                       as status_antes,
       at.status                                       as status_agora,
       at.data_vencimento - pr.data_vencimento         as dias_deslocados,
       at.total - pr.total                             as delta_valor,
       at.valid_from                                   as visto_em
     from primeira pr
     join atual at on at.installment_id = pr.installment_id
     join core.installment i on i.id = pr.installment_id
     left join core.person p on p.id = i.person_id
     where i.deleted_at is null
       and (pr.data_vencimento is distinct from at.data_vencimento
         or pr.total            is distinct from at.total
         or pr.pago             is distinct from at.pago
         or pr.status           is distinct from at.status)
     order by abs(coalesce(at.total - pr.total, 0)) desc,
              abs(coalesce(at.data_vencimento - pr.data_vencimento, 0)) desc
     limit $${params.length + 1}`,
    [...params, limite],
  )
}

// O resumo do que o rastro mostra. São os números que cabem numa frase.
export async function resumoMudancas(sessao) {
  const { where, params } = escopo(sessao, 'i')
  return q1(
    `with primeira as (
       select distinct on (v.installment_id)
              v.installment_id, v.data_vencimento, v.total, v.pago, v.status
         from core.installment_version v
         join core.installment i on i.id = v.installment_id
        where ${where}
        order by v.installment_id, v.valid_from
     ),
     atual as (
       select v.installment_id, v.data_vencimento, v.total, v.pago, v.status
         from core.installment_version v
         join core.installment i on i.id = v.installment_id
        where ${where} and v.valid_to is null
     ),
     dif as (
       select i.kind,
              at.data_vencimento - pr.data_vencimento as dias,
              at.total - pr.total                     as delta,
              at.pago is distinct from pr.pago        as pago_mudou,
              pr.status, at.status as status_agora
         from primeira pr
         join atual at on at.installment_id = pr.installment_id
         join core.installment i on i.id = pr.installment_id
        where i.deleted_at is null
          and (pr.data_vencimento is distinct from at.data_vencimento
            or pr.total            is distinct from at.total
            or pr.pago             is distinct from at.pago
         or pr.status           is distinct from at.status)
     )
     select
       count(*)                                                     as total,
       count(*) filter (where dias > 0)                             as adiadas,
       count(*) filter (where dias < 0)                             as antecipadas,
       count(*) filter (where delta <> 0)                           as valor_mudou,
       count(*) filter (where pago_mudou)                            as pagamento_mudou,
       count(*) filter (where status is distinct from status_agora) as status_mudou,
       coalesce(round(avg(dias) filter (where dias > 0)), 0)        as media_dias_adiados,
       coalesce(sum(delta), 0)                                      as soma_delta,
       coalesce(sum(delta) filter (where kind = 'receivable'), 0)   as delta_receber,
       coalesce(sum(delta) filter (where kind = 'payable'), 0)      as delta_pagar
     from dif`,
    params,
  )
}

// Desde quando existe rastro, e quantos pontos de observação. É o que decide se
// a comparação mês a mês já vale.
export async function cobertura(sessao) {
  const { where, params } = escopo(sessao, 'i')
  const r = await q1(
    `select
       min(v.valid_from)                                       as desde,
       count(distinct date_trunc('month', v.valid_from))::int   as meses_observados,
       count(*)::int                                            as versoes,
       count(*) filter (where v.valid_to is not null)::int       as versoes_fechadas
     from core.installment_version v
     join core.installment i on i.id = v.installment_id
     where ${where}`,
    params,
  )
  return {
    ...r,
    // Comparar exige dois momentos. Com um só, o que existe é uma foto, e uma
    // foto não mostra deslocamento.
    comparavel: Number(r?.meses_observados ?? 0) >= 2,
    diasDeRastro: r?.desde ? Math.floor((Date.now() - new Date(r.desde)) / 86400000) : 0,
  }
}

// A comparação mês a mês, quando houver dois pontos. Cada linha é um mês de
// vencimento, e as colunas são o que se esperava dele em cada momento.
export async function qualidadePorMes(sessao, kind = 'receivable') {
  const { where, params } = escopo(sessao)
  return q(
    `select
       to_char(mes_previsto, 'YYYY-MM') as mes,
       to_char(visto_em, 'YYYY-MM')     as visto,
       previsto,
       titulos
     from mart.forecast_accuracy
     where ${where} and kind = $${params.length + 1}
       and mes_previsto >= date_trunc('month', current_date) - interval '6 months'
     order by mes_previsto, visto_em`,
    [...params, kind],
  )
}

// O histórico de cada parcela em aberto, para abrir dentro da linha de
// Recebíveis.
//
// Esta é a informação que nenhum ERP devolve. O Conta Azul mostra a data de
// vencimento de hoje; se ela já foi adiada três vezes, ele mostra a de hoje e
// mais nada, porque sobrescreve. Aqui cada leitura que trouxe um dado diferente
// virou uma versão, e a linha aberta conta a história inteira: prometeram dia
// 10, viraram para 25, viraram para o mês seguinte.
//
// Uma consulta serve as sessenta linhas da tela. Sessenta consultas sob
// demanda, uma por clique, dariam a mesma resposta com sessenta idas ao banco.
export async function historicoDosTitulos(sessao, kind = 'receivable', limite = 60) {
  const { where, params } = escopo(sessao, 'i')
  return q(
    `with abertos as (
       select i.id
         from core.installment i
        where ${where}
          and i.kind = $${params.length + 1}
          and coalesce(i.nao_pago, 0) > 0
          and i.deleted_at is null
        order by i.data_vencimento asc
        limit $${params.length + 2}
     )
     select v.installment_id,
            v.valid_from                     as visto_em,
            v.valid_to,
            v.data_vencimento,
            v.total,
            v.pago,
            v.nao_pago,
            v.status
       from core.installment_version v
       join abertos a on a.id = v.installment_id
      order by v.installment_id, v.valid_from`,
    [...params, kind, limite],
  )
}
