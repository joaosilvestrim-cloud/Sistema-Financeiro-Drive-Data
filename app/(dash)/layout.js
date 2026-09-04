import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import NavLink from '@/components/NavLink'
import EmpresaSelect from '@/components/EmpresaSelect'
import { desde } from '@/lib/format'

const PAGINAS = [
  ['/', 'Visão geral'],
  ['/recebiveis', 'Recebíveis'],
  ['/previsao', 'Previsão'],
  ['/indicadores', 'Indicadores'],
  ['/dre', 'DRE gerencial'],
  ['/clientes', 'Clientes'],
  ['/conexoes', 'Conexões'],
]

export default async function DashLayout({ children }) {
  const sessao = await requireSession()

  async function selecionarEmpresa(formData) {
    'use server'
    const valor = formData.get('empresa')
    const store = await cookies()
    if (valor) store.set('empresa', valor, { path: '/', maxAge: 60 * 60 * 24 * 365 })
    else store.delete('empresa')
    revalidatePath('/', 'layout')
  }

  const ultimoSync = sessao.conexoes
    .map((c) => c.last_sync_at)
    .filter(Boolean)
    .sort()
    .at(-1)

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          DriveAzul
          <span>Inteligência financeira</span>
        </div>

        <EmpresaSelect
          conexoes={sessao.conexoes}
          selecionada={sessao.connectionId}
          action={selecionarEmpresa}
        />

        <nav className="nav">
          {PAGINAS.map(([href, titulo]) => (
            <NavLink key={href} href={href}>{titulo}</NavLink>
          ))}
        </nav>

        <footer>
          <div>{sessao.tenantNome}</div>
          <div>sincronizado {desde(ultimoSync)}</div>
          <form action="/auth/signout" method="post">
            <button className="toggle" style={{ marginTop: 8 }} type="submit">Sair</button>
          </form>
        </footer>
      </aside>

      <main className="content">{children}</main>
    </div>
  )
}
