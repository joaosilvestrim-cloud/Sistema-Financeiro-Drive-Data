import 'server-only'
import { q, q1 } from './db.js'
import { escopo } from './escopo.js'

// A razão de contas a pagar e a receber.
//
// Até aqui o sistema tinha as duas pontas e não tinha o meio. Havia o aging em
// barras, que diz quanto está vencido, e havia o resumo, que diz quem são os
// dez maiores. Não havia lugar nenhum onde alguém abrisse a lista inteira, com
// filtro, e conferisse título por título. E a pagar não tinha nem lista: só a
// barra.
//
// Sem esse meio o painel responde bem à pergunta de quem decide e mal à
// pergunta de quem executa, que é "quais são, exatamente". É também o que
// sustenta o fluxo de caixa: todo mês projetado passa a poder ser aberto até os
// títulos que o compõem, e um número que não abre é um número em que se
// acredita, não um número que se confere.
//
// Só leitura. O Conta Azul continua sendo a fonte, e nada aqui grava lá.

// Situação, do jeito que quem opera pergunta.
//
// O ERP tem status próprio e ele não responde direto: ATRASADO é uma leitura de
// data que envelhece sozinha, e RECEBIDO convive com baixa parcial. Aqui a
// situação sai do dinheiro, não do rótulo, então ela não depende de o ERP ter
// reprocessado nada.
const SITUACAO = `
  case
    when coalesce(i.nao_pago, 0) <= 0.009                        then 'liquidado'
    when coalesce(i.pago, 0) > 0.009                             then 'parcial'
    when i.data_vencimento < current_date                        then 'vencido'
    else 'a_vencer'
  end`

export const SITUACOES = [
  ['todas', 'todas'],
  ['aberto', 'em aberto'],
  ['vencido', 'vencidas'],
  ['a_vencer', 'a vencer'],
  ['parcial', 'baixa parcial'],
  ['liquidado', 'liquidadas'],
]

// Monta o filtro uma vez e devolve para a listagem e para os totais usarem o
// mesmo. Dois filtros escritos duas vezes divergem no dia em que um dos dois
// muda, e o sintoma é um total que não bate com a soma da tela, que é o pior
// defeito possível numa razão.
function filtro(sessao, f = {}) {
  const { where, params } = escopo(sessao, 'i')
  const cond = [where, 'i.deleted_at is null']
  const p = [...params]

  if (f.kind === 'receivable' || f.kind === 'payable') {
    p.push(f.kind)
    cond.push(`i.kind = $${p.length}`)
  }
  if (f.de) {
    p.push(f.de)
    cond.push(`i.data_vencimento >= $${p.length}::date`)
  }
  if (f.ate) {
    p.push(f.ate)
    cond.push(`i.data_vencimento <= $${p.length}::date`)
  }
  if (f.situacao && f.situacao !== 'todas') {
    if (f.situacao === 'aberto') cond.push('coalesce(i.nao_pago, 0) > 0.009')
    else {
      p.push(f.situacao)
      cond.push(`(${SITUACAO}) = $${p.length}`)
    }
  }
  if (f.busca?.trim()) {
    p.push(`%${f.busca.trim()}%`)
    cond.push(`(i.descricao ilike $${p.length} or p.nome ilike $${p.length})`)
  }
  if (f.pessoa) {
    p.push(f.pessoa)
    cond.push(`i.person_id = $${p.length}`)
  }
  if (f.categoria) {
    p.push(f.categoria)
    cond.push(`i.category_id = $${p.length}`)
  }

  return { where: cond.join('\n       and '), params: p }
}

const DE = `
  from core.installment i
  left join core.person p     on p.id = i.person_id
  left join core.category c   on c.id = i.category_id`

