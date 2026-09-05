// Confere a memoria da previsao contra o banco real.
import { pool, query } from '../src/db.mjs'
import { mudancas, resumoMudancas, cobertura } from '../lib/memoria.js'

const { rows: [t] } = await query('select id from core.tenant order by slug limit 1')
const s = { tenantId: t.id, connectionId: null }
const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const c = await cobertura(s)
console.log('== COBERTURA DO RASTRO ==')
console.log(`  desde ${String(c.desde).slice(0,24)} (${c.diasDeRastro} dias)`)
console.log(`  ${c.versoes} versoes, ${c.versoes_fechadas} fechadas`)
console.log(`  ${c.meses_observados} mes(es) de observacao -> comparacao mes a mes ${c.comparavel ? 'JA VALE' : 'ainda nao vale'}`)

const r = await resumoMudancas(s)
console.log('\n== O QUE MUDOU DESDE QUE COMECAMOS A OLHAR ==')
console.log(`  ${r.total} parcela(s) mudaram`)
console.log(`  ${r.adiadas} adiadas (media de ${r.media_dias_adiados} dias), ${r.antecipadas} antecipadas`)
console.log(`  ${r.valor_mudou} mudaram de valor, ${r.status_mudou} mudaram de situacao`)
console.log(`  efeito no valor: ${brl(r.soma_delta)}  (receber ${brl(r.delta_receber)}, pagar ${brl(r.delta_pagar)})`)

const m = await mudancas(s, 10)
console.log('\n== AS 10 MAIORES MUDANCAS ==')
for (const x of m) {
  const dias = Number(x.dias_deslocados ?? 0)
  const dv = Number(x.delta_valor ?? 0)
  const partes = []
  if (dias) partes.push(dias > 0 ? `adiou ${dias}d` : `antecipou ${-dias}d`)
  if (dv) partes.push(`${dv > 0 ? '+' : ''}${brl(dv)}`)
  if (x.status_antes !== x.status_agora) partes.push(`${x.status_antes} -> ${x.status_agora}`)
  console.log(`  ${x.kind === 'receivable' ? 'receber' : 'pagar  '} ${brl(x.valor_agora).padStart(14)}  ${partes.join(', ').padEnd(34)} ${String(x.pessoa).slice(0,26)}`)
}
await pool.end()
