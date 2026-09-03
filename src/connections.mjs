import { query, withConnectionLock } from './db.mjs'
import { encrypt, decrypt } from './crypto.mjs'
import { refreshToken } from './oauth.mjs'
import { ContaAzulClient } from './contaazul.mjs'

const MARGEM_MS = 5 * 60 * 1000

export async function getConnection(id) {
  const { rows } = await query('select * from core.connection where id = $1', [id])
  if (!rows[0]) throw new Error(`conexao ${id} nao existe`)
  return rows[0]
}

export async function listConnections(tenantId) {
  const { rows } = tenantId
    ? await query('select * from core.connection where tenant_id = $1 order by nome', [tenantId])
    : await query('select * from core.connection order by nome')
  return rows
}

// Conexões que já passaram do próprio intervalo de sync.
export async function listDueConnections() {
  const { rows } = await query(`
    select * from core.connection
    where status = 'connected'
      and (last_sync_at is null
           or last_sync_at < now() - make_interval(mins => sync_interval_minutes))
    order by last_sync_at asc nulls first
  `)
  return rows
}

export async function createConnection({ tenantId, nome, provider = 'contaazul', tokens }) {
  const { rows } = await query(
    `insert into core.connection
       (tenant_id, provider, nome, access_token_enc, refresh_token_enc, token_expires_at)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [tenantId, provider, nome, encrypt(tokens.access_token), encrypt(tokens.refresh_token), tokens.expires_at],
  )
  return rows[0]
}

export async function setStatus(id, status, error = null) {
  await query(
    `update core.connection set status = $2, last_error = $3, updated_at = now() where id = $1`,
    [id, status, error],
  )
}

// Devolve um access_token válido para a conexão.
//
// Todo o caminho de renovação roda dentro de um advisory lock por conexão. Sem
// isso duas rotinas podem renovar ao mesmo tempo, e como o refresh_token da
// Conta Azul rotaciona, a segunda renovação invalida a primeira e a conexão
// morre. É o modo mais comum de quebrar uma integração dessas.
export async function accessTokenFor(connectionId) {
  return withConnectionLock(connectionId, async (client) => {
    const { rows } = await client.query(
      'select * from core.connection where id = $1 for update',
      [connectionId],
    )
    const conn = rows[0]
    if (!conn) throw new Error(`conexao ${connectionId} nao existe`)
    if (conn.status === 'revoked') throw new Error(`conexao ${conn.nome} foi revogada`)

    const expiraEm = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0
    if (conn.access_token_enc && expiraEm - Date.now() > MARGEM_MS) {
      return decrypt(conn.access_token_enc)
    }

    try {
      const renovado = await refreshToken({ refresh_token: decrypt(conn.refresh_token_enc) })
      await client.query(
        `update core.connection
            set access_token_enc = $2, refresh_token_enc = $3, token_expires_at = $4,
                status = 'connected', last_error = null, updated_at = now()
          where id = $1`,
        [connectionId, encrypt(renovado.access_token), encrypt(renovado.refresh_token), renovado.expires_at],
      )
      return renovado.access_token
    } catch (e) {
      // 400 no refresh quer dizer token morto. O cliente precisa reautorizar.
      const morto = e.status === 400 || e.status === 401
      await client.query(
        `update core.connection set status = $2, last_error = $3, updated_at = now() where id = $1`,
        [connectionId, morto ? 'expired' : 'error', e.message.slice(0, 500)],
      )
      throw e
    }
  })
}

export function clientFor(connectionId) {
  return new ContaAzulClient({ getToken: () => accessTokenFor(connectionId) })
}
