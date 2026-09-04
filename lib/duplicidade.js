import 'server-only'
import { q } from './db.js'
import { escopo } from './escopo.js'

// Procura lançamento repetido.
//
// Nasceu de um caso real: durante a reunião de 04/09 apareceu um lançamento
// duplicado no Conta Azul, e o diagnóstico foi "na hora de salvar, salvou duas
// vezes". Esse erro custa dinheiro de duas formas, pagando duas vezes ou
// projetando receita que não existe, e ninguém procura por ele de propósito.
//
// O cuidado é não gritar. Mesmo fornecedor, mesmo valor e mesma data acontece
// de verdade: dois contratos, duas parcelas de projetos diferentes. Por isso a
// tela nunca diz "duplicado", diz "confira", e ordena pelo que tem mais cara de
// engano.
//
// O sinal mais forte não é o valor repetido, é a proximidade do cadastro. Dois
// lançamentos idênticos criados com minutos de diferença são um clique duplo.
// Criados com meses de diferença são a vida normal da empresa.

const MINUTOS_CLIQUE_DUPLO = 10

export async function possiveisDuplicados(sessao, limite = 20) {
  const { where, params } = escopo(sessao, 'i')

  const grupos = await q(
    `with candidatos as (
       select
         i.person_id, i.kind, i.data_vencimento, i.total,
         count(*)                                                as quantidade,
         count(distinct lower(coalesce(i.descricao, '')))        as descricoes,
         max(i.data_criacao) - min(i.data_criacao)               as intervalo,
         sum(i.total)                                            as valor_total,
         sum(i.nao_pago)                                         as em_aberto,
         array_agg(i.external_id order by i.data_criacao)        as ids,
         min(i.descricao)                                        as descricao
       from core.installment i
       where ${where}
         and i.deleted_at is null
         and i.total is not null and i.total > 0
         and i.data_vencimento is not null
       group by 1, 2, 3, 4
       having count(*) > 1
     )
     select c.*, p.nome as pessoa,
       -- Pontuação, do mais forte para o mais fraco.
       (case when c.intervalo < make_interval(mins => ${MINUTOS_CLIQUE_DUPLO}) then 60 else 0 end)
       + (case when c.descricoes = 1 then 25 else 0 end)
       + (case when c.quantidade > 2 then 10 else 0 end)
       + (case when c.em_aberto > 0 then 5 else 0 end) as suspeita
     from candidatos c
     left join core.person p on p.id = c.person_id
     order by suspeita desc, c.valor_total desc
     limit $${params.length + 1}`,
    [...params, limite],
  )

  return grupos.map((g) => ({
    ...g,
    // O motivo em uma frase, porque um número de 0 a 100 não ajuda ninguém a
    // decidir se vale abrir o ERP.
    motivo: motivoDe(g),
    forte: Number(g.suspeita) >= 60,
  }))
}

function motivoDe(g) {
  const minutos = g.intervalo ? intervaloEmMinutos(g.intervalo) : null
  if (minutos !== null && minutos < MINUTOS_CLIQUE_DUPLO) {
    return minutos < 1
      ? 'criados no mesmo minuto, com a mesma data e o mesmo valor'
      : `criados com ${Math.round(minutos)} minutos de diferença`
  }
  if (Number(g.descricoes) === 1) return 'mesma descrição, mesma data e mesmo valor'
  return 'mesma data e mesmo valor, descrições diferentes'
}

// O driver devolve intervalo como objeto com as partes separadas.
function intervaloEmMinutos(iv) {
  if (typeof iv === 'number') return iv / 60000
  const { days = 0, hours = 0, minutes = 0, seconds = 0, months = 0, years = 0 } = iv ?? {}
  return ((years * 365 + months * 30 + days) * 24 * 60) + hours * 60 + minutes + seconds / 60
}
