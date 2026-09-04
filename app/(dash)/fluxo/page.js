import { requireSession } from '@/lib/session'
import { fluxoDeCaixa } from '@/lib/cashflow'
import { brl, dataCurta, pct, rotuloMes } from '@/lib/format'
import { Suspense } from 'react'
import Tile from '@/components/Tile'
import BulletIA from '@/components/BulletIA'
import SaldoChart from '@/components/charts/SaldoChart'
import MovimentoChart from '@/components/charts/MovimentoChart'
import LinhasFluxo from '@/components/charts/LinhasFluxo'

export const dynamic = 'force-dynamic'

const HORIZONTES = [3, 6, 12]

export default async function Fluxo({ searchParams }) {
  const sessao = await requireSession()
  const busca = await searchParams
  const frente = HORIZONTES.includes(Number(busca?.meses)) ? Number(busca.meses) : 6

  const f = await fluxoDeCaixa(sessao, { mesesAtras: 12, mesesFrente: frente })

  if (!f.meses.length) {
    return (
      <>
        <div className="page-head"><div><h1>Fluxo de caixa</h1></div></div>
        <p className="empty">Sem movimento carregado ainda.</p>
      </>
    )
  }

  // Tudo o que ainda vai acontecer, contado a partir de hoje. Do mês em curso
  // entra só a parte que ainda não passou pelo caixa, senão o total projetado
  // contaria de novo dinheiro que já está no saldo de hoje.
  const aVir = f.meses
    .filter((m) => m.tipo === 'previsto' || m.tipo === 'parcial')
    .map((m) => (m.tipo === 'parcial'
      ? {
          entradas: m.aReceberNoMes ?? 0,
          saidas: m.aPagarNoMes ?? 0,
          carteiraEntradas: m.carteiraEntradas ?? 0,
          novosEntradas: m.novosEntradas ?? 0,
        }
      : m))

  const variacao = f.saldoFinal - f.saldoHoje
  const entradasPrev = aVir.reduce((a, m) => a + m.entradas, 0)
  const saidasPrev = aVir.reduce((a, m) => a + m.saidas, 0)
  const carteira = aVir.reduce((a, m) => a + (m.carteiraEntradas ?? 0), 0)
  const estimado = aVir.reduce((a, m) => a + (m.novosEntradas ?? 0), 0)
  const parteCarteira = entradasPrev > 0 ? carteira / entradasPrev : 0
  const apertaAbaixoDe = f.pior && f.pior.saldoFim < f.saldoHoje * 0.5

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Fluxo de caixa</h1>
          <p>
            Doze meses medidos e {frente} projetados. Saldo apurado em {dataCurta(f.saldoEm)}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>projetar</span>
          {HORIZONTES.map((h) => (
            <a key={h} href={`/fluxo?meses=${h}`} className="toggle"
               style={h === frente ? {
                 borderColor: 'var(--series-1)', color: 'var(--series-1)', fontWeight: 600,
               } : undefined}>
              {h} meses
            </a>
          ))}
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Tile label="Saldo hoje" valor={brl(f.saldoHoje)}
              nota={`${f.contas.length} conta${f.contas.length === 1 ? '' : 's'} financeira${f.contas.length === 1 ? '' : 's'}`}
              insight={<Suspense fallback={null}><BulletIA sessao={sessao} chave="saldo" /></Suspense>} />
        <Tile label={`Saldo projetado em ${frente} meses`} valor={brl(f.saldoFinal)}
              nota={`${variacao >= 0 ? 'crescimento' : 'queda'} de ${brl(Math.abs(variacao))}`}
              tom={variacao >= 0 ? 'good' : 'bad'} 
              insight={<Suspense fallback={null}><BulletIA sessao={sessao} chave="saldo_projetado" /></Suspense>} />
        <Tile label="Menor saldo do período"
              valor={f.pior ? brl(f.pior.saldoFim) : '—'}
              nota={f.pior ? `em ${rotuloMes(f.pior.competencia)}` : 'sem projeção'}
              tom={f.pior && f.pior.saldoFim < 0 ? 'bad' : apertaAbaixoDe ? 'bad' : 'good'} 
              insight={<Suspense fallback={null}><BulletIA sessao={sessao} chave="menor_saldo" /></Suspense>} />
        <Tile label="Resultado projetado" valor={brl(entradasPrev - saidasPrev)}
              nota={`${brl(entradasPrev)} a entrar, ${brl(saidasPrev)} a sair`}
              tom={entradasPrev - saidasPrev >= 0 ? 'good' : 'bad'} 
              insight={<Suspense fallback={null}><BulletIA sessao={sessao} chave="resultado_projetado" /></Suspense>} />
      </div>

      {f.pior && f.pior.saldoFim < 0 && (
        <p style={{
          background: 'color-mix(in srgb, var(--critical) 12%, transparent)',
          border: '1px solid var(--critical)', borderRadius: 8, padding: '10px 14px',
          fontSize: 13, marginTop: 0,
        }}>
          <strong>Caixa negativo previsto.</strong> Em {rotuloMes(f.pior.competencia)} o saldo chega a{' '}
          {brl(f.pior.saldoFim)}. Use a tela de Previsão para testar cenários de corte ou antecipação.
        </p>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Saldo em conta</h2>
        <p className="sub">
          Até hoje é o saldo reconstruído a partir das baixas. Daí em diante é projeção.
        </p>
        <SaldoChart meses={f.meses} mesAtual={f.mesAtual} fracaoDoMes={f.fracaoDoMes} />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Entradas, saídas e resultado</h2>
        <p className="sub">
          A distância entre as duas linhas é a margem do mês. Clique na legenda para isolar uma série.
        </p>
        <LinhasFluxo meses={f.meses} mesAtual={f.mesAtual} fracaoDoMes={f.fracaoDoMes} />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Entradas e saídas mês a mês</h2>
        <p className="sub">
          A mesma informação em barras, para comparar os dois lados dentro de cada mês.
          Sólido é o que passou pelo caixa, hachurado é projeção.
        </p>
        <MovimentoChart meses={f.meses} mesAtual={f.mesAtual} />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>De onde vem o previsto</h2>
          <p className="sub">
            Quanto da entrada projetada já está lançada no ERP e quanto é estimativa.
          </p>
          <table>
            <tbody>
              <tr>
                <td>Títulos já lançados</td>
                <td className="num">{brl(carteira)}</td>
                <td className="num" style={{ color: 'var(--text-muted)' }}>{pct(parteCarteira)}</td>
              </tr>
              <tr>
                <td>Novos negócios estimados</td>
                <td className="num">{brl(estimado)}</td>
                <td className="num" style={{ color: 'var(--text-muted)' }}>{pct(1 - parteCarteira)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td>Total a entrar</td>
                <td className="num">{brl(entradasPrev)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
            Quanto maior a fatia já lançada, mais firme é a projeção. A parte estimada sai da
            média dos últimos 12 meses ajustada pela sazonalidade, e sobre os títulos aplicamos a
            taxa de {pct(f.premissas.taxaNoPrazo)}, que é quanto do que vence costuma entrar
            até 30 dias depois nesta empresa.
          </p>
        </div>

        <div className="card">
          <h2>Onde está o dinheiro hoje</h2>
          <p className="sub">Saldo por conta financeira na última apuração.</p>
          <table>
            <thead>
              <tr><th>Conta</th><th>Tipo</th><th className="num">Saldo</th></tr>
            </thead>
            <tbody>
              {f.contas.map((c, i) => (
                <tr key={i}>
                  <td>{c.nome}</td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {String(c.tipo ?? '').toLowerCase().replaceAll('_', ' ')}
                  </td>
                  <td className="num">{brl(c.saldo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td><td />
                <td className="num">{brl(f.saldoHoje)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  )
}
