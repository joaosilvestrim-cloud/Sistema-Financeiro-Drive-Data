// Confere que o que abre dentro da linha fecha com o numero da linha fechada.
//
// A linha expansivel so vale se o detalhe somar exatamente o que a linha
// mostra. Se as duas contas vierem de caminhos diferentes, um dia elas
// divergem e quem confia no painel perde a confianca de uma vez.
import { pool, query } from '../src/db.mjs'
import { dre } from '../lib/dre.js'
import { agingDuplo, dezMaiores, titulosPorFaixa, titulosPorPessoa } from '../lib/executivo.js'
import { topClientes, anomalias, lancamentosDosDesvios } from '../lib/queries.js'
import { estruturaCusto } from '../lib/precificacao.js'
import { provisao } from '../lib/imposto.js'

const { rows: [t] } = await query('select id, nome from core.tenant order by slug limit 1')
const sessao = { tenantId: t.id, connectionId: null }
const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const cent = (v) => Math.round(Number(v ?? 0) * 100)

let falhas = 0
const conferir = (nome, esperado, obtido) => {
  const ok = cent(esperado) === cent(obtido)
  if (!ok) falhas++
  console.log(`  ${ok ? 'ok  ' : 'FALHA'} ${nome.padEnd(46)} linha ${brl(esperado).padStart(16)}  detalhe ${brl(obtido).padStart(16)}`)
}

console.log('== DRE: soma das categorias contra o total do grupo ==')
for (const grao of ['mes', 'trimestre', 'ano']) {
  const d = await dre(sessao, grao)
  for (const g of [...d.receitas, ...d.despesas]) {
    conferir(`${grao}/${g.grupo}`, g.total, g.categorias.reduce((a, c) => a + c.total, 0))
    // E periodo a periodo, porque um total certo pode esconder duas colunas
    // trocadas entre si.
    for (const p of d.periodos) {
      const soma = g.categorias.reduce((a, c) => a + (c.porPeriodo[p] ?? 0), 0)
      conferir(`${grao}/${g.grupo}/${p}`, g.porPeriodo[p] ?? 0, soma)
    }
  }
}

console.log('\n== AGING: soma dos titulos da faixa contra o valor da faixa ==')
const aging = await agingDuplo(sessao)
for (const [kind, linhas] of [['receivable', aging.receber], ['payable', aging.pagar]]) {
  const det = await titulosPorFaixa(sessao, kind)
  for (const l of linhas) {
    const dentro = det.filter((x) => x.faixa === l.faixa)
    conferir(`${kind}/${l.faixa}`, l.valor, dentro.reduce((a, x) => a + Number(x.nao_pago), 0))
    if (Number(l.titulos) !== dentro.length) {
      falhas++
      console.log(`  FALHA contagem ${kind}/${l.faixa}: linha ${l.titulos}, detalhe ${dentro.length}`)
    }
  }
}

console.log('\n== DEZ MAIORES: soma dos titulos da pessoa contra o em aberto dela ==')
for (const kind of ['receivable', 'payable']) {
  const lista = await dezMaiores(sessao, kind)
  const det = await titulosPorPessoa(sessao, kind)
  for (const x of lista) {
    const dele = det.filter((d) => d.pessoa === x.nome)
    conferir(`${kind}/${x.nome}`.slice(0, 46), x.em_aberto, dele.reduce((a, d) => a + Number(d.nao_pago), 0))
  }
}

console.log('\n== CLIENTES: soma dos titulos contra o em aberto da linha ==')
{
  const clientes = await topClientes(sessao, 40)
  const det = await titulosPorPessoa(sessao, 'receivable')
  for (const c of clientes) {
    const dele = det.filter((d) => d.pessoa === c.cliente)
    conferir(c.cliente.slice(0, 46), c.em_aberto, dele.reduce((a, d) => a + Number(d.nao_pago), 0))
  }
}

console.log('\n== ESTRUTURA DE CUSTO: soma das categorias contra o total da classe ==')
{
  const e = await estruturaCusto(sessao)
  for (const [nome, total] of [
    ['receita', e.receita], ['direto', e.direto], ['variavel', e.variavel],
    ['fixo', e.fixo], ['naoClassificado', e.naoClassificado],
  ]) {
    const cats = e.categorias[nome] ?? []
    conferir(nome, total, cats.reduce((a, c) => a + c.valor, 0))
  }
}

console.log('\n== IMPOSTOS: soma dos clientes contra o total do anexo ==')
{
  const pr = await provisao(sessao)
  for (const a of pr.porAnexo) {
    const dele = pr.clientes.filter((c) => c.anexo === a.anexo)
    conferir(`anexo ${a.anexo} faturamento`, a.receita, dele.reduce((x, c) => x + c.receita, 0))
    conferir(`anexo ${a.anexo} imposto`, a.imposto, dele.reduce((x, c) => x + c.imposto, 0))
  }
}

console.log('\n== DESVIOS: soma dos lancamentos contra o valor do desvio ==')
{
  const desvios = await anomalias(sessao, 3.5, 12)
  const lanc = await lancamentosDosDesvios(sessao, desvios)
  if (!desvios.length) console.log('  (nenhum desvio no periodo, nada a conferir)')
  for (const a of desvios) {
    const dentro = lanc.filter(
      (l) => l.categoria === a.categoria && l.kind === a.kind && l.competencia === a.competencia,
    )
    conferir(`${a.competencia} ${a.categoria}`.slice(0, 46), a.valor,
             dentro.reduce((x, l) => x + Number(l.total), 0))
  }
}

console.log(falhas ? `\n${falhas} divergencia(s).` : '\nTudo fecha.')
await pool.end()
process.exit(falhas ? 1 : 0)
