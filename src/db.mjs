import pg from 'pg'

// numeric volta como string por padrão no driver. Nesse produto todo numeric é
// dinheiro em escala 2, então converter para Number é seguro e evita erro bobo
// de somar string em relatório.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)))

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Faltou DATABASE_URL no .env')
  process.exit(1)
}

export const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 5),
  idleTimeoutMillis: 30_000,
})

export const query = (text, params) => pool.query(text, params)

export async function tx(fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const out = await fn(client)
    await client.query('commit')
    return out
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}

// Serializa por conexão. Usado na renovação do token, que não pode acontecer
// duas vezes em paralelo porque o refresh_token da Conta Azul rotaciona.
export async function withConnectionLock(connectionId, fn) {
  return tx(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [connectionId])
    return fn(client)
  })
}
