import Link from 'next/link'
import { requireSession } from '@/lib/session'
import { razao, totaisDaRazao, razaoAgrupada, baixasDosTitulos, opcoesDaRazao, SITUACOES } from '@/lib/razao'
import { brl, dataCurta } from '@/lib/format'
import Tile from '@/components/Tile'
import Exportar from '@/components/Exportar'
import LinhaExpansivel from '@/components/LinhaExpansivel'

export const dynamic = 'force-dynamic'

// Contas a pagar e a receber.
//
// O meio que faltava. O painel tinha o aging, que diz quanto está vencido, e o
// resumo, que diz quem são os dez maiores. Não tinha lugar nenhum onde alguém
// abrisse a lista inteira e conferisse título por título, e a pagar não tinha
// nem lista.
//
// Sem esse meio o sistema responde bem a quem decide e mal a quem executa. A
// pergunta de quem executa é "quais são, exatamente", e ela não se responde com
// barra colorida.
//
// Tudo por URL, nada por estado de navegador. Um recorte útil é um link, e link
// se manda por WhatsApp, se salva nos favoritos e volta igual amanhã.

const PERIODOS = [
  ['vencidos', 'vencidos'],
  ['mes', 'este mês'],
  ['30', 'próximos 30 dias'],
  ['90', 'próximos 90 dias'],
  ['tudo', 'tudo'],
]

const SITUACAO_ROTULO = {
  a_vencer: 'a vencer', vencido: 'vencido', parcial: 'baixa parcial', liquidado: 'liquidado',
}
const SITUACAO_TOM = {
  vencido: 'var(--critical)', liquidado: 'var(--text-muted)', parcial: 'var(--warning)',
}

const BAIXAS = [
  { chave: 'data_pagamento', titulo: 'Pago em', tipo: 'data' },
  { chave: 'conta', titulo: 'Conta', tipo: 'texto', largura: 180 },
  { chave: 'valor', titulo: 'Valor', tipo: 'dinheiro' },
  { chave: 'juros', titulo: 'Juros', tipo: 'dinheiro' },
  { chave: 'desconto', titulo: 'Desconto', tipo: 'dinheiro' },
  { chave: 'taxa', titulo: 'Taxa', tipo: 'dinheiro' },
]

// Traduz o período escolhido em duas datas. Fica aqui e não no SQL porque o
// rótulo e o intervalo precisam ser a mesma coisa: se a tela diz "próximos 30
// dias" e a consulta faz outra conta, ninguém descobre.
function intervalo(periodo) {
  const hoje = new Date()
  const iso = (d) => d.toISOString().slice(0, 10)
  const mais = (n) => { const d = new Date(hoje); d.setDate(d.getDate() + n); return d }
  if (periodo === 'vencidos') return { ate: iso(mais(-1)) }
  if (periodo === 'mes') {
    return {
      de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)),
      ate: iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)),
    }
  }
  if (periodo === '30') return { de: iso(hoje), ate: iso(mais(30)) }
  if (periodo === '90') return { de: iso(hoje), ate: iso(mais(90)) }
  return {}
}

// Oitenta por página. Cento e cinquenta cabia na tela e custava 330 KB: numa
// razão cada linha viaja inteira no payload, e a paginação é barata.
const POR_PAGINA = 80