export async function razao(sessao, f = {}, { limite = 200, pagina = 0 } = {}) {
  const { where, params } = filtro(sessao, f)
  const ordem = {
    vencimento: 'i.data_vencimento asc, i.total desc',
    vencimento_desc: 'i.data_vencimento desc, i.total desc',
    valor: 'i.total desc',
    pessoa: 'p.nome asc nulls last, i.data_vencimento asc',
  }[f.ordem] ?? 'i.data_vencimento asc, i.total desc'

  return q(
    `select i.id, i.kind, i.descricao, i.data_vencimento, i.data_competencia,
            i.total, i.pago, i.nao_pago, i.status_traduzido,
            coalesce(p.nome, 'Sem cadastro')  as pessoa,
            p.documento                       as pessoa_documento,
            c.nome                            as categoria,
            ${SITUACAO}                       as situacao,
            current_date - i.data_vencimento  as dias,
            (select count(*) from core.settlement s where s.installment_id = i.id) as baixas
     ${DE}
     where ${where}
     order by ${ordem}
     limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limite, pagina * limite],
  )
}

// Os totais do mesmo recorte. Vêm de uma consulta separada de propósito: somar
// só a página mostraria um total que muda quando alguém vira a página, o que é
// pior que não mostrar total nenhum.
export async function totaisDaRazao(sessao, f = {}) {
  const { where, params } = filtro(sessao, f)
  return q1(
    `select
       count(*)::int                                            as titulos,
       coalesce(sum(i.total), 0)                                as total,
       coalesce(sum(i.pago), 0)                                 as pago,
       coalesce(sum(i.nao_pago), 0)                             as aberto,
       coalesce(sum(i.nao_pago) filter (
         where i.data_vencimento < current_date
           and coalesce(i.nao_pago, 0) > 0.009), 0)             as vencido,
       count(*) filter (
         where i.data_vencimento < current_date
           and coalesce(i.nao_pago, 0) > 0.009)::int            as titulos_vencidos,
       min(i.data_vencimento)                                   as primeiro,
       max(i.data_vencimento)                                   as ultimo
     ${DE}
     where ${where}`,
    params,
  )
}

// O mesmo recorte, agrupado. Serve às duas leituras que alguém faz numa razão
// depois de olhar a lista: por quem e por onde.
export async function razaoAgrupada(sessao, f = {}, por = 'pessoa', limite = 12) {
  const { where, params } = filtro(sessao, f)
  const campo = por === 'categoria'
    ? "coalesce(c.nome, 'Sem categoria')"
    : "coalesce(p.nome, 'Sem cadastro')"
  return q(
    `select ${campo}                              as chave,
            count(*)::int                          as titulos,
            coalesce(sum(i.total), 0)              as total,
            coalesce(sum(i.nao_pago), 0)           as aberto
     ${DE}
     where ${where}
     group by 1
     order by 3 desc
     limit $${params.length + 1}`,
    [...params, limite],
  )
}

// As baixas de um título, para abrir dentro da linha. Uma consulta para a
// página inteira, e não uma por clique.
export async function baixasDosTitulos(sessao, ids) {
  if (!ids?.length) return []
  return q(
    `select s.installment_id, s.data_pagamento, s.valor, s.juros, s.desconto, s.taxa,
            a.nome as conta
       from core.settlement s
       left join core.account a on a.id = s.account_id
      where s.tenant_id = $1 and s.installment_id = any($2::uuid[])
      order by s.data_pagamento`,
    [sessao.tenantId, ids],
  )
}

// Pessoas e categorias que aparecem no recorte, para alimentar os seletores.
// Só o que existe: oferecer um filtro que devolve lista vazia é uma promessa
// quebrada em forma de menu.
export async function opcoesDaRazao(sessao, f = {}) {
  const { where, params } = filtro(sessao, { ...f, pessoa: null, categoria: null })
  const [pessoas, categorias] = await Promise.all([
    q(`select distinct p.id, p.nome ${DE} where ${where} and p.id is not null
        order by p.nome limit 300`, params),
    q(`select distinct c.id, c.nome ${DE} where ${where} and c.id is not null
        order by c.nome limit 300`, params),
  ])
  return { pessoas, categorias }
}
