import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import Marca from '@/components/Marca'
import NavLink from '@/components/NavLink'
import EmpresaSelect from '@/components/EmpresaSelect'
import { desde } from '@/lib/format'

const PAGINAS = [
  ['/resumo', 'Resumo executivo'],
  ['/', 'Visão geral'],
  ['/fluxo', 'Fluxo de caixa'],
  ['/recebiveis', 'Recebíveis'],
  ['/previsao', 'Previsão'],
  ['/indicadores', 'Indicadores'],
  ['/metas', 'Metas'],
  ['/produtividade', 'Produtividade'],
  ['/dre', 'DRE gerencial'],
  ['/precificacao', 'Preço e custo'],
  ['/impostos', 'Impostos'],
  ['/clientes', 'Clientes'],
  ['/dados', 'Dados auxiliares'],
  ['/fatura', 'Fatura de cartão'],
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
        <Marca />

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
          {sessao.conta?.emTeste && (
            <div style={{ color: sessao.conta.diasRestantes <= 3 ? 'var(--warning)' : undefined }}>
              {sessao.conta.testeVencido
                ? 'teste encerrado'
                : `teste: ${sessao.conta.diasRestantes} ${sessao.conta.diasRestantes === 1 ? 'dia' : 'dias'}`}
            </div>
          )}
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
