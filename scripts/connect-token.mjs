// Cria uma conexão a partir de um access_token colado, sem passar pelo fluxo
// OAuth completo.
//
//   npm run connect-token -- --tenant drivedata --nome "DriveData" --token "eyJ..."
//   npm run connect-token -- ... --token-file caminho.txt
//
// Existe por um motivo prático: o portal do desenvolvedor já entrega um
// access_token pronto para teste, e com ele dá para validar a ingestão inteira
// antes de amarrar o login no navegador. A conexão nasce sem refresh_token,
// então ela expira em uma hora e não serve para produção. Depois de rodar o
// fluxo completo com `npm run connect`, a mesma conexão passa a se renovar
// sozinha.

import { pool, query } from '../src/db.mjs'
import { encrypt } from '../src/crypto.mjs'
import { readFileSync } from 'node:fs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]])
    return acc
  }, []),
)

const token = args['token-file'] ? readFileSync(args['token-file'], 'utf8').trim() : args.token
if (!token) {
  console.error('uso: npm run connect-token -- --tenant <slug> --nome "<empresa>" --token "<access_token>"')
  await pool.end()
  process.exit(1)
}

const slug = args.tenant || 'drivedata'
const nome = args.nome || 'Empresa principal'

// O token é um JWT. O corpo diz quando expira e qual conta do ERP autorizou,
// o que evita cadastrar uma conexão já vencida sem perceber.
let expiraEm = new Date(Date.now() + 3600_000)
let usuario = null
try {
  const corpo = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  if (corpo.exp) expiraEm = new Date(corpo.exp * 1000)
  usuario = corpo.username ?? null
} catch { /* token opaco, seguimos com uma hora */ }

const restam = Math.round((expiraEm - Date.now()) / 60000)
if (restam <= 0) {
  console.error(`token ja expirou em ${expiraEm.toISOString()}. Gere outro no portal.`)
  await pool.end()
  process.exit(1)
}

const { rows: [tenant] } = await query(
  `insert into core.tenant (nome, slug) values ($1, $2)
   on conflict (slug) do update set nome = core.tenant.nome returning *`,
  [args['tenant-nome'] || nome, slug],
)

const { rows: [conn] } = await query(
  `insert into core.connection
     (tenant_id, provider, nome, external_company_id, access_token_enc, token_expires_at, status)
   values ($1, 'contaazul', $2, $3, $4, $5, 'connected')
   on conflict (tenant_id, provider, external_company_id) do update
     set access_token_enc = excluded.access_token_enc,
         token_expires_at = excluded.token_expires_at,
         status = 'connected', last_error = null, updated_at = now()
   returning *`,
  [tenant.id, nome, usuario ?? nome, encrypt(token), expiraEm.toISOString()],
)

console.log(`tenant   ${tenant.nome} (${tenant.slug})`)
console.log(`conexao  ${conn.nome}  ${conn.id}`)
console.log(`token    valido por mais ${restam} min${usuario ? `, conta ${usuario}` : ''}`)
console.log(`\nCarga inicial:\n  npm run sync -- --connection ${conn.id} --kind backfill`)
await pool.end()
