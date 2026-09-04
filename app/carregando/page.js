import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/session'
import { q1 } from '@/lib/db'
import ProgressoCarga from '@/components/ProgressoCarga'
import Marca from '@/components/Marca'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Carregando · DriveAzul' }

// Tela da primeira carga. Fica fora do painel de propósito: quem está aqui
// ainda não tem número para ver, e um menu cheio de telas vazias passaria a
// impressão errada logo no primeiro minuto.

export default async function Carregando({ searchParams }) {
  const sessao = await requireSession()
  const busca = await searchParams

  const conexao = await q1(
    `select c.id, c.nome
       from core.connection c
       join core.onboarding_job j on j.connection_id = c.id
      where c.tenant_id = $1
        and ($2::uuid is null or c.id = $2::uuid)
        and j.status <> 'concluido'
      order by j.criado_em desc
      limit 1`,
    [sessao.tenantId, busca?.conexao ?? null],
  )

  // Sem carga pendente não há o que esperar.
  if (!conexao) redirect('/')

  return (
    <div style={{ maxWidth: 660, margin: '0 auto', padding: '48px 20px' }}>
      <Marca tamanho={38} />
      <h1 style={{ marginTop: 28, marginBottom: 8 }}>Trazendo seus dados</h1>
      <p style={{ fontSize: 15, color: 'var(--text-secondary)', marginTop: 0 }}>
        Estamos lendo 36 meses de histórico do seu Conta Azul. Leva alguns
        minutos e acontece uma vez só. Depois disso a atualização é automática e
        traz apenas o que mudou.
      </p>

      <ProgressoCarga conexaoId={conexao.id} nome={conexao.nome} />
    </div>
  )
}
