'use client'
import { useState, useId } from 'react'
import { brl, compacto, rotuloMes } from '@/lib/format'

// Linha genérica para indicador mensal.
//
// Todas as séries passadas precisam dividir a mesma unidade. É por isso que o
// componente recebe um formato só: misturar reais com percentual num eixo
// comum produz um desenho que parece informativo e não é.
//
// `referencias` desenha faixas horizontais de leitura, como o intervalo
// saudável de utilização. Elas explicam o número sem exigir que quem olha já
// saiba o que é bom.

const W = 960
const H = 260
const M = { top: 18, right: 18, bottom: 32, left: 68 }

export default function LinhaKpi({
  dados, series, formato = 'brl', referencias = [], titulo = '',
}) {
  const [ativo, setAtivo] = useState(null)
  const [tabela, setTabela] = useState(false)
  const uid = useId().replace(/:/g, '')

  if (!dados || dados.length < 2) {
    return <p className="empty">Menos de dois meses preenchidos. A curva precisa de pelo menos dois pontos.</p>
  }

  const fmt = (v) => {
    if (v === null || v === undefined) return '—'
    if (formato === 'brl') return brl(v)
    if (formato === 'percentual') return `${(Number(v) * 100).toFixed(1).replace('.', ',')}%`
    return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  }
  const fmtEixo = (v) => {
    if (formato === 'brl') return compacto(v)
    if (formato === 'percentual') return `${Math.round(Number(v) * 100)}%`
    return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
  }

  const valores = dados.flatMap((d) => series.map((s) => Number(d[s.chave] ?? 0)))
    .concat(referencias.map((r) => r.valor))
  const menor = Math.min(...valores)
  const maior = Math.max(...valores)
  const folga = (maior - menor) * 0.15 || Math.abs(maior) * 0.15 || 1
  const topo = maior + folga
  const piso = Math.min(menor - folga, formato === 'percentual' ? menor - folga : 0)

  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const x = (i) => M.left + (i / (dados.length - 1)) * plotW
  const y = (v) => M.top + plotH - ((Number(v) - piso) / (topo - piso)) * plotH

  const caminho = (chave) => dados
    .map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[chave] ?? 0).toFixed(1)}`).join(' ')

  const ticks = [piso, piso + (topo - piso) / 2, topo]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
        <div className="legend">
          {series.map((s) => (
            <span key={s.chave}><i style={{ background: s.cor }} />{s.rotulo}</span>
          ))}
          {referencias.map((r) => (
            <span key={r.rotulo} style={{ color: 'var(--text-muted)' }}>
              <i style={{ background: 'transparent', borderTop: '2px dashed var(--text-muted)', height: 0, borderRadius: 0, width: 14 }} />
              {r.rotulo}
            </span>
          ))}
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
                <th>Mês</th>
                {series.map((s) => <th className="num" key={s.chave}>{s.rotulo}</th>)}
              </tr>
            </thead>
            <tbody>
              {dados.map((d) => (
                <tr key={d.competencia}>
                  <td>{rotuloMes(d.competencia)}</td>
                  {series.map((s) => <td className="num" key={s.chave}>{fmt(d[s.chave])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-wrap" onMouseLeave={() => setAtivo(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
               aria-label={titulo || 'Indicador mensal'}>
            {ticks.map((t, i) => (
              <g key={i}>
                <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
                <text x={M.left - 10} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
                  {fmtEixo(t)}
                </text>
              </g>
            ))}

            {referencias.map((r) => (
              <g key={r.rotulo}>
                <line x1={M.left} x2={W - M.right} y1={y(r.valor)} y2={y(r.valor)}
                      stroke={r.cor ?? 'var(--text-muted)'} strokeWidth="1" strokeDasharray="5 4" />
                <text x={W - M.right} y={y(r.valor) - 4} textAnchor="end" fontSize="10"
                      fill={r.cor ?? 'var(--text-muted)'}>{r.rotulo}</text>
              </g>
            ))}

            {series.map((s) => (
              <g key={s.chave}>
                <path d={caminho(s.chave)} fill="none" stroke={s.cor} strokeWidth="2.5"
                      strokeLinejoin="round" strokeLinecap="round" />
                {dados.map((d, i) => (
                  <circle key={i} cx={x(i)} cy={y(d[s.chave] ?? 0)} r={ativo === i ? 5 : 3.5}
                          fill={s.cor} stroke="var(--surface)" strokeWidth="2" />
                ))}
              </g>
            ))}

            {dados.map((d, i) => (
              <g key={d.competencia}>
                <rect x={x(i) - plotW / (dados.length - 1) / 2} y={M.top}
                      width={plotW / (dados.length - 1)} height={plotH}
                      fill="transparent" onMouseEnter={() => setAtivo(i)} />
                {(dados.length <= 14 || i % 2 === 0) && (
                  <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--text-muted)">
                    {rotuloMes(d.competencia)}
                  </text>
                )}
              </g>
            ))}

            {ativo !== null && (
              <line x1={x(ativo)} x2={x(ativo)} y1={M.top} y2={M.top + plotH}
                    stroke="var(--axis)" strokeDasharray="2 3" />
            )}
          </svg>

          {ativo !== null && (
            <div className="tooltip" style={{ left: `${Math.min(70, (x(ativo) / W) * 100)}%`, top: 6 }}>
              <div className="t-title">{rotuloMes(dados[ativo].competencia)}</div>
              {series.map((s) => (
                <div className="t-row" key={s.chave}>
                  <span>
                    <i style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                      background: s.cor, marginRight: 6,
                    }} />
                    {s.rotulo}
                  </span>
                  <span>{fmt(dados[ativo][s.chave])}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
