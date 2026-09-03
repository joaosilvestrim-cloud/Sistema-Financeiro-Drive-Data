'use client'
import { useState, useId } from 'react'
import { brl, compacto, rotuloMes } from '@/lib/format'

// Fluxo de caixa mensal.
//
// Duas barras por mês, entradas e saídas, cada uma empilhando o que já passou
// pelo caixa (sólido) e o que segue em aberto (hachurado). Nos meses passados o
// hachurado é inadimplência, nos futuros é previsão. Um eixo só,
// porque as duas séries são a mesma unidade. A hachura é o canal de acesso
// além da cor: distingue caixa de em aberto mesmo sem enxergar matiz.

const W = 960
const H = 300
const M = { top: 16, right: 12, bottom: 34, left: 56 }

export default function CashflowChart({ dados }) {
  const [ativo, setAtivo] = useState(null)
  const [tabela, setTabela] = useState(false)
  const uid = useId().replace(/:/g, '')

  if (!dados.length) return <p className="empty">Sem movimento no período.</p>

  const mesAtual = new Date().toISOString().slice(0, 7)
  const linhas = dados.map((d) => {
    const entR = Number(d.entradas_realizadas ?? 0)
    const entP = Number(d.entradas_previstas ?? 0)
    const saiR = Number(d.saidas_realizadas ?? 0)
    const saiP = Number(d.saidas_previstas ?? 0)
    return {
      competencia: d.competencia, entR, entP, saiR, saiP,
      entradas: entR + entP, saidas: saiR + saiP,
      liquido: entR + entP - saiR - saiP,
      futuro: d.competencia > mesAtual,
    }
  })

  const maximo = Math.max(...linhas.flatMap((l) => [l.entradas, l.saidas]), 1)
  const teto = Math.ceil(maximo / 10000) * 10000 || maximo
  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const grupoW = plotW / linhas.length
  const barraW = Math.min(26, grupoW * 0.32)
  const y = (v) => M.top + plotH - (v / teto) * plotH
  const alturaDe = (v) => (v / teto) * plotH

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * teto)
  const primeiroFuturo = linhas.findIndex((l) => l.futuro)

  // Barra empilhada com topo arredondado e 2px de folga entre os segmentos.
  const Barra = ({ x, realizado, previsto, cor, padrao }) => {
    const hR = alturaDe(realizado)
    const hP = alturaDe(previsto)
    const base = M.top + plotH
    const temPrevisto = hP > 0.5
    const gap = temPrevisto && hR > 0.5 ? 2 : 0
    const topoR = base - hR
    const topoP = topoR - gap - hP
    const r = 4
    return (
      <>
        {hR > 0.5 && (
          <path
            d={temPrevisto
              ? `M${x} ${base} v${-hR} h${barraW} v${hR} z`
              : `M${x} ${base} v${-(hR - r)} a${r} ${r} 0 0 1 ${r} ${-r} h${barraW - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} v${hR - r} z`}
            fill={cor}
          />
        )}
        {temPrevisto && (
          <path
            d={`M${x} ${topoP + hP} v${-(hP - r)} a${r} ${r} 0 0 1 ${r} ${-r} h${barraW - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} v${hP - r} z`}
            fill={`url(#${padrao})`}
            stroke={cor}
            strokeWidth="1"
          />
        )}
      </>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="legend">
          <span><i style={{ background: 'var(--series-1)' }} />Entradas</span>
          <span><i style={{ background: 'var(--series-2)' }} />Saídas</span>
          <span><i style={{ background: 'var(--surface)', boxShadow: 'inset 0 0 0 1px var(--axis)', backgroundImage: 'repeating-linear-gradient(45deg, var(--axis) 0 1px, transparent 1px 4px)' }} />Em aberto</span>
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
                <th>Mês</th><th className="num">Entradas</th><th className="num">Saídas</th><th className="num">Líquido</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.competencia}>
                  <td>{rotuloMes(l.competencia)}{l.futuro ? ' (previsto)' : ''}</td>
                  <td className="num">{brl(l.entradas)}</td>
                  <td className="num">{brl(l.saidas)}</td>
                  <td className="num">{brl(l.liquido)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-wrap" onMouseLeave={() => setAtivo(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
               aria-label="Fluxo de caixa mensal, entradas e saídas, realizado e previsto">
            <defs>
              <pattern id={`p1${uid}`} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                <rect width="6" height="6" fill="var(--surface)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--series-1)" strokeWidth="2.5" />
              </pattern>
              <pattern id={`p2${uid}`} width="6" height="6" patternTransform="rotate(135)" patternUnits="userSpaceOnUse">
                <rect width="6" height="6" fill="var(--surface)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--series-2)" strokeWidth="2.5" />
              </pattern>
            </defs>

            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)}
                      stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth="1" />
                <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
                  {compacto(t)}
                </text>
              </g>
            ))}

            {primeiroFuturo > 0 && (
              <line
                x1={M.left + primeiroFuturo * grupoW} x2={M.left + primeiroFuturo * grupoW}
                y1={M.top} y2={M.top + plotH}
                stroke="var(--axis)" strokeWidth="1" strokeDasharray="3 3"
              />
            )}

            {linhas.map((l, i) => {
              const x0 = M.left + i * grupoW
              const centro = x0 + grupoW / 2
              return (
                <g key={l.competencia}>
                  {ativo === i && (
                    <rect x={x0} y={M.top} width={grupoW} height={plotH}
                          fill="var(--text-primary)" opacity="0.04" />
                  )}
                  <Barra x={centro - barraW - 2} realizado={l.entR} previsto={l.entP}
                         cor="var(--series-1)" padrao={`p1${uid}`} />
                  <Barra x={centro + 2} realizado={l.saiR} previsto={l.saiP}
                         cor="var(--series-2)" padrao={`p2${uid}`} />
                  <text x={centro} y={H - 12} textAnchor="middle" fontSize="11"
                        fill={i === new Date().getMonth() % 12 && l.competencia === mesAtual ? 'var(--text-primary)' : 'var(--text-muted)'}>
                    {rotuloMes(l.competencia)}
                  </text>
                  <rect x={x0} y={M.top} width={grupoW} height={plotH} fill="transparent"
                        onMouseEnter={() => setAtivo(i)} />
                </g>
              )
            })}
          </svg>

          {ativo !== null && (
            <div className="tooltip" style={{
              left: `${Math.min(78, ((M.left + ativo * grupoW + grupoW / 2) / W) * 100)}%`,
              top: 8,
            }}>
              <div className="t-title">
                {rotuloMes(linhas[ativo].competencia)}{linhas[ativo].futuro ? ' · previsto' : ''}
              </div>
              <div className="t-row"><span>Entradas</span><span>{brl(linhas[ativo].entradas)}</span></div>
              {linhas[ativo].entP > 0 && (
                <div className="t-row"><span style={{ color: 'var(--text-muted)' }}>a receber</span>
                  <span style={{ color: 'var(--text-muted)' }}>{brl(linhas[ativo].entP)}</span></div>
              )}
              <div className="t-row"><span>Saídas</span><span>{brl(linhas[ativo].saidas)}</span></div>
              {linhas[ativo].saiP > 0 && (
                <div className="t-row"><span style={{ color: 'var(--text-muted)' }}>a pagar</span>
                  <span style={{ color: 'var(--text-muted)' }}>{brl(linhas[ativo].saiP)}</span></div>
              )}
              <div className="t-row" style={{ marginTop: 4, fontWeight: 600 }}>
                <span>Líquido</span><span>{brl(linhas[ativo].liquido)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
