// Conecta uma empresa da Conta Azul a um tenant e guarda os tokens cifrados no banco.
//
//   npm run connect -- --tenant drivedata --nome "DriveData Matriz"
//
// Cada empresa é uma conexão. Um tenant pode ter quantas precisar, e cada uma
// tem o seu par de tokens, o seu watermark e a sua cota de rate limit.

import { pool, query } from '../src/db.mjs'
import { obtainTokensInteractive } from '../src/authFlow.mjs'
import { createConnection } from '../src/connections.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]])
    return acc
  }, []),
)

const slug = args.tenant || 'drivedata'
const nomeEmpresa = args.nome || 'Empresa principal'

const { rows } = await query(
  `insert into core.tenant (nome, slug) values ($1, $2)
   on conflict (slug) do update set nome = core.tenant.nome
   returning *`,
  [args['tenant-nome'] || slug, slug],
)
const tenant = rows[0]
console.log(`tenant: ${tenant.nome} (${tenant.id})`)

try {
  const tokens = await obtainTokensInteractive()
  const conn = await createConnection({ tenantId: tenant.id, nome: nomeEmpresa, tokens })
  console.log(`\nConexao criada: ${conn.nome} (${conn.id})`)
  console.log(`Carga inicial:  npm run sync -- --connection ${conn.id} --kind backfill`)
} catch (e) {
  console.error('\n' + e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
