import { requireSession } from '@/lib/session'
import { dreMeses } from '@/lib/queries'
import { brl, rotuloMes } from '@/lib/format'

export const dynamic = 'force-dynamic'

// DRE gerencial em regime de competência. Nunca por vencimento e nunca por
// caixa. Quando a parcela não tem competência preenchida, a view cai para o
// vencimento, o que é o comportamento menos errado possível.

const NOMES = {
  RECEITA_BRUTA: 'Receita bruta',
  DESPESAS_ADMINISTRATIVAS: 'Despesas administrativas',
  DESPESAS_COMERCIAIS: 'Despesas comerciais',
  CUSTOS_OPERACIONAIS: 'Custos operacionais',
  IMPOSTOS: 'Impostos',
  SEM_GRUPO: 'Sem classificação',
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
              {meses.map((m) => <th className="num" key={m}>{rotuloMes(m)}</th>)}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {receitas.map((g) => (
              <Linha key={g.grupo} rotulo={NOMES[g.grupo] ?? g.grupo} porMes={g.porMes} total={g.total} />
            ))}
            <Linha
              rotulo="Total de receitas" forte
              porMes={Object.fromEntries(meses.map((m) => [m, somaMes(receitas, m)]))}
              total={somaTotal(receitas)}
            />
            <tr><td colSpan={meses.length + 2} style={{ padding: 4 }} /></tr>
            {despesas.map((g) => (
              <Linha key={g.grupo} rotulo={NOMES[g.grupo] ?? g.grupo} porMes={g.porMes} total={g.total} />
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
        Quando houver mais de uma empresa somada, categorias com nomes diferentes ainda entram
        separadas. O de-para canônico resolve isso e está previsto para a próxima etapa.
      </p>
    </>
  )
}
