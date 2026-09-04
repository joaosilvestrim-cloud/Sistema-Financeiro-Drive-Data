import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { garantirConta, assinatura } from '@/lib/conta'
import { criarState } from '@/lib/oauthState'
import { buildAuthorizeUrl } from '@/src/oauth.mjs'
import Marca from '@/components/Marca'

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

  return (
    <div style={{ maxWidth: 660, margin: '0 auto', padding: '48px 20px' }}>
      <Marca tamanho={38} />

      <h1 style={{ marginTop: 28, marginBottom: 8 }}>
        Falta um passo, {conta?.nome}
      </h1>
      <p style={{ fontSize: 15, color: 'var(--text-secondary)', marginTop: 0 }}>
        Autorize o DriveAzul a ler o seu Conta Azul. A partir daí a gente traz
        três anos de histórico e monta tudo sozinho. Seu teste de{' '}
        {conta?.diasRestantes} dias já está rodando.
      </p>

      <div className="card" style={{ marginTop: 24 }}>
        <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 14 }}>
          <li>
            <strong>Autorizar.</strong> Você entra na sua conta do Conta Azul e
            confirma o acesso. Nós nunca vemos a sua senha.
          </li>
          <li>
            <strong>Esperar a carga.</strong> Trazemos contas, categorias,
            centros de custo, parcelas e baixas dos últimos 36 meses. Pode fechar
            a aba, continua rodando.
          </li>
          <li>
            <strong>Olhar os números.</strong> Saldo, a receber, a pagar, fôlego
            de caixa e a análise de cada indicador.
          </li>
        </ol>

        <form action={conectar} style={{ marginTop: 22 }}>
          <button className="btn" type="submit">Conectar meu Conta Azul</button>
        </form>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
          Só funciona com o plano Conta Azul Pro, que é o único com API. Acesso
          somente de leitura do financeiro, e você revoga quando quiser dentro do
          próprio Conta Azul.
        </p>
      </div>
    </div>
  )
}
