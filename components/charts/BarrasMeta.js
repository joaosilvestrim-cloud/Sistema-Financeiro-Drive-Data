'use client'
import { useState, useId } from 'react'
import { brl, compacto, rotuloMes } from '@/lib/format'

// Realizado contra meta, mês a mês.
//
// Duas barras lado a lado, mesma unidade e mesmo eixo. A meta vem hachurada
// porque ela não é um fato, é um combinado: a diferença de textura evita que
// alguém leia as duas barras como se fossem a mesma natureza de número.
//
// O desvio aparece como rótulo acima do par, só quando passa de 5%. Rótulo em
// tudo vira ruído e some justamente nos meses que importam.

const W = 960
const H = 280
const M = { top: 26, right: 18, bottom: 34, left: 68 }

export default function BarrasMeta({ dados, chaveReal, chaveMeta, rotuloReal, rotuloMeta, inverter = false }) {
  const [ativo, setAtivo] = useState(null)
  const [tabela, setTabela] = useState(false)
  const uid = useId().replace(/:/g, '')

  const comMeta = dados.filter((d) => d[chaveMeta] !== null && d[chaveMeta] !== undefined)
  if (!comMeta.length) {
    return <p className="empty">Nenhum mês com meta preenchida ainda.</p>
  }

  const maximo = Math.max(...dados.flatMap((d) => [Number(d[chaveReal] ?? 0), Number(d[chaveMeta] ?? 0)]), 1)
  const teto = Math.ceil(maximo / 20000) * 20000 || maximo
  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const grupoW = plotW / dados.length
  const barraW = Math.min(20, grupoW * 0.28)
  const base = M.top + plotH
  const alt = (v) => (Number(v ?? 0) / teto) * plotH
  const y = (v) => base - alt(v)

  const desvio = (d) => {
    const meta = Number(d[chaveMeta] ?? 0)
    if (!meta) return null
    return Number(d[chaveReal] ?? 0) / meta - 1
  }
  // Numa meta de despesa, gastar menos é bom. Sem esta inversão a tela pintaria
  // de vermelho justamente a economia.
  const bom = (v) => (inverter ? v <= 0 : v >= 0)

  const ticks = [0, 0.5, 1].map((f) => f * teto)
  const barra = (x, valor, cor, hachura) => {
    const h = alt(valor)
    if (h <= 0.5) return null
    const r = 4
    const d = `M${x} ${base} v${-(h - r)} a${r} ${r} 0 0 1 ${r} ${-r} h${barraW - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} v${h - r} z`
    return hachura
      ? <path d={d} fill={`url(#meta${uid})`} stroke={cor} strokeWidth="1" />
      : <path d={d} fill={cor} />
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="legend">
          <span><i style={{ background: 'var(--series-1)' }} />{rotuloReal}</span>
          <span>
            <i style={{
              background: 'var(--surface)',
              boxShadow: 'inset 0 0 0 1px var(--axis)',
              backgroundImage: 'repeating-linear-gradient(45deg, var(--axis) 0 1px, transparent 1px 4px)',
            }} />
            {rotuloMeta}
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
                <th>Mês</th><th className="num">{rotuloReal}</th><th className="num">{rotuloMeta}</th>
                <th className="num">Desvio</th><th className="num">Desvio %</th>
              </tr>
            </thead>
            <tbody>
              {dados.map((d) => {
                const dv = desvio(d)
                const abs = d[chaveMeta] != null ? Number(d[chaveReal] ?? 0) - Number(d[chaveMeta]) : null
                return (
                  <tr key={d.competencia}>
                    <td>{rotuloMes(d.competencia)}</td>
                    <td className="num">{brl(d[chaveReal])}</td>
                    <td className="num">{d[chaveMeta] != null ? brl(d[chaveMeta]) : '—'}</td>
                    <td className="num" style={{ color: abs === null ? undefined : bom(abs) ? 'var(--good-text)' : 'var(--critical)' }}>
                      {abs === null ? '—' : brl(abs)}
                    </td>
                    <td className="num" style={{ color: dv === null ? undefined : bom(dv) ? 'var(--good-text)' : 'var(--critical)' }}>
                      {dv === null ? '—' : `${dv > 0 ? '+' : ''}${(dv * 100).toFixed(1).replace('.', ',')}%`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-wrap" onMouseLeave={() => setAtivo(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
               aria-label={`${rotuloReal} contra ${rotuloMeta} por mês`}>
            <defs>
              <pattern id={`meta${uid}`} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                <rect width="6" height="6" fill="var(--surface)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--text-muted)" strokeWidth="2.5" />
              </pattern>
            </defs>

            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)}
                      stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} />
                <text x={M.left - 10} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
                  {compacto(t)}
                </text>
              </g>
            ))}

            {dados.map((d, i) => {
              const x0 = M.left + i * grupoW
              const centro = x0 + grupoW / 2
              const dv = desvio(d)
              const mostrarDesvio = dv !== null && Math.abs(dv) >= 0.05
              return (
                <g key={d.competencia}>
                  {ativo === i && (
                    <rect x={x0} y={M.top} width={grupoW} height={plotH}
                          fill="var(--text-primary)" opacity="0.04" />
                  )}
                  {barra(centro - barraW - 2, d[chaveReal], 'var(--series-1)', false)}
                  {d[chaveMeta] != null && barra(centro + 2, d[chaveMeta], 'var(--text-muted)', true)}
                  {mostrarDesvio && (
                    <text x={centro} y={Math.min(y(d[chaveReal]), y(d[chaveMeta])) - 6}
                          textAnchor="middle" fontSize="10"
                          fill={bom(dv) ? 'var(--good-text)' : 'var(--critical)'}>
                      {dv > 0 ? '+' : ''}{(dv * 100).toFixed(0)}%
                    </text>
                  )}
                  {(dados.length <= 14 || i % 2 === 0) && (
                    <text x={centro} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--text-muted)">
                      {rotuloMes(d.competencia)}
                    </text>
                  )}
                  <rect x={x0} y={M.top} width={grupoW} height={plotH} fill="transparent"
                        onMouseEnter={() => setAtivo(i)} />
                </g>
              )
            })}
          </svg>

          {ativo !== null && (
            <div className="tooltip" style={{
              left: `${Math.min(70, ((M.left + ativo * grupoW) / W) * 100)}%`, top: 4,
            }}>
              <div className="t-title">{rotuloMes(dados[ativo].competencia)}</div>
              <div className="t-row"><span>{rotuloReal}</span><span>{brl(dados[ativo][chaveReal])}</span></div>
              <div className="t-row">
                <span>{rotuloMeta}</span>
                <span>{dados[ativo][chaveMeta] != null ? brl(dados[ativo][chaveMeta]) : '—'}</span>
              </div>
              {desvio(dados[ativo]) !== null && (
                <div className="t-row" style={{ marginTop: 4, fontWeight: 600 }}>
                  <span>Desvio</span>
                  <span style={{ color: bom(desvio(dados[ativo])) ? 'var(--good-text)' : 'var(--critical)' }}>
                    {brl(Number(dados[ativo][chaveReal] ?? 0) - Number(dados[ativo][chaveMeta]))}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
