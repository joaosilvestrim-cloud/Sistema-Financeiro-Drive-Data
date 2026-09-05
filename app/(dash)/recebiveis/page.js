import { requireSession } from '@/lib/session'
import { aging, recebiveisAbertos } from '@/lib/queries'
import Exportar from '@/components/Exportar'
import { brl, dataCurta } from '@/lib/format'
import HBars from '@/components/charts/HBars'

export const dynamic = 'force-dynamic'

const FAIXAS = {
  a_vencer: ['A vencer', 'var(--ramp-250)'],
  d1_30:    ['1 a 30 dias', 'var(--ramp-350)'],
  d31_60:   ['31 a 60 dias', 'var(--ramp-450)'],
  d61_90:   ['61 a 90 dias', 'var(--ramp-550)'],
  d90_mais: ['mais de 90 dias', 'var(--ramp-650)'],
}

export default async function Recebiveis() {
  const sessao = await requireSession()
  const [rec, pag, titulos] = await Promise.all([
    aging(sessao, 'receivable'), aging(sessao, 'payable'), recebiveisAbertos(sessao, 80),
  ])

  const emAberto = rec.reduce((a, f) => a + Number(f.valor), 0)
  const vencido = rec.filter((f) => f.faixa !== 'a_vencer').reduce((a, f) => a + Number(f.valor), 0)

  const bars = (dados) => dados.map((f) => ({
    rotulo: FAIXAS[f.faixa]?.[0] ?? f.faixa,
    cor: FAIXAS[f.faixa]?.[1],
    valor: f.valor,
    nota: `${f.titulos} títulos`,
  }))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Recebíveis</h1>
          <p>
            {brl(emAberto)} em aberto, sendo {brl(vencido)} vencidos
            {emAberto > 0 && ` (${((vencido / emAberto) * 100).toFixed(1).replace('.', ',')}%)`}.
          </p>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <h2>A receber por faixa</h2>
          <p className="sub">Dias de atraso em relação ao vencimento.</p>
          <HBars dados={bars(rec)} />
        </div>
        <div className="card">
          <h2>A pagar por faixa</h2>
          <p className="sub">Mesma régua, do outro lado.</p>
          <HBars dados={bars(pag)} cor="var(--series-2)" />
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
          <div>
            <h2>Títulos em aberto</h2>
            <p className="sub">Os {titulos.length} mais antigos primeiro.</p>
          </div>
          <Exportar
            linhas={titulos} arquivo="titulos-em-aberto"
            colunas={[
              ['data_vencimento', 'Vencimento', 'data'],
              ['cliente', 'Cliente', 'texto'],
              ['descricao', 'Descrição', 'texto'],
              ['categoria', 'Categoria', 'texto'],
              ['total', 'Total', 'dinheiro'],
              ['nao_pago', 'Em aberto', 'dinheiro'],
              ['dias_atraso', 'Dias de atraso', 'inteiro'],
              ['status_traduzido', 'Situação', 'texto'],
            ]}
          />
        </div>
        <table>
          <thead>
            <tr>
              <th>Vencimento</th>
              <th>Cliente</th>
              <th>Descrição</th>
              <th>Categoria</th>
              <th className="num">Em aberto</th>
              <th className="num">Atraso</th>
            </tr>
          </thead>
          <tbody>
            {titulos.map((t, i) => {
              const atraso = Number(t.dias_atraso)
              return (
                <tr key={i}>
                  <td>{dataCurta(t.data_vencimento)}</td>
                  <td>{t.cliente ?? '—'}</td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.descricao ?? '—'}
                  </td>
                  <td>{t.categoria ?? '—'}</td>
                  <td className="num">{brl(t.nao_pago)}</td>
                  <td className="num" style={{ color: atraso > 0 ? 'var(--critical)' : 'var(--text-muted)' }}>
                    {atraso > 0 ? `${atraso} d` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