export default async function Contas({ searchParams }) {
  const sessao = await requireSession()
  const busca = await searchParams

  const tipo = ['receivable', 'payable'].includes(busca?.tipo) ? busca.tipo : 'receivable'
  const situacao = SITUACOES.some(([v]) => v === busca?.situacao) ? busca.situacao : 'aberto'
  const periodo = PERIODOS.some(([v]) => v === busca?.periodo) ? busca.periodo : 'tudo'
  const termo = (busca?.q ?? '').slice(0, 80)
  const pessoa = busca?.pessoa || null
  const categoria = busca?.categoria || null
  const ordem = busca?.ordem ?? 'vencimento'
  const pagina = Math.max(0, Number(busca?.pagina) || 0)

  // O intervalo do período convive com datas soltas na URL, que é como o fluxo
  // de caixa manda para cá: ele conhece o mês exato e não um preset.
  const doPeriodo = intervalo(periodo)
  const f = {
    kind: tipo,
    situacao,
    busca: termo,
    pessoa,
    categoria,
    ordem,
    de: busca?.de || doPeriodo.de,
    ate: busca?.ate || doPeriodo.ate,
  }

  const [linhas, totais, porPessoa, porCategoria, opcoes] = await Promise.all([
    razao(sessao, f, { limite: POR_PAGINA, pagina }),
    totaisDaRazao(sessao, f),
    razaoAgrupada(sessao, f, 'pessoa', 8),
    razaoAgrupada(sessao, f, 'categoria', 8),
    opcoesDaRazao(sessao, { ...f, busca: '' }),
  ])

  const baixas = await baixasDosTitulos(sessao, linhas.filter((l) => Number(l.baixas) > 0).map((l) => l.id))
  const porTitulo = new Map()
  for (const b of baixas) {
    if (!porTitulo.has(b.installment_id)) porTitulo.set(b.installment_id, [])
    porTitulo.get(b.installment_id).push(b)
  }

  // Todo link desta tela preserva o recorte inteiro e troca uma coisa só. Sem
  // isso, escolher a situação zeraria o período e a pessoa, e ninguém consegue
  // chegar a um recorte de três filtros clicando um de cada vez.
  const link = (troca) => {
    const p = new URLSearchParams()
    const atual = { tipo, situacao, periodo, q: termo, pessoa, categoria, ordem, pagina: String(pagina) }
    for (const [k, v] of Object.entries({ ...atual, ...troca })) {
      if (v !== null && v !== undefined && v !== '' && v !== '0') p.set(k, String(v))
    }
    if (busca?.de && !('periodo' in troca)) p.set('de', busca.de)
    if (busca?.ate && !('periodo' in troca)) p.set('ate', busca.ate)
    return `/contas?${p}`
  }

  const rotuloTipo = tipo === 'receivable' ? 'a receber' : 'a pagar'
  const rotuloPessoa = tipo === 'receivable' ? 'Cliente' : 'Fornecedor'
  const inicio = pagina * POR_PAGINA
  const temMais = inicio + linhas.length < totais.titulos

  const chip = (ativo) => (ativo
    ? { borderColor: 'var(--series-1)', color: 'var(--series-1)', fontWeight: 600 }
    : undefined)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Contas a pagar e a receber</h1>
          <p>
            A razão inteira, título por título. É daqui que sai o fluxo de caixa,
            e é aqui que ele se confere.
          </p>
        </div>
        <Exportar
          linhas={linhas} arquivo={`contas-${tipo === 'receivable' ? 'receber' : 'pagar'}`}
          colunas={[
            ['data_vencimento', 'Vencimento', 'data'],
            ['data_competencia', 'Competência', 'data'],
            ['pessoa', rotuloPessoa, 'texto'],
            ['pessoa_documento', 'CPF ou CNPJ', 'texto'],
            ['descricao', 'Descrição', 'texto'],
            ['categoria', 'Categoria', 'texto'],
            ['total', 'Total', 'dinheiro'],
            ['pago', 'Pago', 'dinheiro'],
            ['nao_pago', 'Em aberto', 'dinheiro'],
            ['situacao', 'Situação', 'texto'],
            ['dias', 'Dias do vencimento', 'inteiro'],
          ]}
        />
      </div>

      <div className="card" style={{ marginBottom: 14, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 62 }}>lado</span>
          {[['receivable', 'a receber'], ['payable', 'a pagar']].map(([v, r]) => (
            <Link key={v} href={link({ tipo: v, pessoa: '', categoria: '', pagina: '0' })}
                  className="toggle" style={chip(v === tipo)}>{r}</Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 62 }}>situação</span>
          {SITUACOES.map(([v, r]) => (
            <Link key={v} href={link({ situacao: v, pagina: '0' })}
                  className="toggle" style={chip(v === situacao)}>{r}</Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 62 }}>vencimento</span>
          {PERIODOS.map(([v, r]) => (
            <Link key={v} href={link({ periodo: v, pagina: '0' })}
                  className="toggle" style={chip(v === periodo && !busca?.de)}>{r}</Link>
          ))}
          {busca?.de && (
            <span className="badge">
              {dataCurta(busca.de)} a {busca.ate ? dataCurta(busca.ate) : 'em diante'}
            </span>
          )}
        </div>
        <form method="get" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="hidden" name="tipo" value={tipo} />
          <input type="hidden" name="situacao" value={situacao} />
          <input type="hidden" name="periodo" value={periodo} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 62 }}>filtrar</span>
          <input name="q" defaultValue={termo} placeholder="nome ou descrição" style={{ minWidth: 190 }} />
          <select name="pessoa" defaultValue={pessoa ?? ''}>
            <option value="">todo {rotuloPessoa.toLowerCase()}</option>
            {opcoes.pessoas.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select>
          <select name="categoria" defaultValue={categoria ?? ''}>
            <option value="">toda categoria</option>
            {opcoes.categorias.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select>
          <button className="toggle" type="submit">aplicar</button>
          {(termo || pessoa || categoria) && (
            <Link href={link({ q: '', pessoa: '', categoria: '', pagina: '0' })} className="toggle">
              limpar
            </Link>
          )}
        </form>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Tile label={`Títulos ${rotuloTipo}`} valor={String(totais.titulos)}
              nota={totais.primeiro
                ? `${dataCurta(totais.primeiro)} a ${dataCurta(totais.ultimo)}`
                : 'nada neste recorte'} />
        <Tile label="Valor total" valor={brl(totais.total)}
              nota={`${brl(totais.pago)} já baixado`} />
        <Tile label="Em aberto" valor={brl(totais.aberto)}
              nota={totais.total > 0
                ? `${((totais.aberto / totais.total) * 100).toFixed(0)}% do total`
                : '—'} />
        <Tile label="Vencido" valor={brl(totais.vencido)}
              nota={`${totais.titulos_vencidos} título(s) passaram da data`}
              tom={Number(totais.vencido) > 0 ? 'bad' : null} />
      </div>

      {linhas.length === 0 ? (
        <p className="empty">
          Nenhum título {rotuloTipo} neste recorte. Afrouxe a situação ou o período acima.
        </p>
      ) : (
        <>
          <div className="grid cols-2" style={{ marginBottom: 14 }}>
            {[[rotuloPessoa, porPessoa, 'pessoa'], ['Categoria', porCategoria, 'categoria']].map(
              ([titulo, dados, campo]) => (
                <div className="card" key={campo}>
                  <h2>Por {titulo.toLowerCase()}</h2>
                  <p className="sub">
                    Os oito maiores deste recorte. Clique para filtrar por um deles.
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>{titulo}</th>
                        <th className="num">Títulos</th>
                        <th className="num">Em aberto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.map((d) => (
                        <tr key={d.chave}>
                          <td className="corta corta-m">{d.chave}</td>
                          <td className="num">{d.titulos}</td>
                          <td className="num">{brl(d.aberto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ),
            )}
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h2>Títulos</h2>
                <p className="sub">
                  Linha com seta já teve baixa: clique para ver. Ordenado por{' '}
                  {ordem === 'valor' ? 'valor' : ordem === 'pessoa' ? 'nome' : 'vencimento'}.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[['vencimento', 'por vencimento'], ['valor', 'por valor'], ['pessoa', 'por nome']].map(
                  ([v, r]) => (
                    <Link key={v} href={link({ ordem: v, pagina: '0' })}
                          className="toggle" style={chip(v === ordem)}>{r}</Link>
                  ),
                )}
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th />
                  <th>Vencimento</th>
                  <th>{rotuloPessoa}</th>
                  <th>Descrição</th>
                  <th>Categoria</th>
                  <th className="num">Total</th>
                  <th className="num">Em aberto</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const dele = porTitulo.get(l.id) ?? []
                  const celulas = (
                        <>
                          <td className="corta">{dataCurta(l.data_vencimento)}</td>
                          <td className="corta corta-m">{l.pessoa}</td>
                          <td className="corta corta-g">{l.descricao ?? '—'}</td>
                          <td className="corta corta-p">{l.categoria ?? '—'}</td>
                          <td className="num">{brl(l.total)}</td>
                          <td className="num">{Number(l.nao_pago) > 0 ? brl(l.nao_pago) : '—'}</td>
                          <td className="corta" style={{ color: SITUACAO_TOM[l.situacao] }}>
                            {SITUACAO_ROTULO[l.situacao] ?? l.situacao}
                            {l.situacao === 'vencido' && Number(l.dias) > 0 && (
                              <span style={{ color: 'var(--text-muted)' }}> · {l.dias} d</span>
                            )}
                          </td>
                        </>
                  )

                  // Só abre o que tem baixa. Num recorte de títulos em aberto a
                  // maioria não tem nenhuma, e transformar essas linhas em botão
                  // custava payload em todas para frustrar quem clica em quase
                  // todas: a página inteira saía com 466 KB.
                  if (!dele.length) {
                    return <tr key={l.id}><td className="seta" />{celulas}</tr>
                  }
                  return (
                    <LinhaExpansivel
                      key={l.id} colunas={8} campos={BAIXAS}
                      itens={dele} total={dele.length}
                      rotulo={`${dele.length} baixa(s), competência ${dataCurta(l.data_competencia)}`}
                      rodape={`Situação no ERP: ${l.status_traduzido ?? '—'}`}
                      celulas={celulas}
                    />
                  )
                })}
              </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {inicio + 1} a {inicio + linhas.length} de {totais.titulos}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                {pagina > 0 && (
                  <Link href={link({ pagina: String(pagina - 1) })} className="toggle">anterior</Link>
                )}
                {temMais && (
                  <Link href={link({ pagina: String(pagina + 1) })} className="toggle">próxima</Link>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
