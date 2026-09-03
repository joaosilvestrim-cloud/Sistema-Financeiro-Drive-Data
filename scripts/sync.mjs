// Roda uma sincronização na mão.
//
//   npm run sync -- --connection <uuid> --kind backfill
//   npm run sync                                   (todas as conexões vencidas)

import { pool } from '../src/db.mjs'
import { listDueConnections, listConnections } from '../src/connections.mjs'
import { syncConnection } from '../src/sync.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]])
    return acc
  }, []),
)

const kind = args.kind || 'incremental'
const alvos = args.connection
  ? [{ id: args.connection, nome: args.connection }]
  : await listDueConnections()

if (!alvos.length) {
  const todas = await listConnections()
  console.log(todas.length
    ? 'Nenhuma conexao vencida. Use --connection <uuid> para forcar.'
    : 'Nenhuma conexao cadastrada. Rode "npm run connect" primeiro.')
}

for (const conn of alvos) {
  const t0 = Date.now()
  try {
    const r = await syncConnection(conn.id, kind)
    console.log(`ok    ${conn.nome}  ${kind}  ${r.itens} itens em ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    console.log('      ' + JSON.stringify(r.detail))
  } catch (e) {
    console.error(`FALHA ${conn.nome}: ${e.message}`)
    process.exitCode = 1
  }
}

await pool.end()
