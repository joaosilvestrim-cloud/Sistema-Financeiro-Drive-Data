import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { supabaseServer } from './supabase'
import { q, q1 } from './db'

// Resolve quem está logado, a que tenant pertence e qual empresa está
// selecionada. Toda consulta do dashboard passa por aqui e filtra por
// tenant_id, então uma tela nunca enxerga dado de outro cliente.
// Envolvido em cache() do React: dentro de uma mesma requisicao, o layout e a
// pagina chamam isto de forma independente, e sem a memoizacao cada navegacao
// pagava duas vezes a validacao da sessao e as duas consultas de tenant. Com o
// banco em outra regiao isso sozinho custava quase meio segundo por clique.
export const requireSession = cache(async function requireSession() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Uma consulta só. Eram duas em sequência, e com o banco em outra região cada
  // ida e volta pesa muito mais do que o trabalho que o banco faz de fato.
  const membro = await q1(
    `select m.tenant_id, m.role, t.nome, t.slug,
            coalesce((
              select json_agg(json_build_object(
                       'id', c.id, 'nome', c.nome, 'status', c.status,
                       'last_sync_at', c.last_sync_at,
                       'sync_interval_minutes', c.sync_interval_minutes)
                     order by c.nome)
                from core.connection c where c.tenant_id = m.tenant_id
            ), '[]'::json) as conexoes
       from core.tenant_member m
       join core.tenant t on t.id = m.tenant_id
      where m.user_id = $1
      order by t.nome
      limit 1`,
    [user.id],
  )
  if (!membro) redirect('/login?erro=sem-acesso')

  const conexoes = membro.conexoes ?? []

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
})

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
