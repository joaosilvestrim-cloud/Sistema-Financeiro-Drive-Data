import 'server-only'
import { q } from './db.js'
import { escopo } from './escopo.js'

// DRE por mês, trimestre ou ano.
//
// O Diogo pediu "DRE gerencial mês, trimestre, ano, com comparativo e
// variação". A leitura muda com a janela: no mês aparece o soluço de um cliente
// que atrasou, no trimestre aparece a tendência, e no ano aparece se o negócio
// cresceu. Uma granularidade só esconde duas perguntas.
//
// A comparação é sempre contra o período equivalente anterior, e nunca inclui o
// período em curso, que está pela metade e faria toda receita parecer em queda.

// O make_interval do Postgres não tem "quarters", só months, years e afins.
// Por isso o recuo de cada grão vem escrito à mão em vez de sair do nome.
const GRAOS = {
  mes:       { sql: 'month',   quantidade: 6, rotulo: 'mês',       recuo: (n) => `months => ${n}` },
  trimestre: { sql: 'quarter', quantidade: 6, rotulo: 'trimestre', recuo: (n) => `months => ${n * 3}` },
  ano:       { sql: 'year',    quantidade: 4, rotulo: 'ano',       recuo: (n) => `years => ${n}` },
}

export const granularidades = Object.entries(GRAOS)
  .map(([chave, g]) => ({ chave, rotulo: g.rotulo }))

export async function dre(sessao, granularidade = 'mes') {
  const grao = GRAOS[granularidade] ?? GRAOS.mes
  const { where, params } = escopo(sessao)

  const linhas = await q(
    `select
       to_char(date_trunc('${grao.sql}', mes), 'YYYY-MM-DD') as periodo,
       kind,
       coalesce(grupo_dre, 'SEM_GRUPO')                      as grupo_dre,
       sum(total)                                            as total
     from mart.dre_monthly
     where ${where}
       and mes >= date_trunc('${grao.sql}', current_date)
                  - make_interval(${grao.recuo(grao.quantidade - 1)})
       -- O teto existe porque a base tem parcela lançada para 2029. Sem ele o
       -- DRE mostraria anos inteiros de receita futura como se fossem passado,
       -- e a comparação sairia entre dois períodos que ainda não aconteceram.
       and mes <= current_date
     group by 1, 2, 3
     order by 1`,
    params,
  )

  const periodos = [...new Set(linhas.map((l) => l.periodo))].sort()
  const emCurso = periodos.at(-1) ?? null

  const grupos = new Map()
  for (const l of linhas) {
    const chave = `${l.kind}|${l.grupo_dre}`
    if (!grupos.has(chave)) {
      grupos.set(chave, { kind: l.kind, grupo: l.grupo_dre, porPeriodo: {}, total: 0 })
    }
    const g = grupos.get(chave)
    g.porPeriodo[l.periodo] = (g.porPeriodo[l.periodo] ?? 0) + Number(l.total)
    g.total += Number(l.total)
  }

  const lista = [...grupos.values()]
  const receitas = lista.filter((g) => g.kind === 'receivable').sort((a, b) => b.total - a.total)
  const despesas = lista.filter((g) => g.kind === 'payable').sort((a, b) => b.total - a.total)

  // Os dois últimos períodos fechados. É contra eles que a variação é medida,
  // porque comparar com o período em curso não diz nada.
  const fechados = periodos.filter((p) => p !== emCurso)
  const atual = fechados.at(-1) ?? null
  const anterior = fechados.at(-2) ?? null

  const variacao = (g) => {
    if (!atual || !anterior) return null
    const a = g.porPeriodo[anterior] ?? 0
    const b = g.porPeriodo[atual] ?? 0
    if (!a) return b ? { tipo: 'novo', valor: b } : null
    return { tipo: 'pct', valor: (b - a) / Math.abs(a), delta: b - a }
  }

  const soma = (grupo, periodo) => grupo.reduce((acc, g) => acc + (g.porPeriodo[periodo] ?? 0), 0)

  const resultado = Object.fromEntries(
    periodos.map((p) => [p, soma(receitas, p) - soma(despesas, p)]),
  )

  return {
    granularidade, rotuloGrao: grao.rotulo,
    periodos, emCurso, atual, anterior,
    receitas: receitas.map((g) => ({ ...g, variacao: variacao(g) })),
    despesas: despesas.map((g) => ({ ...g, variacao: variacao(g) })),
    totais: {
      receita: Object.fromEntries(periodos.map((p) => [p, soma(receitas, p)])),
      despesa: Object.fromEntries(periodos.map((p) => [p, soma(despesas, p)])),
      resultado,
    },
    // Margem por período. É o número que muda a conversa quando a receita cresce
    // e o resultado não acompanha.
    margem: Object.fromEntries(periodos.map((p) => {
      const r = soma(receitas, p)
      return [p, r > 0 ? resultado[p] / r : null]
    })),
  }
}

// Rótulo curto do período, conforme o grão. "2026-07-01" vira jul/26, 3º tri/26
// ou 2026.
export function rotuloPeriodo(iso, granularidade) {
  const [ano, mes] = iso.split('-')
  if (granularidade === 'ano') return ano
  if (granularidade === 'trimestre') {
    return `${Math.floor((Number(mes) - 1) / 3) + 1}º tri/${ano.slice(2)}`
  }
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`
}
