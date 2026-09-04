// Confere as consultas do resumo executivo contra o banco real.
import { pool, query } from '../src/db.mjs'
import { conciliacao, agingDuplo, duasSemanas, dezMaiores } from '../lib/executivo.js'

const { rows: [t] } = await query('select id, nome from core.tenant order by slug limit 1')
const sessao = { tenantId: t.id, connectionId: null }
const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const c = await conciliacao(sessao)
console.log('== CONCILIACAO ==')
console.log(`  ${c.conciliadas} conciliadas, ${c.pendentes} pendentes (${c.percentualConciliado}% em dia)`)
console.log(`  ${brl(c.valor_pendente)} sem conferir contra o banco`)
console.log(`  ultima conciliacao: ${String(c.ultima_conciliacao).slice(0, 10)}`)
console.log(`  mais antiga pendente: ${String(c.mais_antiga_pendente).slice(0, 10)} (${c.diasParados} dias)`)
for (const f of c.faixas) console.log(`    ${f.faixa.padEnd(8)} ${String(f.titulos).padStart(4)}  ${brl(f.valor)}`)

const a = await agingDuplo(sessao)
console.log('\n== AGING ==')
for (const [nome, linhas] of [['a receber', a.receber], ['a pagar', a.pagar]]) {
  console.log(`  ${nome}:`)
  for (const l of linhas) console.log(`    ${l.faixa.padEnd(10)} ${String(l.titulos).padStart(4)}  ${brl(l.valor)}`)
}

const s = await duasSemanas(sessao)
console.log('\n== DUAS SEMANAS ==')
console.log(`  saldo hoje ${brl(s.saldoHoje)}`)
for (const d of s.serie) {
  const marca = d.hoje ? '<< hoje' : d.passado ? '' : ''
  console.log(`  ${d.dia} ${d.semana.padEnd(8)} entra ${brl(d.entradas).padStart(14)}  sai ${brl(d.saidas).padStart(14)}  saldo ${brl(d.saldo).padStart(15)} ${marca}`)
}
console.log(`  menor saldo: ${brl(s.menor.saldo)} em ${s.menor.dia}`)
console.log(`  vira negativo: ${s.diaNegativo ? s.diaNegativo.dia : 'nao'}`)

for (const kind of ['receivable', 'payable']) {
  const m = await dezMaiores(sessao, kind)
  console.log(`\n== 10 MAIORES ${kind} ==`)
  for (const x of m) console.log(`  ${brl(x.em_aberto).padStart(14)}  vencido ${brl(x.vencido).padStart(13)}  ${x.nome.slice(0, 42)}`)
}

await pool.end()
