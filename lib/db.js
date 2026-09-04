import 'server-only'
import pg from 'pg'

pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)))

// Em serverless cada instância abre suas próprias conexões e elas somam rápido.
// Por isso o app usa o pooler em modo transação (porta 6543, usuário
// postgres.<ref>) e o worker fica com o modo sessão. Ver docs/DEPLOY.md.
function connectionString() {
  const url = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'Falta DATABASE_URL (ou DATABASE_URL_POOLED) no ambiente. ' +
      'Cadastre a variável no projeto e refaça o deploy. Ver docs/DEPLOY.md.',
    )
  }
  return url
}

// Criado sob demanda. Se a variável faltar, o erro aparece na requisição com a
// mensagem acima, em vez de derrubar o processo durante o build.
const globalForPg = globalThis
function getPool() {
  if (!globalForPg.__pgPool) {
    globalForPg.__pgPool = new pg.Pool({
      connectionString: connectionString(),
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX_APP || 3),
      idleTimeoutMillis: 20_000,
    })
  }
  return globalForPg.__pgPool
}

export async function q(text, params) {
  const { rows } = await getPool().query(text, params)
  return rows
}

export async function q1(text, params) {
  const rows = await q(text, params)
  return rows[0] ?? null
}
