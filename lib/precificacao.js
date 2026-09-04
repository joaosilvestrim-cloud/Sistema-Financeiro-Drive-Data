import 'server-only'
import { q, q1 } from './db.js'
import { escopo } from './escopo.js'

// Estrutura de custo e multiplicador de preço.
//
// A conta é simples e a interpretação é que importa. Sobre cada real de receita
// existe uma parte que some sozinha: imposto e comissão, que são percentuais da
// venda, e o custo fixo, que existe mesmo sem vender. O que sobra é o teto que o
// custo direto pode ocupar sem dar prejuízo.
//
//   sobra = 1 - variavel/receita - fixo/receita
//   multiplicador = 1 / sobra
//
// Se sobra é 0,30, o preço precisa ser 3,33 vezes o custo direto para empatar.
// Abaixo disso a venda dá prejuízo por mais que "pareça" ter margem.
//
// Duas honestidades embutidas. O que não foi classificado nunca é distribuído
// nas outras classes, aparece separado: um multiplicador calculado sobre metade
// da despesa seria pior que nenhum. E quando a sobra é zero ou negativa, não
// existe multiplicador, existe um problema, e a função devolve nulo em vez de
// um número enorme sem significado.

const MESES_PADRAO = 12

export async function estruturaCusto(sessao, meses = MESES_PADRAO) {
  const { where, params } = escopo(sessao, 'i')

  const linhas = await q(
    `select
       coalesce(cc.classe, core.classe_sugerida(cat.tipo, cat.entrada_dre)) as classe,
       cc.classe is not null                                                as manual,
       sum(i.total)                                                         as valor,
       count(*)                                                             as titulos
     from core.installment i
     join core.category cat on cat.id = i.category_id
     left join core.category_classe cc
       on cc.category_id = cat.id and cc.tenant_id = i.tenant_id
     where ${where}
       and i.deleted_at is null
       and i.data_competencia >= date_trunc('month', current_date) - make_interval(months => $${params.length + 1})
       and i.data_competencia < date_trunc('month', current_date)
     group by 1, 2`,
    [...params, meses],
  )

  // Parcela sem categoria nenhuma não entra no join acima e sumiria da conta.
  // Ela é despesa de verdade e precisa aparecer como não classificada.
  const semCategoria = await q1(
    `select coalesce(sum(i.total), 0) as valor, count(*) as titulos
       from core.installment i
      where ${where} and i.deleted_at is null and i.category_id is null
        and i.kind = 'payable'
        and i.data_competencia >= date_trunc('month', current_date) - make_interval(months => $${params.length + 1})
        and i.data_competencia < date_trunc('month', current_date)`,
    [...params, meses],
  )

  const de = (classe) => linhas
    .filter((l) => l.classe === classe)
    .reduce((a, l) => a + Number(l.valor ?? 0), 0)

  const receita = de('receita')
  const direto = de('direto')
  const variavel = de('variavel')
  const fixo = de('fixo')
  const fora = de('fora')
  const naoClassificado = de(null) + Number(semCategoria?.valor ?? 0)

  const pct = (v) => (receita > 0 ? v / receita : null)
  const sobra = receita > 0 ? 1 - pct(variavel) - pct(fixo) : null

  return {
    meses,
    receita, direto, variavel, fixo, fora, naoClassificado,
    titulosNaoClassificados: Number(semCategoria?.titulos ?? 0)
      + linhas.filter((l) => l.classe === null).reduce((a, l) => a + Number(l.titulos), 0),
    percentual: {
      direto: pct(direto), variavel: pct(variavel), fixo: pct(fixo),
      naoClassificado: pct(naoClassificado),
    },
    sobra,
    // Sem sobra não há multiplicador que salve: o negócio gasta em fixo e
    // variável mais do que fatura, e a resposta é cortar custo, não subir preço.
    multiplicador: sobra !== null && sobra > 0 ? 1 / sobra : null,
    // O que o preço de venda cobre hoje, de fato. Comparar com o multiplicador
    // diz se a empresa está vendendo acima ou abaixo do que precisa.
    multiplicadorAtual: direto > 0 ? receita / direto : null,
    resultado: receita - direto - variavel - fixo,
    // Confiável só quando quase tudo está classificado. A tela usa isto para
    // decidir se mostra o número ou pede a classificação primeiro.
    cobertura: receita > 0
      ? 1 - (naoClassificado / Math.max(1, direto + variavel + fixo + naoClassificado))
      : 0,
  }
}

// A lista para classificar, maior primeiro. Quem tem doze meses de histórico não
// vai classificar 119 categorias, vai classificar as dez que movimentam
// dinheiro, e é por isso que a ordem é por valor e não alfabética.
export async function categoriasParaClassificar(sessao, meses = MESES_PADRAO) {
  const { where, params } = escopo(sessao, 'i')
  return q(
    `select cat.id, cat.nome, cat.tipo, cat.entrada_dre,
            cc.classe                                            as classe_manual,
            core.classe_sugerida(cat.tipo, cat.entrada_dre)       as classe_sugerida,
            coalesce(sum(i.total), 0)                             as valor,
            count(i.id)                                           as titulos
       from core.category cat
       left join core.installment i
         on i.category_id = cat.id and i.deleted_at is null and ${where}
        and i.data_competencia >= date_trunc('month', current_date) - make_interval(months => $${params.length + 1})
       left join core.category_classe cc
         on cc.category_id = cat.id and cc.tenant_id = $1
      group by 1, 2, 3, 4, 5, 6
      having coalesce(sum(i.total), 0) > 0
      order by 7 desc`,
    [...params, meses],
  )
}

export async function classificar(sessao, categoriaId, classe) {
  if (!['receita', 'direto', 'variavel', 'fixo', 'fora'].includes(classe)) {
    throw new Error(`classe ${classe} nao existe`)
  }
  await q(
    `insert into core.category_classe (tenant_id, category_id, classe, definido_por)
     values ($1, $2, $3, $4)
     on conflict (tenant_id, category_id) do update
       set classe = excluded.classe, definido_por = excluded.definido_por,
           atualizado_em = now()`,
    [sessao.tenantId, categoriaId, classe, sessao.user?.id ?? null],
  )
}

// Receita por cliente contra o que a empresa precisa faturar sobre cada real de
// custo direto. Não é rentabilidade por cliente de verdade, e a tela diz isso:
// o ERP não amarra despesa a cliente, então o custo direto de cada um é
// desconhecido. O que dá para responder com honestidade é o peso de cada
// cliente e se o conjunto paga a estrutura.
export async function receitaPorCliente(sessao, meses = MESES_PADRAO, limite = 15) {
  const { where, params } = escopo(sessao, 'i')
  return q(
    `select coalesce(p.nome, 'Sem cadastro') as cliente,
            sum(i.total)                     as receita,
            count(*)                         as titulos,
            min(i.data_competencia)          as desde
       from core.installment i
       left join core.person p on p.id = i.person_id
       join core.category cat on cat.id = i.category_id
       left join core.category_classe cc
         on cc.category_id = cat.id and cc.tenant_id = i.tenant_id
      where ${where} and i.deleted_at is null and i.kind = 'receivable'
        and coalesce(cc.classe, core.classe_sugerida(cat.tipo, cat.entrada_dre)) = 'receita'
        and i.data_competencia >= date_trunc('month', current_date) - make_interval(months => $${params.length + 1})
        and i.data_competencia < date_trunc('month', current_date)
      group by 1
      order by 2 desc
      limit $${params.length + 2}`,
    [...params, meses, limite],
  )
}
