import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Cliente do Supabase no servidor, só para autenticação. Os dados do dashboard
// vêm por SQL direto no Postgres, com o tenant resolvido a partir da sessão
// verificada aqui.
export async function supabaseServer() {
  const store = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (items) => {
          try {
            items.forEach(({ name, value, options }) => store.set(name, value, options))
          } catch {
            // Server Component não pode escrever cookie. O middleware renova a sessão.
          }
        },
      },
    },
  )
}
