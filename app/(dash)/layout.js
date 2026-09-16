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
// A cor de cada area. Ela pinta o traco do rotulo, o trilho e o item ativo,
// e nada alem disso: cor de area e orientacao, nao decoracao.
const MENU = [
  ['Panorama', 'var(--cat-1)', [
    ['/resumo', 'Resumo executivo', 'resumo'],
    ['/', 'Visão geral', 'visao'],
  ]],
  ['Caixa', 'var(--cat-2)', [
    ['/fluxo', 'Fluxo de caixa', 'fluxo'],
    ['/previsao', 'Projeção de saldo', 'previsao'],
    ['/contas', 'Contas a pagar e receber', 'contas'],
    ['/recebiveis', 'Recebíveis', 'recebiveis'],
  ]],
  ['Resultado', 'var(--cat-5)', [
    ['/dre', 'DRE gerencial', 'dre'],
    ['/precificacao', 'Preço e custo', 'preco'],
  ]],
  // Fiscal ganhou grupo próprio quando deixou de ser uma tela: emissão de
  // nota, carga tributária e, em breve, o split payment do TributoStream.
  // Antes a emissão morava em Caixa e imposto em Resultado, e quem procurava
  // "nota" não sabia qual dos dois abrir.
  ['Fiscal', 'var(--cat-3)', [
    ['/notas', 'Notas fiscais', 'notas'],
    ['/impostos', 'Impostos', 'impostos'],
  ]],
  ['Análise', 'var(--cat-6)', [
    ['/indicadores', 'Indicadores', 'indicadores'],
    ['/clientes', 'Clientes', 'clientes'],
    ['/qualidade', 'Qualidade da previsão', 'qualidade'],
    ['/produtividade', 'Produtividade', 'produtividade'],
    ['/metas', 'Metas', 'metas'],
  ]],
  ['Dados', 'var(--cat-8)', [
    ['/fatura', 'Fatura de cartão', 'fatura'],
    ['/dados', 'Dados auxiliares', 'dados'],
    ['/conexoes', 'Conexões', 'conexoes'],
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

  // A idade do dado vira cor no rodapé. Duas horas é o dobro do intervalo de
  // sincronização, então até aí está normal. Meio dia parado já é sintoma.
  const horas = ultimoSync ? (Date.now() - new Date(ultimoSync)) / 3600000 : Infinity
  const idade = horas < 2 ? 'novo' : horas < 12 ? 'velho' : 'parado'

  return (
    <div className="shell">
      <aside className="sidebar">
        {/* Marca e seletor de empresa formam um bloco só: os dois respondem
            "que sistema é este e de qual empresa estou vendo", e separá-los
            faria o seletor parecer o primeiro item do menu. */}
        <div className="topo">
          <Marca />
          <EmpresaSelect
            conexoes={sessao.conexoes}
            selecionada={sessao.connectionId}
            action={selecionarEmpresa}
          />
        </div>

        <nav className="nav">
          {MENU.map(([grupo, cor, itens]) => (
            <div key={grupo} style={{ '--g': cor }}>
              <div className="grupo">{grupo}</div>
              {itens.map(([href, titulo, icone]) => (
                <NavLink key={href} href={href} icone={icone}>{titulo}</NavLink>
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
          <div className="sync" data-idade={idade}>
            {ultimoSync ? `sincronizado ${desde(ultimoSync)}` : 'nunca sincronizado'}
          </div>
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
