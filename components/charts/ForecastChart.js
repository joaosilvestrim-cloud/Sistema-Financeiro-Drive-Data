'use client'
import { useMemo, useState } from 'react'
import { brl, compacto, rotuloMes } from '@/lib/format'

// Saldo projetado mês a mês, com cenários.
//
// A linha é o saldo acumulado, que é a pergunta que o dono do negócio faz de
// verdade: em que mês o caixa aperta. Entradas e saídas do mês ficam na tabela
// logo abaixo, para não empilhar três formas no mesmo desenho.

const W = 960
const H = 260
const M = { top: 18, right: 16, bottom: 30, left: 62 }

const CENARIOS = [
  { chave: 'atraso', rotulo: 'Atraso no recebimento', min: 0, max: 40, passo: 5, unidade: '%',
    ajuda: 'parte do que entraria no mês escorrega para o mês seguinte' },
  { chave: 'corte', rotulo: 'Corte de despesa', min: 0, max: 30, passo: 5, unidade: '%',
    ajuda: 'redução aplicada sobre todas as saídas previstas' },
  { chave: 'perda', rotulo: 'Perda do maior cliente', min: 0, max: 100, passo: 25, unidade: '%',
    ajuda: 'quanto do faturamento do maior cliente deixa de entrar' },
  { chave: 'novos', rotulo: 'Novos negócios', min: -50, max: 50, passo: 10, unidade: '%',
    ajuda: 'ajuste sobre a parte ainda não lançada no ERP' },
]

