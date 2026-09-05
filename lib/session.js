import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { supabaseServer } from './supabase'
import { q1 } from './db'

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
            t.plano, t.status, t.trial_ate, t.acesso_ate, t.limite_empresas, t.ia_habilitada,
            -- Prazo contado no relogio do banco. Ver lib/conta.js: misturar o
            -- relogio do servidor com o do banco fazia 14 dias virar 15.
            ceil(extract(epoch from (t.trial_ate - now())) / 86400)::int as dias_restantes,
            t.trial_ate is not null and t.trial_ate <= now()             as teste_vencido,
            t.acesso_ate is not null and t.acesso_ate > now()            as acesso_pago,
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
  // Usuario autenticado e sem vinculo e alguem que acabou de se cadastrar. O
  // lugar dele e o onboarding, que cria o tenant, e nao uma mensagem de erro.
  if (!membro) redirect('/bem-vindo')

  const conexoes = membro.conexoes ?? []

  // Situacao comercial junto da sessao, e nao numa segunda consulta. Toda tela
  // do painel precisa dela, e com o banco em outra regiao uma ida a mais por
  // clique aparece no relogio.
  const conta = situacao(membro, conexoes)

  // Porta unica do produto pago. Teste vencido ou assinatura fora do ar caem
  // aqui, em vez de cada tela ter que lembrar de checar por conta propria.
  if (conta.bloqueado) redirect('/assinar')

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
    // Situacao comercial. Faltou aqui por um tempo e derrubou o painel inteiro
    // em producao: as telas liam sessao.conta e recebiam undefined. Local
    // parecia funcionar porque a pagina e transmitida em pedacos, entao o
    // navegador ja tinha recebido 200 e a casca antes de o componente quebrar.
    conta,
  }
})

export { escopo } from './escopo.js'

// Traduz plano, status e prazo nas duas perguntas que a tela sabe fazer: ainda
// pode usar, e quanto tempo falta.
function situacao(membro, conexoes) {
  const emTeste = membro.plano === 'trial' && !!membro.trial_ate
  // Arredondado para cima no banco. No ultimo dia a tela diz um dia, nao zero.
  // O calculo mora no SQL porque o relogio do servidor e o do banco nao batem,
  // e contar prazo com dois relogios ja fez um teste de 14 dias virar 15.
  const diasRestantes = emTeste ? Math.max(0, membro.dias_restantes) : null
  const testeVencido = emTeste && membro.teste_vencido

  // Acesso ja pago vale ate o fim do ciclo, mesmo depois de cancelar ou de um
  // pagamento falhar. Cortar na hora puniria quem so teve o cartao recusado.
  const acessoPago = membro.acesso_pago
  const conectadas = conexoes.filter((c) => c.status === 'connected').length

  return {
    plano: membro.plano,
    iaHabilitada: membro.ia_habilitada,
    status: membro.status,
    emTeste,
    diasRestantes,
    testeVencido,
    limiteEmpresas: membro.limite_empresas,
    empresasConectadas: conectadas,
    podeConectarMais: conectadas < membro.limite_empresas,
    bloqueado: (membro.status !== 'ativo' || testeVencido) && !acessoPago,
  }
}
