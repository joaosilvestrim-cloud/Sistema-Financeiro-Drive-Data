import { requireSession } from '@/lib/session'
import { comAviso } from '@/lib/acao'
import Aviso from '@/components/Aviso'
import { kpis, fluxoMensal, aging, topClientes, saldosPorConta } from '@/lib/queries'
import { alertas } from '@/lib/alerts'
import { analiseSalva, gerarAnalise } from '@/lib/analise'
import Alerts from '@/components/Alerts'
import AnaliseIA from '@/components/AnaliseIA'
import { brl, dataCurta } from '@/lib/format'
import { revalidatePath } from 'next/cache'
import { Suspense } from 'react'
import Tile from '@/components/Tile'
import BulletIA from '@/components/BulletIA'
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

const TIPO_CONTA = {
  CONTA_CORRENTE: 'Conta corrente',
  POUPANCA: 'Poupança',
  CAIXINHA: 'Caixinha',
  CARTAO_CREDITO: 'Cartão de crédito',
  INVESTIMENTO: 'Investimento',
  OUTROS: 'Outros',
}

// O saldo vem de uma foto tirada na sincronização. Se a foto é de ontem ou
// antes, o número na tela não é mais o saldo de agora, e a tela precisa dizer
// isso em vez de fingir que está atual.
function desatualizada(data) {
  if (!data) return true
  const hoje = new Date()
  const d = new Date(data)
  return (hoje - d) / 86400000 > 1
}

function runwayTexto(saldo, burn) {
  if (!burn || burn <= 0) return ['Caixa positivo', 'entra mais do que sai nos últimos 90 dias', 'good']
  const dias = Math.floor(saldo / burn)
  if (dias > 720) return ['Mais de 2 anos', `queima de ${brl(burn)} por dia`, 'good']
  return [`${dias} dias`, `queima de ${brl(burn)} por dia`, dias < 90 ? 'bad' : null]
}

export default async function VisaoGeral({ searchParams }) {
  const sessao = await requireSession()
  const erro = (await searchParams)?.erro ?? null
  // Os KPIs vao primeiro porque os alertas se apoiam neles. O resto corre junto.
  const k = await kpis(sessao)
  const [fluxo, agingRec, clientes, avisos, analise, contas] = await Promise.all([
    fluxoMensal(sessao), aging(sessao, 'receivable'), topClientes(sessao, 8),
    alertas(sessao, k), analiseSalva(sessao), saldosPorConta(sessao),
  ])

  async function gerar() {
    'use server'
    // A analise sai de um modelo de linguagem por rede. Fora do ar, com a cota
    // estourada ou lento demais, isso lanca; e derrubar a tela de entrada do
    // sistema por causa de um texto opcional seria o pior negocio possivel.
    await comAviso('/', async () => {
      const s = await requireSession()
      await gerarAnalise(s)
    })
  }

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

      <Aviso erro={erro} />

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Tile label="Saldo em conta" valor={brl(k.saldo_atual)}
              nota={`${brl(k.entradas_90d)} entraram em 90 dias`} 
              insight={<Suspense fallback={null}><BulletIA sessao={sessao} chave="saldo" /></Suspense>} />
        <Tile label="A receber" valor={brl(k.a_receber)}
              nota={Number(k.receber_vencido) > 0 ? `${brl(k.receber_vencido)} vencidos` : 'nada vencido'}
              tom={Number(k.receber_vencido) > 0 ? 'bad' : 'good'} 
              insight={<Suspense fallback={null}><BulletIA sessao={sessao} chave="a_receber" /></Suspense>} />
        <Tile label="A pagar" valor={brl(k.a_pagar)}
              nota={Number(k.pagar_vencido) > 0 ? `${brl(k.pagar_vencido)} vencidos` : 'nada vencido'}
              tom={Number(k.pagar_vencido) > 0 ? 'bad' : null} 
              insight={<Suspense fallback={null}><BulletIA sessao={sessao} chave="a_pagar" /></Suspense>} />
        <Tile label="Fôlego de caixa" valor={runway} nota={runwayNota} tom={runwayTom} 
              insight={<Suspense fallback={null}><BulletIA sessao={sessao} chave="folego" /></Suspense>} />
      </div>


      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Saldo por conta</h2>
        <p className="sub">
          Saldo atual de cada conta financeira, como o Conta Azul devolveu na última sincronização.
        </p>
        <table>
          <thead>
            <tr><th>Conta</th><th>Tipo</th><th className="num">Saldo</th><th>Apurado em</th></tr>
          </thead>
          <tbody>
            {contas.map((c, i) => (
              <tr key={i}>
                <td>{c.nome}</td>
                <td>{TIPO_CONTA[c.tipo] ?? c.tipo ?? '—'}</td>
                <td className="num" style={Number(c.saldo) < 0 ? { color: 'var(--critical)' } : undefined}>
                  {brl(c.saldo)}
                </td>
                <td style={desatualizada(c.snapshot_date) ? { color: 'var(--warning)' } : undefined}>
                  {dataCurta(c.snapshot_date)}
                  {desatualizada(c.snapshot_date) && ' · desatualizado'}
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 600 }}>
              <td>Total</td><td></td>
              <td className="num">{brl(contas.reduce((a, c) => a + Number(c.saldo), 0))}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      <Alerts itens={avisos} />

      <AnaliseIA analise={analise} acao={gerar} />

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
