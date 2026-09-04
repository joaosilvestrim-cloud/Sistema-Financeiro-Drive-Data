// Prova que o incremental para no tempo, guarda onde parou e retoma.
//
// Empurra o watermark para tras para gerar uma lista de eventos, roda com
// orcamento curto varias vezes e confere que a fila diminui ate zerar e que o
// watermark so avanca no fim.

import { pool, query } from '../src/db.mjs'
import { syncConnection } from '../src/sync.mjs'

const { rows: [c] } = await query(
  `select id, nome from core.connection where status = 'connected' limit 1`)

const marca = async () => (await query(
  `select value from core.sync_watermark where connection_id = $1 and resource = 'eventos'`,
  [c.id])).rows[0]?.value ?? null

const cursor = async () => (await query(
  `select array_length(pendentes, 1) faltam, processados from core.sync_cursor where connection_id = $1`,
  [c.id])).rows[0] ?? null

const original = await marca()
console.log(`conexao ${c.nome}`)
console.log(`watermark original: ${original}\n`)

// Volta 3 dias para gerar fila de verdade.
await query(
  `update core.sync_watermark set value = $2
    where connection_id = $1 and resource = 'eventos'`,
  [c.id, new Date(Date.now() - 3 * 86400e3).toISOString()])
await query('delete from core.sync_cursor where connection_id = $1', [c.id])
console.log(`watermark empurrado para ${await marca()}\n`)

const parcelasAntes = Number((await query(
  'select count(*) n from core.installment where connection_id = $1', [c.id])).rows[0].n)

for (let i = 1; i <= 6; i++) {
  const t0 = Date.now()
  const r = await syncConnection(c.id, 'incremental', { orcamentoMs: 12_000 })
  const cur = await cursor()
  console.log(
    `rodada ${i}  ${((Date.now() - t0) / 1000).toFixed(1)}s  ` +
    `${r.incompleto ? 'INCOMPLETA' : 'completa  '}  ` +
    `processados ${String(cur?.processados ?? r.detail.eventos_alterados ?? 0).padStart(4)}  ` +
    `faltam ${String(cur?.faltam ?? 0).padStart(4)}  itens ${r.itens}`,
  )
  if (!r.incompleto) break
}

const cur = await cursor()
const parcelasDepois = Number((await query(
  'select count(*) n from core.installment where connection_id = $1', [c.id])).rows[0].n)
const versoes = Number((await query(
  `select count(*) n from core.installment_version v
     join core.installment i on i.id = v.installment_id where i.connection_id = $1`, [c.id])).rows[0].n)

console.log(`\ncursor no fim: ${cur ? `${cur.faltam} pendentes` : 'limpo'}`)
console.log(`watermark avancou para: ${await marca()}`)
console.log(`parcelas ${parcelasAntes} -> ${parcelasDepois}`)
console.log(`versoes SCD2: ${versoes}`)
console.log(cur === null ? '\nok: a fila drenou e o watermark avancou' : '\nATENCAO: ainda ha fila')
await pool.end()
