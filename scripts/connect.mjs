// Conecta uma empresa da Conta Azul a um tenant e guarda os tokens cifrados.
//
//   npm run connect -- --tenant drivedata --nome "DriveData"
//
// Cada empresa é uma conexão, com seu par de tokens, seu watermark e sua cota
// de rate limit. Reautorizar a mesma empresa atualiza a conexão existente em
// vez de criar outra: a identidade vem do próprio token, não do nome digitado.

import { pool, query } from '../src/db.mjs'
import { obtainTokensInteractive } from '../src/authFlow.mjs'
import { encrypt } from '../src/crypto.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]])
    return acc
  }, []),
)

const slug = args.tenant || 'drivedata'
const nomeEmpresa = args.nome || 'Empresa principal'

// Quem é a empresa autorizada sai do corpo do access_token, que é um JWT.
// Sem isso, reautorizar criaria uma conexão nova a cada vez e o mesmo dado
// entraria duas vezes, em duas conexões diferentes.
function identidade(accessToken) {
  try {
    const corpo = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString())
    return { id: corpo.username ?? corpo.sub ?? null, expiraEm: corpo.exp ? new Date(corpo.exp * 1000) : null }
  } catch {
    return { id: null, expiraEm: null }
  }
}

const { rows: [tenant] } = await query(
  `insert into core.tenant (nome, slug) values ($1, $2)
   on conflict (slug) do update set nome = core.tenant.nome
   returning *`,
  [args['tenant-nome'] || nomeEmpresa, slug],
)
console.log(`tenant: ${tenant.nome} (${tenant.id})`)

const jaExistem = await query(
  `select nome, external_company_id from core.connection where tenant_id = $1`, [tenant.id],
)
if (jaExistem.rows.length) {
  console.log('conexoes ja cadastradas neste tenant:')
  for (const c of jaExistem.rows) console.log(`  - ${c.nome}  ${c.external_company_id ?? ''}`)
  console.log('')
}

try {
  const tokens = await obtainTokensInteractive()
  const quem = identidade(tokens.access_token)

  const { rows: [conn] } = await query(
    `insert into core.connection
       (tenant_id, provider, nome, external_company_id,
        access_token_enc, refresh_token_enc, token_expires_at, status, last_error)
     values ($1, 'contaazul', $2, $3, $4, $5, $6, 'connected', null)
     on conflict (tenant_id, provider, external_company_id) do update
       set nome = excluded.nome,
           access_token_enc = excluded.access_token_enc,
           refresh_token_enc = excluded.refresh_token_enc,
           token_expires_at = excluded.token_expires_at,
           status = 'connected', last_error = null, updated_at = now()
     returning *, (xmax = 0) as criada`,
    [
      tenant.id, nomeEmpresa, quem.id,
      encrypt(tokens.access_token), encrypt(tokens.refresh_token),
      tokens.expires_at,
    ],
  )

  console.log(`\n${conn.criada ? 'Conexao criada' : 'Conexao atualizada'}: ${conn.nome}`)
  console.log(`id       ${conn.id}`)
  console.log(`conta    ${quem.id ?? 'nao identificada no token'}`)
  console.log(`token    valido ate ${tokens.expires_at}`)
  console.log(`renova   ${tokens.refresh_token ? 'sim, refresh_token guardado' : 'NAO, sem refresh_token'}`)
  console.log(`\nCarga inicial:\n  npm run sync -- --connection ${conn.id} --kind backfill`)
} catch (e) {
  console.error('\n' + e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
