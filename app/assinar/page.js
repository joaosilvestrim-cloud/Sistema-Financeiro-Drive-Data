import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { supabaseServer } from '@/lib/supabase'
import { garantirConta, assinatura } from '@/lib/conta'
import { PLANOS, registrarIntencao } from '@/lib/assinaturaEstado'
import Marca from '@/components/Marca'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Planos · DriveAzul' }

// Tela de planos e fim de teste.
//
// Não usa requireSession de propósito: é justamente para cá que o
// requireSession manda quem está bloqueado, e usar os dois criaria um laço.
//
// Enquanto não existe gateway, o botão registra a intenção. Quando o gateway
// entrar, o mesmo botão passa a redirecionar para o checkout, e nada mais nesta
// tela muda.

export default async function Assinar({ searchParams }) {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { tenantId } = await garantirConta(user)
  const conta = await assinatura(tenantId)
  const busca = await searchParams

  async function escolher(formData) {
    'use server'
    const s = await supabaseServer()
    const { data: { user: u } } = await s.auth.getUser()
    if (!u) redirect('/login')
    const { tenantId: t } = await garantirConta(u)
    const plano = String(formData.get('plano'))
    await registrarIntencao(t, plano)
    revalidatePath('/assinar')
    redirect(`/assinar?escolhido=${plano}`)
  }

  const bloqueado = conta && conta.status !== 'ativo' || conta?.testeVencido
  const escolhido = busca?.escolhido

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '48px 20px' }}>
      <Marca tamanho={38} />

      <h1 style={{ marginTop: 28, marginBottom: 8 }}>
        {bloqueado ? 'Seu acesso está pausado' : 'Planos'}
      </h1>
      <p style={{ fontSize: 15, color: 'var(--text-secondary)', marginTop: 0, maxWidth: 620 }}>
        {bloqueado
          ? 'Seus dados continuam aqui, inteiros. Escolha um plano e o painel volta no mesmo lugar onde parou.'
          : `Você está em teste${conta?.diasRestantes != null ? `, faltam ${conta.diasRestantes} dias` : ''}.`}
      </p>

      {escolhido && PLANOS[escolhido] && (
        <p style={{
          background: 'color-mix(in srgb, var(--good) 12%, transparent)',
          border: '1px solid var(--good)', borderRadius: 8, padding: '10px 14px',
          fontSize: 13, maxWidth: 620,
        }}>
          <strong>Plano {PLANOS[escolhido].nome} anotado.</strong> O pagamento
          online ainda está sendo ligado. Fale com a gente em{' '}
          <a href="mailto:financeiro@drivedata.com.br">financeiro@drivedata.com.br</a>{' '}
          e liberamos seu acesso hoje mesmo.
        </p>
      )}

      <div className="grid cols-3" style={{ marginTop: 24, alignItems: 'stretch' }}>
        {Object.entries(PLANOS).map(([chave, p]) => (
          <div className="card" key={chave} style={{ display: 'flex', flexDirection: 'column' }}>
            <h2>{p.nome}</h2>
            <div style={{ fontSize: 30, fontWeight: 600, marginTop: 4 }}>
              R$ {p.preco}
              <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' }}>/mês</span>
            </div>
            <p className="sub" style={{ marginTop: 4 }}>
              {p.empresas} {p.empresas === 1 ? 'empresa' : 'empresas'}
              {p.precoPorEmpresaExtra && `, depois R$ ${p.precoPorEmpresaExtra} por empresa`}
            </p>

            <ul style={{
              fontSize: 13, color: 'var(--text-secondary)', paddingLeft: 18,
              display: 'grid', gap: 6, flex: 1,
            }}>
              {p.itens.map((i, k) => <li key={k}>{i}</li>)}
            </ul>

            <form action={escolher} style={{ marginTop: 12 }}>
              <input type="hidden" name="plano" value={chave} />
              <button className="btn" type="submit" style={{ width: '100%' }}>
                Quero o {p.nome}
              </button>
            </form>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 24 }}>
        Cancelamento a qualquer momento, sem multa. Seus dados são exportáveis e
        apagados quando você pedir. Veja os{' '}
        <Link href="/termos">termos de uso</Link> e a{' '}
        <Link href="/privacidade">política de privacidade</Link>.
      </p>

      <form action="/auth/signout" method="post" style={{ marginTop: 8 }}>
        <button className="toggle" type="submit">Sair</button>
      </form>
    </div>
  )
}