export default function ForecastChart({ base }) {
  const [cenario, setCenario] = useState({ atraso: 0, corte: 0, perda: 0, novos: 0 })
  const [ativo, setAtivo] = useState(null)

  const linhas = useMemo(() => {
    const fatorNovos = 1 + cenario.novos / 100
    const fatorPerda = 1 - (cenario.perda / 100) * base.participacaoMaiorCliente
    const fatorCorte = 1 - cenario.corte / 100
    const fatorAtraso = cenario.atraso / 100

    const brutas = base.linhas.map((l) => ({
      competencia: l.competencia,
      entradas: (l.carteiraEntradas * base.taxaNoPrazo + l.novosEntradas * base.taxaNoPrazo * fatorNovos) * fatorPerda,
      saidas: (l.carteiraSaidas + l.novosSaidas * fatorNovos) * fatorCorte,
    }))

    // O atraso empurra parte da entrada para o mês seguinte. O último mês do
    // horizonte carrega o resto, senão o dinheiro simplesmente sumiria.
    const ajustadas = brutas.map((b) => ({ ...b, entradas: b.entradas * (1 - fatorAtraso) }))
    for (let i = 0; i < brutas.length; i++) {
      const adiado = brutas[i].entradas * fatorAtraso
      const destino = Math.min(i + 1, ajustadas.length - 1)
      ajustadas[destino].entradas += adiado
    }

    let saldo = base.saldoInicial
    return ajustadas.map((a) => {
      saldo += a.entradas - a.saidas
      return { ...a, liquido: a.entradas - a.saidas, saldo }
    })
  }, [base, cenario])

  const saldos = [base.saldoInicial, ...linhas.map((l) => l.saldo)]
  const menorSaldo = Math.min(...saldos)
  const maiorSaldo = Math.max(...saldos)
  // O zero entra na escala quando ele está em jogo. Se todos os meses estão
  // muito acima dele, forçar o zero achata a linha e esconde a variação, que é
  // justamente o que se quer ler aqui. Truncar eixo de linha é aceitável, o que
  // não vale é truncar eixo de barra.
  const perigo = menorSaldo < maiorSaldo * 0.25
  const minimo = perigo ? Math.min(menorSaldo, 0) : menorSaldo
  const maximo = maiorSaldo
  const folga = (maximo - minimo) * 0.15 || 1
  const topo = maximo + folga
  const piso = minimo - folga

  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const x = (i) => M.left + (i / (saldos.length - 1)) * plotW
  const y = (v) => M.top + plotH - ((v - piso) / (topo - piso)) * plotH

  const pontos = saldos.map((v, i) => [x(i), y(v)])
  const caminho = pontos.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')
  // A área fecha na base do desenho, não no zero, senão com eixo truncado ela
  // vazaria para fora do gráfico.
  const baseDesenho = (M.top + plotH).toFixed(1)
  const area = `${caminho} L${pontos.at(-1)[0].toFixed(1)} ${baseDesenho} L${pontos[0][0].toFixed(1)} ${baseDesenho} z`

  const primeiroNegativo = linhas.find((l) => l.saldo < 0)
  const ticks = [piso, piso + (topo - piso) / 2, topo]

  return (
    <div>
      <div className="grid cols-4" style={{ marginBottom: 16, gap: 12 }}>
        {CENARIOS.map((c) => (
          <label key={c.chave} style={{ display: 'block' }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
              <span>{c.rotulo}</span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                {cenario[c.chave] > 0 ? '+' : ''}{cenario[c.chave]}{c.unidade}
              </strong>
            </div>
            <input
              type="range" min={c.min} max={c.max} step={c.passo}
              value={cenario[c.chave]}
              onChange={(e) => setCenario((s) => ({ ...s, [c.chave]: Number(e.target.value) }))}
              style={{ width: '100%', padding: 0, marginTop: 4 }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.ajuda}</div>
          </label>
        ))}
      </div>

      {primeiroNegativo ? (
        <p style={{
          background: 'color-mix(in srgb, var(--critical) 12%, transparent)',
          border: '1px solid var(--critical)', borderRadius: 8, padding: '8px 12px',
          fontSize: 13, margin: '0 0 14px',
        }}>
          <strong>Atenção.</strong> Nesse cenário o saldo fica negativo em{' '}
          {rotuloMes(primeiroNegativo.competencia)}, chegando a {brl(primeiroNegativo.saldo)}.
        </p>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
          O saldo se mantém positivo em todo o horizonte, terminando em {brl(linhas.at(-1)?.saldo ?? 0)}.
        </p>
      )}

      <div className="chart-wrap" onMouseLeave={() => setAtivo(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Saldo de caixa projetado">
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
                {compacto(t)}
              </text>
            </g>
          ))}

          {piso < 0 && (
            <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)}
                  stroke="var(--critical)" strokeWidth="1" strokeDasharray="4 3" />
          )}

          <path d={area} fill="var(--series-1)" opacity="0.10" />
          <path d={caminho} fill="none" stroke="var(--series-1)" strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />

          {pontos.map(([px, py], i) => (
            <circle key={i} cx={px} cy={py} r={ativo === i ? 5 : 3.5}
                    fill={saldos[i] < 0 ? 'var(--critical)' : 'var(--series-1)'}
                    stroke="var(--surface)" strokeWidth="2" />
          ))}

          {saldos.map((_, i) => (
            <g key={`h${i}`}>
              <rect x={x(i) - plotW / (saldos.length - 1) / 2} y={M.top}
                    width={plotW / (saldos.length - 1)} height={plotH}
                    fill="transparent" onMouseEnter={() => setAtivo(i)} />
              <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--text-muted)">
                {i === 0 ? 'hoje' : rotuloMes(linhas[i - 1].competencia)}
              </text>
            </g>
          ))}

          {ativo !== null && (
            <line x1={x(ativo)} x2={x(ativo)} y1={M.top} y2={M.top + plotH}
                  stroke="var(--axis)" strokeWidth="1" />
          )}
        </svg>

        {ativo !== null && (
          <div className="tooltip" style={{ left: `${Math.min(76, (x(ativo) / W) * 100)}%`, top: 4 }}>
            <div className="t-title">{ativo === 0 ? 'Saldo de hoje' : rotuloMes(linhas[ativo - 1].competencia)}</div>
            <div className="t-row"><span>Saldo</span><span>{brl(saldos[ativo])}</span></div>
            {ativo > 0 && (
              <>
                <div className="t-row"><span>Entradas</span><span>{brl(linhas[ativo - 1].entradas)}</span></div>
                <div className="t-row"><span>Saídas</span><span>{brl(linhas[ativo - 1].saidas)}</span></div>
              </>
            )}
          </div>
        )}
      </div>

      <table style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th>Mês</th>
            <th className="num">Entradas</th>
            <th className="num">Saídas</th>
            <th className="num">Líquido</th>
            <th className="num">Saldo ao fim</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.competencia}>
              <td>{rotuloMes(l.competencia)}</td>
              <td className="num">{brl(l.entradas)}</td>
              <td className="num">{brl(l.saidas)}</td>
              <td className="num" style={{ color: l.liquido < 0 ? 'var(--critical)' : undefined }}>
                {brl(l.liquido)}
              </td>
              <td className="num" style={{ fontWeight: 600, color: l.saldo < 0 ? 'var(--critical)' : undefined }}>
                {brl(l.saldo)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
