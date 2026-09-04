import { requireSession } from '@/lib/session'
import { dreMeses } from '@/lib/queries'
import { brl, rotuloMes } from '@/lib/format'

export const dynamic = 'force-dynamic'

// DRE gerencial em regime de competência. Nunca por vencimento e nunca por
// caixa. Quando a parcela não tem competência preenchida, a view cai para o
// vencimento, o que é o comportamento menos errado possível.

// O ERP devolve o grupo em maiuscula com underscore. Os que aparecem com mais
// frequencia ganham um nome escrito por extenso; o resto e humanizado na hora,
// para nunca sobrar RECEITA_VENDA_PRODUTOS_SERVICOS na tela do financeiro.
const NOMES = {
  RECEITA_BRUTA: 'Receita bruta',
  RECEITA_VENDA_PRODUTOS_SERVICOS: 'Receita de produtos e serviços',
  OUTRAS_RECEITAS: 'Outras receitas',
  CUSTO_SERVICOS_PRESTADOS: 'Custo dos serviços prestados',
  CUSTO_MERCADORIA_VENDIDA: 'Custo da mercadoria vendida',
  CUSTOS_OPERACIONAIS: 'Custos operacionais',
  DESPESAS_ADMINISTRATIVAS: 'Despesas administrativas',
  DESPESAS_COMERCIAIS: 'Despesas comerciais',
  DESPESAS_FINANCEIRAS: 'Despesas financeiras',
  DESPESAS_COM_PESSOAL: 'Despesas com pessoal',
  IMPOSTOS: 'Impostos',
  IMPOSTOS_SOBRE_VENDAS: 'Impostos sobre vendas',
  INVESTIMENTOS_IMOBILIZADO: 'Investimentos e imobilizado',
  SEM_GRUPO: 'Sem classificação',
}

function nomeDoGrupo(g) {
  if (NOMES[g]) return NOMES[g]
  const texto = String(g ?? '').toLowerCase().replaceAll('_', ' ').trim()
  return texto ? texto[0].toUpperCase() + texto.slice(1) : 'Sem classificação'
}

export default async function Dre() {
  const sessao = await requireSession()
  const linhas = await dreMeses(sessao, 6)

  if (!linhas.length) {
    return (
      <>
        <div className="page-head"><div><h1>DRE gerencial</h1></div></div>
        <p className="empty">Sem lançamentos classificados no período.</p>
      </>
    )
  }

  const meses = [...new Set(linhas.map((l) => l.competencia))].sort()
  // O mes corrente ainda esta rodando. Sem avisar, quem le compara um mes pela
  // metade com meses inteiros e conclui que a receita despencou.
  const mesAtual = new Date().toISOString().slice(0, 7)
  const chave = (kind, grupo) => `${kind}|${grupo}`

  const grupos = new Map()
  for (const l of linhas) {
    const k = chave(l.kind, l.grupo_dre)
    if (!grupos.has(k)) grupos.set(k, { kind: l.kind, grupo: l.grupo_dre, porMes: {}, total: 0 })
    const g = grupos.get(k)
    g.porMes[l.competencia] = (g.porMes[l.competencia] ?? 0) + Number(l.total)
    g.total += Number(l.total)
  }

  const receitas = [...grupos.values()].filter((g) => g.kind === 'receivable').sort((a, b) => b.total - a.total)
  const despesas = [...grupos.values()].filter((g) => g.kind === 'payable').sort((a, b) => b.total - a.total)

  const somaMes = (lista, mes) => lista.reduce((acc, g) => acc + (g.porMes[mes] ?? 0), 0)
  const somaTotal = (lista) => lista.reduce((acc, g) => acc + g.total, 0)

  const Linha = ({ rotulo, porMes, total, forte, tom }) => (
    <tr>
      <td style={{ fontWeight: forte ? 600 : 400, color: tom }}>{rotulo}</td>
      {meses.map((m) => (
        <td className="num" key={m} style={{ fontWeight: forte ? 600 : 400, color: tom }}>
          {porMes[m] ? brl(porMes[m]) : '—'}
        </td>
      ))}
      <td className="num" style={{ fontWeight: 600, color: tom }}>{brl(total)}</td>
    </tr>
  )

  const resultadoPorMes = Object.fromEntries(
    meses.map((m) => [m, somaMes(receitas, m) - somaMes(despesas, m)]),
  )
  const resultadoTotal = somaTotal(receitas) - somaTotal(despesas)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>DRE gerencial</h1>
          <p>Regime de competência, últimos {meses.length} meses.</p>
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Grupo</th>
              {meses.map((m) => (
                <th className="num" key={m}>
                  {rotuloMes(m)}
                  {m === mesAtual && (
                    <div style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-muted)' }}>
                      em curso
                    </div>
                  )}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {receitas.map((g) => (
              <Linha key={g.grupo} rotulo={nomeDoGrupo(g.grupo)} porMes={g.porMes} total={g.total} />
            ))}
            <Linha
              rotulo="Total de receitas" forte
              porMes={Object.fromEntries(meses.map((m) => [m, somaMes(receitas, m)]))}
              total={somaTotal(receitas)}
            />
            <tr><td colSpan={meses.length + 2} style={{ padding: 4 }} /></tr>
            {despesas.map((g) => (
              <Linha key={g.grupo} rotulo={nomeDoGrupo(g.grupo)} porMes={g.porMes} total={g.total} />
            ))}
            <Linha
              rotulo="Total de despesas" forte
              porMes={Object.fromEntries(meses.map((m) => [m, somaMes(despesas, m)]))}
              total={somaTotal(despesas)}
            />
          </tbody>
          <tfoot>
            <Linha
              rotulo="Resultado" forte
              porMes={resultadoPorMes} total={resultadoTotal}
              tom={resultadoTotal >= 0 ? 'var(--good-text)' : 'var(--critical)'}
            />
          </tfoot>
        </table>
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 12 }}>
        A coluna do mês em curso cobre apenas o que já foi lançado até hoje, então não se compara
        de igual para igual com os meses fechados.
        {despesas.some((g) => g.grupo === 'SEM_GRUPO') && (
          <> Linhas em <strong>Sem classificação</strong> são categorias sem grupo de DRE definido
          no próprio ERP: classificá-las lá melhora este relatório sem mexer em nada aqui.</>
        )}
        {' '}Quando houver mais de uma empresa somada, categorias com nomes diferentes ainda entram
        separadas. O de-para canônico resolve isso e está previsto para a próxima etapa.
      </p>
    </>
  )
}
