import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { garantirConta, assinatura } from '@/lib/conta'
import { criarState } from '@/lib/oauthState'
import { buildAuthorizeUrl } from '@/src/oauth.mjs'
import TelaAcesso from '@/components/TelaAcesso'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Bem-vindo · DriveAzul' }

// Primeiro acesso. Aqui o tenant nasce e o teste começa a contar.
//
// Esta página não usa requireSession de propósito: quem chega aqui ainda não
// tem vínculo com empresa nenhuma, e o requireSession justamente manda para cá
// quem está nessa situação. Usar os dois criaria um laço de redirecionamento.

export default async function BemVindo() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { tenantId } = await garantirConta(user)
  const conta = await assinatura(tenantId)

  // Quem já conectou não precisa mais desta tela.
  if (conta?.empresas > 0) redirect('/')

  async function conectar() {
    'use server'
    const s = await supabaseServer()
    const { data: { user: u } } = await s.auth.getUser()
    if (!u) redirect('/login')
    const { tenantId } = await garantirConta(u)
    redirect(buildAuthorizeUrl(criarState(tenantId)))
  }

  const PASSOS = [
    ['Autorizar', 'Você entra na sua conta do Conta Azul e confirma o acesso. Nós nunca vemos a sua senha.'],
    ['Esperar a carga', 'Trazemos contas, categorias, centros de custo, parcelas e baixas dos últimos 36 meses. Pode fechar a aba, continua rodando.'],
    ['Olhar os números', 'Saldo, a receber, a pagar, fôlego de caixa e a leitura de cada indicador.'],
  ]

  return (
    <TelaAcesso
      largo
      titulo={`Falta um passo, ${conta?.nome}.`}
      subtitulo={`Autorize o DriveAzul a ler o seu Conta Azul. A partir daí a gente traz três anos de histórico e monta tudo sozinho. Seu teste de ${conta?.diasRestantes} dias já está rodando.`}
    >
      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {PASSOS.map(([titulo, texto], i) => (
          <li key={titulo} style={{
            display: 'grid', gridTemplateColumns: '44px 1fr', padding: '18px 0',
            borderTop: '1px solid var(--axis)',
          }}>
            <span style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 13, color: 'var(--text-muted)', paddingTop: 4,
            }}>{String(i + 1).padStart(2, '0')}</span>
            <span style={{ fontSize: 16, lineHeight: 1.55 }}>
              <strong style={{ color: 'var(--text-primary)', fontSize: 18, letterSpacing: '-0.02em' }}>{titulo}.</strong>{' '}
              {texto}
            </span>
          </li>
        ))}
      </ol>

      <form action={conectar} style={{ marginTop: 22, display: 'block' }}>
        <button className="btn" type="submit" style={{ width: 'auto', padding: '14px 30px' }}>
          Conectar meu Conta Azul
        </button>
      </form>

      <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text-muted)', marginTop: 18, marginBottom: 0 }}>
        Só funciona com o plano Conta Azul Pro, que é o único com API. O painel
        lê o financeiro, nada é alterado no seu Conta Azul sem você mandar, e
        você revoga o acesso quando quiser dentro do próprio Conta Azul.
      </p>
    </TelaAcesso>
  )
}
