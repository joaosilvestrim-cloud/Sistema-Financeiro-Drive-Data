import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Renova a sessão a cada request e barra quem não está logado. Vale para tudo
// que não seja a tela de login e os arquivos estáticos.

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const CHAVE_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export async function middleware(request) {
  // Sem as variáveis o cliente do Supabase lança na construção e o middleware
  // inteiro cai, o que na Vercel aparece como MIDDLEWARE_INVOCATION_FAILED, sem
  // dizer o motivo. Melhor responder com o diagnóstico do que crashar.
  //
  // Não dá para seguir sem autenticação: isso abriria o financeiro para
  // qualquer um com o link.
  if (!URL_SUPABASE || !CHAVE_SUPABASE) {
    const faltando = [
      !URL_SUPABASE && 'NEXT_PUBLIC_SUPABASE_URL',
      !CHAVE_SUPABASE && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ].filter(Boolean).join(', ')
    return new NextResponse(
      `Configuracao incompleta. Faltam as variaveis de ambiente: ${faltando}.\n` +
      `Cadastre em Settings > Environment Variables do projeto e refaca o deploy.\n` +
      `A lista completa esta em docs/DEPLOY.md.\n`,
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(URL_SUPABASE, CHAVE_SUPABASE, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname

  // O retorno do OAuth precisa passar sem sessao. O codigo dura 3 minutos e so
  // pode ser trocado uma vez: se o middleware mandar para o login, o codigo se
  // perde no caminho e a autorizacao inteira e desperdicada. Quem protege essa
  // rota e o `state` assinado, que carrega o tenant e tem prazo proprio.
  const publica = path.startsWith('/login')
    || path.startsWith('/auth')
    || path.startsWith('/api/oauth')

  if (!user && !publica) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('proxima', path)
    return NextResponse.redirect(url)
  }
  if (user && path === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
}
