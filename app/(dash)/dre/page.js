import Link from 'next/link'
import { requireSession } from '@/lib/session'
import { dre, rotuloPeriodo, granularidades } from '@/lib/dre'
import { brl } from '@/lib/format'

export const dynamic = 'force-dynamic'

// DRE gerencial em regime de competência. Nunca por vencimento e nunca por
// caixa. Quando a parcela não tem competência preenchida, a view cai para o
// vencimento, o que é o comportamento menos errado possível.
//
// Mês, trimestre e ano, com variação contra o período equivalente anterior. A
// coluna do período em curso fica marcada e fora da comparação: ela está pela
// metade, e comparar com ela faria toda linha parecer em queda.

// O ERP devolve o grupo em maiúscula com underscore. Os que aparecem com mais
// frequência ganham um nome escrito por extenso; o resto é humanizado na hora,
// para nunca sobrar RECEITA_VENDA_PRODUTOS_SERVICOS na tela do financeiro.
const NOMES = {
  RECEITA_BRUTA: 'Receita bruta',
  RECEITA_VENDA_PRODUTOS_SERVICOS: 'Receita de produtos e serviços',
  RECEITAS_RENDIMENTOS_FINANCEIROS: 'Rendimentos financeiros',
  RECEITA_FRETES_ENTREGAS: 'Fretes e entregas',
  OUTRAS_RECEITAS: 'Outras receitas',
  OUTRAS_RECEITAS_NAO_OPERACIONAIS: 'Outras receitas não operacionais',
  CUSTO_SERVICOS_PRESTADOS: 'Custo dos serviços prestados',
  CUSTO_MERCADORIA_VENDIDA: 'Custo da mercadoria vendida',
  CUSTOS_OPERACIONAIS: 'Custos operacionais',
  DESPESAS_ADMINISTRATIVAS: 'Despesas administrativas',
  DESPESAS_COMERCIAIS: 'Despesas comerciais',
  DESPESAS_FINANCEIRAS: 'Despesas financeiras',
  DESPESSAS_FINANCEIRAS: 'Despesas financeiras',
  DESPESAS_COM_PESSOAL: 'Despesas com pessoal',
  DESPESAS_OPERACIONAIS_NIVEL_2: 'Despesas operacionais',
  IMPOSTOS: 'Impostos',
  IMPOSTOS_SOBRE_VENDAS: 'Impostos sobre vendas',
  COMISSOES_SOBRE_VENDAS: 'Comissões sobre vendas',
  DESCONTOS_INCONDICIONAIS: 'Descontos concedidos',
  INVESTIMENTOS_IMOBILIZADO: 'Investimentos e imobilizado',
  EMPRESTIMOS_DIVIDAS: 'Empréstimos e dívidas',
  OUTRAS_DESPESAS_NAO_OPERACIONAIS: 'Outras despesas não operacionais',
  SEM_GRUPO: 'Sem classificação',
}

function nomeDoGrupo(g) {
  if (NOMES[g]) return NOMES[g]
  const texto = String(g ?? '').toLowerCase().replaceAll('_', ' ').trim()
  return texto ? texto[0].toUpperCase() + texto.slice(1) : 'Sem classificação'
}

function Variacao({ v }) {
  if (!v) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  if (v.tipo === 'novo') return <span style={{ color: 'var(--text-muted)' }}>novo</span>
  const pct = v.valor * 100
  // Cor só a partir de 5%. Abaixo disso costuma ser calendário, e pintar tudo de
  // vermelho e verde treina a pessoa a ignorar a cor.
  const forte = Math.abs(pct) >= 5
  const cor = !forte ? undefined : pct > 0 ? 'var(--good-text)' : 'var(--critical)'
  return (
    <span style={{ color: cor }} title={`${brl(v.delta)} de diferença`}>
      {pct > 0 ? '+' : ''}{pct.toFixed(0)}%
    </span>
  )
}

