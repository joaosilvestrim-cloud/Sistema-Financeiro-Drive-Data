import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Renova a sessão a cada request e barra quem não está logado. Vale para tudo
// que não seja a tela de login e os arquivos estáticos.
export async function middleware(request) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          items.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const publica = path.startsWith('/login') || path.startsWith('/auth')

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
