import { requireSession } from '@/lib/session'
import { kpis, fluxoMensal, aging, topClientes } from '@/lib/queries'
import { alertas } from '@/lib/alerts'
import Alerts from '@/components/Alerts'
import { brl, dataCurta } from '@/lib/format'
import Tile from '@/components/Tile'
import CashflowChart from '@/components/charts/CashflowChart'
import HBars from '@/components/charts/HBars'

export const dynamic = 'force-dynamic'

const FAIXAS = {
  a_vencer: ['A vencer', 'var(--ramp-250)'],
  d1_30:    ['1 a 30 dias', 'var(--ramp-350)'],
  d31_60:   ['31 a 60 dias', 'var(--ramp-450)'],
  d61_90:   ['61 a 90 dias', 'var(--ramp-550)'],
  d90_mais: ['mais de 90 dias', 'var(--ramp-650)'],
}

function runwayTexto(saldo, burn) {
  if (!burn || burn <= 0) return ['Caixa positivo', 'entra mais do que sai nos últimos 90 dias', 'good']
  const dias = Math.floor(saldo / burn)
  if (dias > 720) return ['Mais de 2 anos', `queima de ${brl(burn)} por dia`, 'good']
  return [`${dias} dias`, `queima de ${brl(burn)} por dia`, dias < 90 ? 'bad' : null]
}

export default async function VisaoGeral() {
  const sessao = await requireSession()
  const [k, fluxo, agingRec, clientes, avisos] = await Promise.all([
    kpis(sessao), fluxoMensal(sessao), aging(sessao, 'receivable'), topClientes(sessao, 8),
    alertas(sessao),
  ])

  if (!k || (!Number(k.a_receber) && !Number(k.a_pagar) && !fluxo.length)) {
    return (
      <>
        <div className="page-head"><div><h1>Visão geral</h1></div></div>
        <p className="empty">
          Nenhum dado ainda. Conecte uma empresa com <code>npm run connect</code> e rode a carga inicial.
        </p>
      </>
    )
  }

  const [runway, runwayNota, runwayTom] = runwayTexto(Number(k.saldo_atual), Number(k.burn_diario))
  const empresa = sessao.connectionId
    ? sessao.conexoes.find((c) => c.id === sessao.connectionId)?.nome
    : 'Todas as empresas'

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Visão geral</h1>
          <p>{empresa} · saldo apurado em {dataCurta(k.saldo_em)}</p>
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Tile label="Saldo em conta" valor={brl(k.saldo_atual)}
              nota={`${brl(k.entradas_90d)} entraram em 90 dias`} />
        <Tile label="A receber" valor={brl(k.a_receber)}
              nota={Number(k.receber_vencido) > 0 ? `${brl(k.receber_vencido)} vencidos` : 'nada vencido'}
              tom={Number(k.receber_vencido) > 0 ? 'bad' : 'good'} />
        <Tile label="A pagar" valor={brl(k.a_pagar)}
              nota={Number(k.pagar_vencido) > 0 ? `${brl(k.pagar_vencido)} vencidos` : 'nada vencido'}
              tom={Number(k.pagar_vencido) > 0 ? 'bad' : null} />
        <Tile label="Fôlego de caixa" valor={runway} nota={runwayNota} tom={runwayTom} />
      </div>

      <Alerts itens={avisos} />

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Fluxo de caixa</h2>
        <p className="sub">
          Doze meses para trás e seis para frente. Sólido é o que passou pelo caixa, hachurado é o que segue em aberto.
        </p>
        <CashflowChart dados={fluxo} />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Aging de recebíveis</h2>
          <p className="sub">Quanto está em aberto por faixa de atraso.</p>
          <HBars
            dados={agingRec.map((f) => ({
              rotulo: FAIXAS[f.faixa]?.[0] ?? f.faixa,
              cor: FAIXAS[f.faixa]?.[1],
              valor: f.valor,
              nota: `${f.titulos} títulos`,
            }))}
          />
        </div>

        <div className="card">
          <h2>Maiores clientes</h2>
          <p className="sub">Faturamento acumulado no período carregado.</p>
          <HBars
            dados={clientes.map((c) => ({
              rotulo: c.cliente,
              valor: c.faturado,
              detalhes: [
                ['Faturado', brl(c.faturado)],
                ['Vencido', brl(c.vencido)],
                ['Atraso médio', `${Number(c.atraso_medio_dias ?? 0).toFixed(0)} dias`],
              ],
            }))}
          />
        </div>
      </div>
    </>
  )
}