export default async function Dre({ searchParams }) {
  const sessao = await requireSession()
  const busca = await searchParams
  const grao = ['mes', 'trimestre', 'ano'].includes(busca?.periodo) ? busca.periodo : 'mes'
  const d = await dre(sessao, grao)

  if (!d.periodos.length) {
    return (
      <>
        <div className="page-head"><div><h1>DRE gerencial</h1></div></div>
        <p className="empty">Sem lançamentos classificados no período.</p>
      </>
    )
  }

  const Linha = ({ rotulo, porPeriodo, total, variacao, forte, tom }) => (
    <tr>
      <td style={{ fontWeight: forte ? 600 : 400, color: tom }}>{rotulo}</td>
      {d.periodos.map((p) => (
        <td className="num" key={p} style={{ fontWeight: forte ? 600 : 400, color: tom }}>
          {porPeriodo[p] ? brl(porPeriodo[p]) : '—'}
        </td>
      ))}
      <td className="num"><Variacao v={variacao} /></td>
      <td className="num" style={{ fontWeight: 600, color: tom }}>{brl(total)}</td>
    </tr>
  )

  const somaTotal = (lista) => lista.reduce((a, g) => a + g.total, 0)
  const totalReceita = somaTotal(d.receitas)
  const totalDespesa = somaTotal(d.despesas)

  const variacaoDe = (mapa) => {
    if (!d.atual || !d.anterior) return null
    const a = mapa[d.anterior] ?? 0
    const b = mapa[d.atual] ?? 0
    if (!a) return b ? { tipo: 'novo', valor: b } : null
    return { tipo: 'pct', valor: (b - a) / Math.abs(a), delta: b - a }
  }

  const vazio = { colSpan: d.periodos.length + 3, style: { height: 10 } }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>DRE gerencial</h1>
          <p>
            Regime de competência, por {d.rotuloGrao}. A variação compara{' '}
            {d.atual ? rotuloPeriodo(d.atual, grao) : '—'} com{' '}
            {d.anterior ? rotuloPeriodo(d.anterior, grao) : '—'}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {granularidades.map((g) => (
            <Link
              key={g.chave} href={`/dre?periodo=${g.chave}`} className="toggle"
              style={grao === g.chave ? { borderColor: 'var(--text-primary)' } : undefined}
            >
              Por {g.rotulo}
            </Link>
          ))}
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Grupo</th>
              {d.periodos.map((p) => (
                <th className="num" key={p}>
                  {rotuloPeriodo(p, grao)}
                  {p === d.emCurso && (
                    <div style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-muted)' }}>
                      em curso
                    </div>
                  )}
                </th>
              ))}
              <th className="num">Variação</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {d.receitas.map((g) => (
              <Linha key={g.grupo} rotulo={nomeDoGrupo(g.grupo)}
                     porPeriodo={g.porPeriodo} total={g.total} variacao={g.variacao} />
            ))}
            <Linha rotulo="Total de receitas" forte
                   porPeriodo={d.totais.receita} total={totalReceita}
                   variacao={variacaoDe(d.totais.receita)} />

            <tr><td {...vazio} /></tr>

            {d.despesas.map((g) => (
              <Linha key={g.grupo} rotulo={nomeDoGrupo(g.grupo)}
                     porPeriodo={g.porPeriodo} total={g.total} variacao={g.variacao} />
            ))}
            <Linha rotulo="Total de despesas" forte
                   porPeriodo={d.totais.despesa} total={totalDespesa}
                   variacao={variacaoDe(d.totais.despesa)} />

            <tr><td {...vazio} /></tr>

            <Linha rotulo="Resultado" forte
                   porPeriodo={d.totais.resultado}
                   total={totalReceita - totalDespesa}
                   variacao={variacaoDe(d.totais.resultado)}
                   tom={totalReceita - totalDespesa >= 0 ? 'var(--good-text)' : 'var(--critical)'} />

            <tr>
              <td style={{ fontWeight: 600 }}>Margem</td>
              {d.periodos.map((p) => (
                <td className="num" key={p} style={{ fontWeight: 600 }}>
                  {d.margem[p] === null ? '—' : `${(d.margem[p] * 100).toFixed(1)}%`}
                </td>
              ))}
              <td className="num">—</td>
              <td className="num" style={{ fontWeight: 600 }}>
                {totalReceita > 0
                  ? `${(((totalReceita - totalDespesa) / totalReceita) * 100).toFixed(1)}%`
                  : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 12 }}>
        A coluna marcada como em curso cobre apenas o que já foi lançado até hoje,
        então não se compara de igual para igual com os períodos fechados, e por
        isso ela fica fora da variação. A cor só aparece a partir de 5%.
        {d.despesas.some((g) => g.grupo === 'SEM_GRUPO') && (
          <> Linhas em <strong>Sem classificação</strong> são categorias sem grupo
          de DRE definido no próprio ERP: classificá-las lá melhora este relatório
          sem mexer em nada aqui.</>
        )}
      </p>
    </>
  )
}
