'use client'
import { useState, useId } from 'react'
import { brl, compacto, rotuloMes } from '@/lib/format'

// Saldo em conta ao longo do tempo, com o passado e o futuro na mesma linha.
//
// O corte entre medido e projetado é marcado de três formas ao mesmo tempo, e
// não só pela cor: a linha vira tracejada, o ponto fica vazado e existe uma
// régua vertical em "hoje". Quem imprime em preto e branco continua entendendo.

const W = 980
const H = 300
const M = { top: 20, right: 18, bottom: 34, left: 66 }

export default function SaldoChart({ meses, mesAtual, fracaoDoMes = 0.5 }) {
  const [ativo, setAtivo] = useState(null)
  const [tabela, setTabela] = useState(false)
  const uid = useId().replace(/:/g, '')

  if (meses.length < 2) return <p className="empty">Histórico insuficiente para desenhar a curva.</p>

  const saldos = meses.map((m) => m.saldoFim)
  const menor = Math.min(...saldos)
  const maior = Math.max(...saldos)
  // O zero entra na escala quando o saldo chega perto dele. Longe do zero, forçá-lo
  // achata a curva e esconde justamente a variação que se quer ler.
  const perigo = menor < maior * 0.3
  const piso0 = perigo ? Math.min(menor, 0) : menor
  const folga = (maior - piso0) * 0.14 || 1
  const topo = maior + folga
  const piso = piso0 - folga

  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const x = (i) => M.left + (i / (meses.length - 1)) * plotW
  const y = (v) => M.top + plotH - ((v - piso) / (topo - piso)) * plotH
  const base = M.top + plotH

  const iAtual = Math.max(0, meses.findIndex((m) => m.competencia === mesAtual))
  // O fim do mes corrente ja e projecao, entao o trecho solido para no ultimo
  // mes inteiramente medido.
  const iCorte = Math.max(0, iAtual - 1)
  const pontos = meses.map((m, i) => [x(i), y(m.saldoFim)])
  const caminho = (de, ate) => pontos.slice(de, ate + 1)
    .map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')

  const areaAte = pontos.slice(0, iCorte + 1)
  const area = areaAte.length > 1
    ? `${caminho(0, iCorte)} L${areaAte.at(-1)[0].toFixed(1)} ${base} L${areaAte[0][0].toFixed(1)} ${base} z`
    : null

  const ticks = [piso, piso + (topo - piso) / 2, topo]
  const zeroVisivel = piso < 0 && topo > 0

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="legend">
          <span><i style={{ background: 'var(--series-1)' }} />Saldo medido</span>
          <span>
            <i style={{
              background: 'transparent',
              borderTop: '2px dashed var(--series-1)',
              height: 0, borderRadius: 0, width: 14,
            }} />
            Saldo projetado
          </span>
        </div>
        <button className="toggle" onClick={() => setTabela((v) => !v)}>
          {tabela ? 'ver gráfico' : 'ver dados'}
        </button>
      </div>

      {tabela ? (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Mês</th><th>Situação</th>
                <th className="num">Saldo inicial</th><th className="num">Entradas</th>
                <th className="num">Saídas</th><th className="num">Líquido</th>
                <th className="num">Saldo final</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => (
                <tr key={m.competencia}>
                  <td>{rotuloMes(m.competencia)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {m.tipo === 'realizado' ? 'medido' : m.tipo === 'parcial' ? 'mês em curso' : 'projetado'}
                  </td>
                  <td className="num">{brl(m.saldoInicio)}</td>
                  <td className="num">{brl(m.entradas)}</td>
                  <td className="num">{brl(m.saidas)}</td>
                  <td className="num" style={{ color: m.liquido < 0 ? 'var(--critical)' : undefined }}>
                    {brl(m.liquido)}
                  </td>
                  <td className="num" style={{ fontWeight: 600, color: m.saldoFim < 0 ? 'var(--critical)' : undefined }}>
                    {brl(m.saldoFim)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-wrap" onMouseLeave={() => setAtivo(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
               aria-label="Saldo em conta por mês, medido até hoje e projetado adiante">
            <defs>
              <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {ticks.map((t, i) => (
              <g key={i}>
                <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
                <text x={M.left - 10} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
                  {compacto(t)}
                </text>
              </g>
            ))}

            {zeroVisivel && (
              <>
                <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)}
                      stroke="var(--critical)" strokeWidth="1" strokeDasharray="5 4" />
                <text x={W - M.right} y={y(0) - 5} textAnchor="end" fontSize="10" fill="var(--critical)">
                  caixa zero
                </text>
              </>
            )}

            {area && <path d={area} fill={`url(#g${uid})`} />}

            <path d={caminho(0, iCorte)} fill="none" stroke="var(--series-1)" strokeWidth="2.5"
                  strokeLinejoin="round" strokeLinecap="round" />
            {iCorte < meses.length - 1 && (
              <path d={caminho(iCorte, meses.length - 1)} fill="none" stroke="var(--series-1)"
                    strokeWidth="2.5" strokeDasharray="6 5" strokeLinejoin="round" strokeLinecap="round" />
            )}

            {(() => {
              // Hoje cai dentro do mes corrente, proporcional ao dia.
              const xHoje = x(iCorte) + (x(iAtual) - x(iCorte)) * fracaoDoMes
              return (
                <>
                  <line x1={xHoje} x2={xHoje} y1={M.top - 6} y2={base}
                        stroke="var(--axis)" strokeWidth="1" />
                  <text x={xHoje} y={M.top - 10} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
                    hoje
                  </text>
                </>
              )
            })()}

            {pontos.map(([px, py], i) => {
              const futuro = i > iCorte
              const negativo = meses[i].saldoFim < 0
              return (
                <circle key={i} cx={px} cy={py} r={ativo === i ? 5.5 : 4}
                        fill={futuro ? 'var(--surface)' : negativo ? 'var(--critical)' : 'var(--series-1)'}
                        stroke={negativo ? 'var(--critical)' : 'var(--series-1)'} strokeWidth="2" />
              )
            })}

            {meses.map((m, i) => (
              <g key={m.competencia}>
                <rect x={x(i) - plotW / (meses.length - 1) / 2} y={M.top}
                      width={plotW / (meses.length - 1)} height={plotH}
                      fill="transparent" onMouseEnter={() => setAtivo(i)} />
                {(meses.length <= 14 || i % 2 === 0) && (
                  <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="11"
                        fill={i === iCorte ? 'var(--text-primary)' : 'var(--text-muted)'}>
                    {rotuloMes(m.competencia)}
                  </text>
                )}
              </g>
            ))}
          </svg>

          {ativo !== null && (
            <div className="tooltip" style={{ left: `${Math.min(72, (x(ativo) / W) * 100)}%`, top: 6 }}>
              <div className="t-title">
                {rotuloMes(meses[ativo].competencia)}
                <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                  {' · '}
                  {meses[ativo].tipo === 'realizado' ? 'medido'
                    : meses[ativo].tipo === 'parcial' ? 'em curso' : 'projetado'}
                </span>
              </div>
              <div className="t-row"><span>Entradas</span><span>{brl(meses[ativo].entradas)}</span></div>
              <div className="t-row"><span>Saídas</span><span>{brl(meses[ativo].saidas)}</span></div>
              <div className="t-row"><span>Líquido</span><span>{brl(meses[ativo].liquido)}</span></div>
              <div className="t-row" style={{ marginTop: 5, fontWeight: 600 }}>
                <span>Saldo ao fim</span><span>{brl(meses[ativo].saldoFim)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
