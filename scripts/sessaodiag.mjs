// Cria um usuario temporario, pega um token e imprime o cookie de sessao.
import { pool, query } from '../src/db.mjs'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const EMAIL = 'diagnostico@driveazul.local'
const SENHA = 'Diagn0stico!' + Math.random().toString(36).slice(2, 8)

const admin = (path, opts = {}) => fetch(`${URL}/auth/v1/admin${path}`, {
  ...opts,
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
})

// Remove sobra de execucao anterior.
const lista = await (await admin('/users?per_page=200')).json()
for (const u of lista.users ?? []) {
  if (u.email === EMAIL) await admin(`/users/${u.id}`, { method: 'DELETE' })
}

const criado = await (await admin('/users', {
  method: 'POST',
  body: JSON.stringify({ email: EMAIL, password: SENHA, email_confirm: true }),
})).json()
if (!criado.id) { console.error('nao criou:', JSON.stringify(criado).slice(0, 300)); await pool.end(); process.exit(1) }

const { rows: [t] } = await query('select id from core.tenant order by slug limit 1')
await query(
  `insert into core.tenant_member (tenant_id, user_id, role) values ($1, $2, 'owner')
   on conflict do nothing`, [t.id, criado.id])

const login = await (await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: SENHA }),
})).json()

if (!login.access_token) { console.error('nao logou:', JSON.stringify(login).slice(0, 300)); await pool.end(); process.exit(1) }

const ref = URL.replace('https://', '').split('.')[0]
const valor = Buffer.from(JSON.stringify(login)).toString('base64')
console.log(`USERID=${criado.id}`)
console.log(`COOKIE=sb-${ref}-auth-token=base64-${valor}`)
await pool.end()
