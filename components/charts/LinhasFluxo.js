'use client'
import { useState, useId } from 'react'
import { brl, compacto, rotuloMes } from '@/lib/format'

// Entradas, saídas e resultado como linhas.
//
// Barra é boa para comparar dois valores num mês. Linha é boa para ler o
// movimento ao longo do tempo, que é o que se quer aqui: se a receita está
// subindo, se a despesa acompanha, e se a distância entre as duas abre ou
// fecha. A área entre as linhas é justamente essa distância.
//
// As três séries são a mesma unidade e dividem um eixo só. Eixo duplo mentiria
// sobre a relação entre elas.

const W = 980
const H = 300
const M = { top: 18, right: 18, bottom: 34, left: 68 }

const SERIES = [
  { chave: 'entradas', rotulo: 'Entradas', cor: 'var(--series-1)' },
  { chave: 'saidas', rotulo: 'Saídas', cor: 'var(--series-2)' },
  { chave: 'liquido', rotulo: 'Resultado', cor: 'var(--series-3)' },
]

export default function LinhasFluxo({ meses, mesAtual, fracaoDoMes = 0.5 }) {
  const [ativo, setAtivo] = useState(null)
  const [ocultas, setOcultas] = useState({})
  const [tabela, setTabela] = useState(false)
  const uid = useId().replace(/:/g, '')

  if (meses.length < 2) return <p className="empty">Período curto demais para desenhar a curva.</p>

  const visiveis = SERIES.filter((s) => !ocultas[s.chave])
  const valores = meses.flatMap((m) => visiveis.map((s) => m[s.chave] ?? 0))
  const menor = Math.min(...valores, 0)
  const maior = Math.max(...valores, 1)
  const folga = (maior - menor) * 0.12 || 1
  const topo = maior + folga
  const piso = menor - folga

  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const x = (i) => M.left + (i / (meses.length - 1)) * plotW
  const y = (v) => M.top + plotH - ((v - piso) / (topo - piso)) * plotH

  const iAtual = Math.max(0, meses.findIndex((m) => m.competencia === mesAtual))
  const iCorte = Math.max(0, iAtual - 1)
  const xHoje = x(iCorte) + (x(iAtual) - x(iCorte)) * fracaoDoMes

  const linha = (chave, de, ate) => meses.slice(de, ate + 1)
    .map((m, k) => `${k ? 'L' : 'M'}${x(de + k).toFixed(1)} ${y(m[chave] ?? 0).toFixed(1)}`).join(' ')

  // A faixa entre entradas e saídas mostra a margem de um jeito que nenhuma das
  // duas linhas sozinha mostra.
  const faixa = !ocultas.entradas && !ocultas.saidas
    ? `${meses.map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(m.entradas).toFixed(1)}`).join(' ')} `
      + `${meses.map((m, i) => `${i ? 'L' : 'M'}${x(meses.length - 1 - i).toFixed(1)} ${y(meses[meses.length - 1 - i].saidas).toFixed(1)}`).join(' ').replace('M', 'L')} z`
    : null

  const ticks = [piso, piso + (topo - piso) / 2, topo]
  const zeroVisivel = piso < 0 && topo > 0

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
        <div className="legend">
          {SERIES.map((s) => (
            <button
              key={s.chave}
              onClick={() => setOcultas((o) => ({ ...o, [s.chave]: !o[s.chave] }))}
              title={ocultas[s.chave] ? 'mostrar' : 'ocultar'}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                font: 'inherit', color: 'inherit',
                opacity: ocultas[s.chave] ? 0.4 : 1,
                textDecoration: ocultas[s.chave] ? 'line-through' : 'none',
              }}
            >
              <i style={{ background: s.cor }} />{s.rotulo}
            </button>
          ))}
          <span style={{ color: 'var(--text-muted)' }}>
            <i style={{ background: 'transparent', borderTop: '2px dashed var(--text-muted)', height: 0, borderRadius: 0, width: 14 }} />
            à direita de hoje é projeção
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
                <th className="num">Entradas</th><th className="num">Saídas</th><th className="num">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => (
                <tr key={m.competencia}>
                  <td>{rotuloMes(m.competencia)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {m.tipo === 'realizado' ? 'medido' : m.tipo === 'parcial' ? 'mês em curso' : 'projetado'}
                  </td>
                  <td className="num">{brl(m.entradas)}</td>
                  <td className="num">{brl(m.saidas)}</td>
                  <td className="num" style={{ color: m.liquido < 0 ? 'var(--critical)' : undefined }}>
                    {brl(m.liquido)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-wrap" onMouseLeave={() => setAtivo(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
               aria-label="Entradas, saídas e resultado por mês">
            {ticks.map((t, i) => (
              <g key={i}>
                <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
                <text x={M.left - 10} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
                  {compacto(t)}
                </text>
              </g>
            ))}

            {zeroVisivel && (
              <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)}
                    stroke="var(--axis)" strokeWidth="1" />
            )}

            {faixa && <path d={faixa} fill="var(--series-1)" opacity="0.07" />}

            <line x1={xHoje} x2={xHoje} y1={M.top - 6} y2={M.top + plotH}
                  stroke="var(--axis)" strokeWidth="1" />
            <text x={xHoje} y={M.top - 10} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
              hoje
            </text>

            {visiveis.map((s) => (
              <g key={s.chave}>
                <path d={linha(s.chave, 0, iCorte)} fill="none" stroke={s.cor} strokeWidth="2.5"
                      strokeLinejoin="round" strokeLinecap="round" />
                {iCorte < meses.length - 1 && (
                  <path d={linha(s.chave, iCorte, meses.length - 1)} fill="none" stroke={s.cor}
                        strokeWidth="2.5" strokeDasharray="6 5" strokeLinejoin="round" strokeLinecap="round" />
                )}
                {meses.map((m, i) => (
                  <circle key={i} cx={x(i)} cy={y(m[s.chave] ?? 0)} r={ativo === i ? 5 : 3.5}
                          fill={i > iCorte ? 'var(--surface)' : s.cor}
                          stroke={s.cor} strokeWidth="2" />
                ))}
              </g>
            ))}

            {meses.map((m, i) => (
              <g key={m.competencia}>
                <rect x={x(i) - plotW / (meses.length - 1) / 2} y={M.top}
                      width={plotW / (meses.length - 1)} height={plotH}
                      fill="transparent" onMouseEnter={() => setAtivo(i)} />
                {(meses.length <= 14 || i % 2 === 0) && (
                  <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="11"
                        fill={i === iAtual ? 'var(--text-primary)' : 'var(--text-muted)'}>
                    {rotuloMes(m.competencia)}
                  </text>
                )}
              </g>
            ))}

            {ativo !== null && (
              <line x1={x(ativo)} x2={x(ativo)} y1={M.top} y2={M.top + plotH}
                    stroke="var(--axis)" strokeWidth="1" strokeDasharray="2 3" />
            )}
          </svg>

          {ativo !== null && (
            <div className="tooltip" style={{ left: `${Math.min(70, (x(ativo) / W) * 100)}%`, top: 6 }}>
              <div className="t-title">
                {rotuloMes(meses[ativo].competencia)}
                <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                  {' · '}
                  {meses[ativo].tipo === 'realizado' ? 'medido'
                    : meses[ativo].tipo === 'parcial' ? 'em curso' : 'projetado'}
                </span>
              </div>
              {SERIES.map((s) => (
                <div className="t-row" key={s.chave}>
                  <span><i className="legend" style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                    background: s.cor, marginRight: 6,
                  }} />{s.rotulo}</span>
                  <span>{brl(meses[ativo][s.chave] ?? 0)}</span>
                </div>
              ))}
              {meses[ativo].tipo === 'parcial' && (
                <div className="t-row" style={{ color: 'var(--text-muted)', marginTop: 5 }}>
                  <span>já no caixa</span><span>{brl(meses[ativo].realizadoEntradas ?? 0)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
