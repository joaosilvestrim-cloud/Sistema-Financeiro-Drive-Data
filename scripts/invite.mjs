// Cria (ou reaproveita) um usuário no Supabase Auth e o vincula a um tenant.
//
//   npm run invite -- --email joao@drivedata.com.br --senha "..." --tenant _demo --role owner
//
// Usa a service_role, então roda só na sua máquina ou no worker, nunca no
// navegador.

import { createClient } from '@supabase/supabase-js'
import { pool, query } from '../src/db.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]])
    return acc
  }, []),
)

const email = args.email
const senha = args.senha
const slug = args.tenant || '_demo'
const role = args.role || 'owner'

if (!email || !senha) {
  console.error('uso: npm run invite -- --email <email> --senha <senha> [--tenant <slug>] [--role owner|financeiro|leitura|contador]')
  process.exit(1)
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const tenant = (await query('select id, nome from core.tenant where slug = $1', [slug])).rows[0]
if (!tenant) {
  console.error(`tenant ${slug} nao existe`)
  await pool.end()
  process.exit(1)
}

let userId
const criado = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
if (criado.error) {
  if (!/already/i.test(criado.error.message)) {
    console.error(criado.error.message)
    await pool.end()
    process.exit(1)
  }
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id
  if (!userId) {
    console.error('usuario ja existe mas nao foi encontrado na listagem')
    await pool.end()
    process.exit(1)
  }
  console.log('usuario ja existia, apenas vinculando')
} else {
  userId = criado.data.user.id
  console.log('usuario criado')
}

await query(
  `insert into core.tenant_member (tenant_id, user_id, role) values ($1, $2, $3)
   on conflict (tenant_id, user_id) do update set role = excluded.role`,
  [tenant.id, userId, role],
)

console.log(`${email} vinculado a ${tenant.nome} como ${role}`)
await pool.end()
