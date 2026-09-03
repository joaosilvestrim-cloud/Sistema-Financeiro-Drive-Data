import 'server-only'
import pg from 'pg'

pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)))

// Em serverless, cada instância abre poucas conexões e elas somam rápido. Por
// isso o app usa o pooler em modo transação (porta 6543) quando disponível, e
// o worker fica com a conexão em modo sessão.
const connectionString = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL

const globalForPg = globalThis
export const pool = globalForPg.__pgPool ?? new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX_APP || 3),
  idleTimeoutMillis: 20_000,
})
if (!globalForPg.__pgPool) globalForPg.__pgPool = pool

export async function q(text, params) {
  const { rows } = await pool.query(text, params)
  return rows
}

export async function q1(text, params) {
  const rows = await q(text, params)
  return rows[0] ?? null
}
