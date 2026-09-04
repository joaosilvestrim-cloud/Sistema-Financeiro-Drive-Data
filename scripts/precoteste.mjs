// Confere a estrutura de custo e o multiplicador contra o banco real.
import { pool, query } from '../src/db.mjs'
import { estruturaCusto, categoriasParaClassificar, receitaPorCliente } from '../lib/precificacao.js'

const { rows: [t] } = await query('select id, nome from core.tenant order by slug limit 1')
const sessao = { tenantId: t.id, connectionId: null }
const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v) => v === null ? '--' : (v * 100).toFixed(1) + '%'

const e = await estruturaCusto(sessao)
console.log(`== ESTRUTURA DE CUSTO (${e.meses} meses fechados) ==`)
console.log(`  receita          ${brl(e.receita).padStart(16)}`)
console.log(`  custo direto     ${brl(e.direto).padStart(16)}  ${pct(e.percentual.direto)}`)
console.log(`  custo variavel   ${brl(e.variavel).padStart(16)}  ${pct(e.percentual.variavel)}`)
console.log(`  custo fixo       ${brl(e.fixo).padStart(16)}  ${pct(e.percentual.fixo)}`)
console.log(`  nao classificado ${brl(e.naoClassificado).padStart(16)}  ${pct(e.percentual.naoClassificado)}  (${e.titulosNaoClassificados} titulos)`)
console.log(`  fora da operacao ${brl(e.fora).padStart(16)}`)
console.log(`  resultado        ${brl(e.resultado).padStart(16)}`)
console.log(`\n  sobra para o custo direto: ${pct(e.sobra)}`)
console.log(`  multiplicador necessario:  ${e.multiplicador ? e.multiplicador.toFixed(2) + 'x' : 'sem sobra'}`)
console.log(`  multiplicador praticado:   ${e.multiplicadorAtual ? e.multiplicadorAtual.toFixed(2) + 'x' : '--'}`)
console.log(`  cobertura da classificacao: ${pct(e.cobertura)}`)

const c = await categoriasParaClassificar(sessao)
console.log(`\n== ${c.length} categorias com movimento ==`)
for (const x of c.slice(0, 12)) {
  const classe = x.classe_manual ?? x.classe_sugerida ?? 'SEM CLASSE'
  const origem = x.classe_manual ? 'manual' : x.classe_sugerida ? 'sugerida' : 'PRECISA DECIDIR'
  console.log(`  ${brl(x.valor).padStart(15)}  ${String(classe).padEnd(9)} ${origem.padEnd(15)} ${x.nome.slice(0, 40)}`)
}

const r = await receitaPorCliente(sessao, 12, 8)
console.log('\n== RECEITA POR CLIENTE (12 meses) ==')
const totalR = r.reduce((a, x) => a + Number(x.receita), 0)
for (const x of r) {
  console.log(`  ${brl(x.receita).padStart(15)}  ${((x.receita / totalR) * 100).toFixed(1).padStart(5)}%  ${x.cliente.slice(0, 40)}`)
}

await pool.end()
