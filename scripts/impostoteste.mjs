// Confere a provisao de imposto contra o banco real.
import { pool, query } from '../src/db.mjs'
import { provisao, impostoLancado, classificarCliente, competenciasDisponiveis } from '../lib/imposto.js'

const { rows: [t] } = await query('select id from core.tenant order by slug limit 1')
const s = { tenantId: t.id, connectionId: null, user: { id: null } }
const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

console.log('competencias disponiveis:', (await competenciasDisponiveis(s, 6)).join(', '))

console.log('\n== ANTES de classificar (tudo no anexo padrao) ==')
let p = await provisao(s)
console.log(`competencia ${p.competencia} · receita ${brl(p.receita)} · imposto ${brl(p.imposto)} · media ${p.aliquotaMedia.toFixed(2)}%`)
console.log(`${p.naoClassificados} cliente(s) sem classificacao`)

// A Tamires disse: os unicos anexo V hoje sao PepsiCo e Unilever.
const alvos = await query(
  `select id, nome from core.person where nome ilike '%pepsico%' or nome ilike '%unilever%'`)
for (const a of alvos.rows) {
  await classificarCliente(s, a.id, 'V')
  console.log(`  classificado como anexo V: ${a.nome}`)
}

console.log('\n== DEPOIS de marcar PepsiCo e Unilever como anexo V ==')
p = await provisao(s)
for (const a of p.porAnexo) {
  console.log(`  anexo ${a.anexo.padEnd(3)} ${String(a.clientes).padStart(2)} cliente(s)  receita ${brl(a.receita).padStart(15)}  a ${a.aliquota}%  imposto ${brl(a.imposto).padStart(13)}`)
}
console.log(`  ${'TOTAL'.padEnd(10)} ${String(p.clientes.length).padStart(2)} cliente(s)  receita ${brl(p.receita).padStart(15)}  media ${p.aliquotaMedia.toFixed(2)}%  imposto ${brl(p.imposto).padStart(13)}`)

console.log('\n  conferencia manual:')
const v = p.clientes.filter(c => c.anexo === 'V')
const iii = p.clientes.filter(c => c.anexo === 'III')
const somaV = v.reduce((a,c)=>a+c.receita,0), somaIII = iii.reduce((a,c)=>a+c.receita,0)
console.log(`    anexo V   ${brl(somaV)} x 15% = ${brl(somaV*0.15)}`)
console.log(`    anexo III ${brl(somaIII)} x 12% = ${brl(somaIII*0.12)}`)
console.log(`    soma = ${brl(somaV*0.15 + somaIII*0.12)}  ${Math.abs((somaV*0.15+somaIII*0.12) - p.imposto) < 0.01 ? 'bate' : 'NAO BATE'}`)
console.log(`    a 12% linear seria ${brl(p.receita*0.12)}, diferenca de ${brl(p.imposto - p.receita*0.12)}`)

console.log('\n== imposto ja lancado no ERP nessa competencia ==')
const l = await impostoLancado(s, p.competencia)
if (!l.length) console.log('  nada lancado')
for (const x of l) console.log(`  ${brl(x.valor).padStart(14)}  ${x.categoria}`)

console.log('\n== 5 maiores da provisao ==')
for (const c of p.clientes.slice(0, 5)) {
  console.log(`  ${brl(c.receita).padStart(14)}  anexo ${c.anexo.padEnd(3)} ${String(c.aliquota).padStart(5)}%  imposto ${brl(c.imposto).padStart(12)}  ${c.cliente.slice(0,30)}`)
}
await pool.end()
