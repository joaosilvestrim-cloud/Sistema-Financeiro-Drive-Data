import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Volta do link de confirmação de e-mail.
//
// Caminho feliz: o link chega com um código de uso único, trocamos por sessão
// aqui mesmo e a pessoa cai em /bem-vindo já logada, onde a empresa dela nasce.
//
// Caminho que importa: e-mail corporativo da Microsoft (e de vários filtros
// de segurança) abre todo link da mensagem antes da pessoa, para inspecionar.
// Provado em 09/10/2026 na caixa da própria DriveData: a conta foi confirmada
// 17 segundos depois do envio, sem ninguém clicar. O filtro gasta o link de
// uso único, e o clique da pessoa chega aqui como "link inválido ou expirado".
// Só que o e-mail JÁ está confirmado: quem o confirmou foi o filtro. Então,
// em vez de uma tela de erro, a pessoa vai para o login com a explicação, entra
// com a senha que acabou de criar e segue para /bem-vindo do mesmo jeito.

function destinoSeguro(valor) {
  // Só caminho interno. Aceitar URL inteira aqui viraria redirecionamento
  // aberto: um link de phishing usaria o nosso domínio para mandar a pessoa
  // para qualquer lugar.
  return valor && valor.startsWith('/') && !valor.startsWith('//') ? valor : '/bem-vindo'
}

export async function GET(request) {
  const url = new URL(request.url)
  const proxima = destinoSeguro(url.searchParams.get('next'))
  const code = url.searchParams.get('code')

  if (code) {
    const supabase = await supabaseServer()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(proxima, url.origin))
  }

  // Sem código, código recusado ou erro devolvido pelo Supabase. Nos três
  // casos o próximo passo da pessoa é o mesmo: entrar com a senha.
  const login = new URL('/login', url.origin)
  login.searchParams.set('aviso', 'confirmar')
  login.searchParams.set('proxima', proxima)
  return NextResponse.redirect(login)
}
