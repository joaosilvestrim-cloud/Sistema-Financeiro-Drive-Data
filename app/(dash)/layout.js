import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import Marca from '@/components/Marca'
import NavLink from '@/components/NavLink'
import EmpresaSelect from '@/components/EmpresaSelect'
import { desde } from '@/lib/format'
import TemaToggle from '@/components/TemaToggle'

// O menu segue a ordem em que um financeiro lê a empresa, e não a ordem em que
// as telas foram construídas.
//
// A separação entre Caixa e Resultado é a divisão contábil que mais importa e a
// que mais gera confusão: caixa é quando o dinheiro entra e sai, resultado é
// quando o fato acontece. Ver as duas coisas na mesma lista faz alguém comparar
// o fluxo de caixa com o DRE e achar que um dos dois está errado.
//
// Depois vem Análise, que interpreta o que os dois primeiros mostraram, e por
// último Dados, que é onde se alimenta e se conecta o sistema. Configuração
// nunca vem antes de conteúdo.
const MENU = [
  ['Panorama', [
    ['/resumo', 'Resumo executivo'],
    ['/', 'Visão geral'],
  ]],
  ['Caixa', [
    ['/fluxo', 'Fluxo de caixa'],
    ['/previsao', 'Projeção de saldo'],
    ['/recebiveis', 'Recebíveis'],
  ]],
  ['Resultado', [
    ['/dre', 'DRE gerencial'],
    ['/precificacao', 'Preço e custo'],
    ['/impostos', 'Impostos'],
  ]],
  ['Análise', [
    ['/indicadores', 'Indicadores'],
    ['/clientes', 'Clientes'],
    ['/produtividade', 'Produtividade'],
    ['/metas', 'Metas'],
  ]],
  ['Dados', [
    ['/fatura', 'Fatura de cartão'],
    ['/dados', 'Dados auxiliares'],
    ['/conexoes', 'Conexões'],
  ]],
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
          {MENU.map(([grupo, itens]) => (
            <div key={grupo}>
              <div className="grupo">{grupo}</div>
              {itens.map(([href, titulo]) => (
                <NavLink key={href} href={href}>{titulo}</NavLink>
              ))}
            </div>
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
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <form action="/auth/signout" method="post">
              <button className="toggle" type="submit">Sair</button>
            </form>
            <TemaToggle flutuante={false} />
          </div>
        </footer>
      </aside>

      <main className="content">{children}</main>
    </div>
  )
}
