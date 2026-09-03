import 'server-only'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { supabaseServer } from './supabase'
import { q, q1 } from './db'

// Resolve quem está logado, a que tenant pertence e qual empresa está
// selecionada. Toda consulta do dashboard passa por aqui e filtra por
// tenant_id, então uma tela nunca enxerga dado de outro cliente.
export async function requireSession() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const membro = await q1(
    `select m.tenant_id, m.role, t.nome, t.slug
       from core.tenant_member m
       join core.tenant t on t.id = m.tenant_id
      where m.user_id = $1
      order by t.nome
      limit 1`,
    [user.id],
  )
  if (!membro) redirect('/login?erro=sem-acesso')

  const conexoes = await q(
    `select id, nome, status, last_sync_at, sync_interval_minutes
       from core.connection where tenant_id = $1 order by nome`,
    [membro.tenant_id],
  )

  const store = await cookies()
  const escolhida = store.get('empresa')?.value
  const connectionId = conexoes.some((c) => c.id === escolhida) ? escolhida : null

  return {
    user,
    tenantId: membro.tenant_id,
    tenantNome: membro.nome,
    role: membro.role,
    conexoes,
    // null quer dizer consolidado, somando todas as empresas do tenant.
    connectionId,
  }
}

// Fragmento de filtro reaproveitado por todas as consultas.
export function escopo(sessao, alias = '') {
  const p = alias ? `${alias}.` : ''
  const params = [sessao.tenantId]
  let where = `${p}tenant_id = $1`
  if (sessao.connectionId) {
    params.push(sessao.connectionId)
    where += ` and ${p}connection_id = $2`
  }
  return { where, params }
}
