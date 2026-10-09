import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { q1 } from '@/lib/db'
import { comAviso } from '@/lib/acao'
import { definirPeriodo, estimarCarga, MESES_FRENTE } from '@/src/carga.mjs'
import ProgressoCarga from '@/components/ProgressoCarga'
import EscolhaPeriodo from '@/components/EscolhaPeriodo'
import TelaAcesso from '@/components/TelaAcesso'
import Aviso from '@/components/Aviso'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Carregando · DriveAzul' }

// Tela da primeira carga. Fica fora do painel de propósito: quem está aqui
// ainda não tem número para ver, e um menu cheio de telas vazias passaria a
// impressão errada logo no primeiro minuto.
//
// Duas fases. Antes de começar, a pessoa escolhe quanto histórico trazer,
// vendo o tempo de cada opção calculado com o volume da empresa dela. Depois,
// a barra de progresso.

export default async function Carregando({ searchParams }) {
  const sessao = await requireSession()
  const busca = await searchParams

  const conexao = await q1(
    `select c.id, c.nome, j.meses_atras, j.meses_frente
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

  if (conexao.meses_atras == null) {
    const estimativa = await estimarCarga(conexao.id)

    async function escolher(formData) {
      'use server'
      const rota = `/carregando?conexao=${conexao.id}`
      await comAviso(rota, async () => {
        const s = await requireSession()
        await definirPeriodo(conexao.id, s.tenantId, Number(formData.get('meses')))
        revalidatePath('/carregando')
      })
      redirect(rota)
    }

    return (
      <TelaAcesso
        largo
        titulo="Quanto histórico trazer?"
        subtitulo={`${conexao.nome} está conectada. Escolha quantos meses para trás vamos ler do seu Conta Azul. Quanto mais histórico, mais o painel compara, e mais tempo a carga leva. Acontece uma vez só.`}
      >
        <Aviso erro={busca?.erro ?? null} titulo="Não foi possível começar" />
        <EscolhaPeriodo acao={escolher} estimativa={estimativa} />
      </TelaAcesso>
    )
  }

  return (
    <TelaAcesso
      largo
      titulo="Trazendo seus dados."
      subtitulo={`Estamos lendo ${conexao.meses_atras} meses de histórico do seu Conta Azul e os vencimentos dos próximos ${conexao.meses_frente ?? MESES_FRENTE} meses. Acontece uma vez só. Depois disso a atualização é automática e traz apenas o que mudou.`}
    >
      <ProgressoCarga conexaoId={conexao.id} nome={conexao.nome} />
    </TelaAcesso>
  )
}
