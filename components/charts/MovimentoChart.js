'use client'
import { useState, useId } from 'react'
import { brl, compacto, rotuloMes } from '@/lib/format'

// Entradas e saídas por mês, uma barra para cada lado.
//
// O que já passou pelo caixa é sólido, o que ainda é projeção vem hachurado. A
// hachura é o canal de acesso além da cor: separa medido de projetado mesmo
// sem enxergar matiz, em impressão ou em contraste forçado.

const W = 980
const H = 260
const M = { top: 16, right: 18, bottom: 32, left: 66 }

export default function MovimentoChart({ meses, mesAtual }) {
  const [ativo, setAtivo] = useState(null)
  const uid = useId().replace(/:/g, '')

  if (!meses.length) return <p className="empty">Sem movimento no período.</p>

  const maximo = Math.max(...meses.flatMap((m) => [m.entradas, m.saidas]), 1)
  const teto = Math.ceil(maximo / 20000) * 20000 || maximo
  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const grupoW = plotW / meses.length
  const barraW = Math.min(22, grupoW * 0.3)
  const base = M.top + plotH
  const alt = (v) => (v / teto) * plotH
  const y = (v) => base - alt(v)

  const ticks = [0, 0.5, 1].map((f) => f * teto)
  const iCorte = Math.max(0, meses.findIndex((m) => m.competencia === mesAtual))

  // Barra com duas partes: o que ja passou pelo caixa em solido e o que ainda e
  // previsto em hachura, empilhados com 2px de folga entre eles. No mes em curso
  // e isso que evita o mes parecer vazio no comeco e cheio no fim.
  const Barra = ({ x, medido = 0, previsto = 0, cor, padrao }) => {
    const hM = alt(medido)
    const hP = alt(previsto)
    const r = 4
    const temP = hP > 0.5
    const temM = hM > 0.5
    const gap = temP && temM ? 2 : 0
    const topoP = base - hM - gap - hP
    const arred = (x0, y0, h) =>
      `M${x0} ${y0 + h} v${-(h - r)} a${r} ${r} 0 0 1 ${r} ${-r} h${barraW - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} v${h - r} z`
    return (
      <>
        {temM && (
          <path
            d={temP ? `M${x} ${base} v${-hM} h${barraW} v${hM} z` : arred(x, base - hM, hM)}
            fill={cor}
          />
        )}
        {temP && <path d={arred(x, topoP, hP)} fill={`url(#${padrao})`} stroke={cor} strokeWidth="1" />}
      </>
    )
  }

  return (
    <div>
      <div className="legend" style={{ marginBottom: 10 }}>
        <span><i style={{ background: 'var(--series-1)' }} />Entradas</span>
        <span><i style={{ background: 'var(--series-2)' }} />Saídas</span>
        <span>
          <i style={{
            background: 'var(--surface)',
            boxShadow: 'inset 0 0 0 1px var(--axis)',
            backgroundImage: 'repeating-linear-gradient(45deg, var(--axis) 0 1px, transparent 1px 4px)',
          }} />
          Projetado
        </span>
      </div>

      <div className="chart-wrap" onMouseLeave={() => setAtivo(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
             aria-label="Entradas e saídas por mês, medidas e projetadas">
          <defs>
            <pattern id={`e${uid}`} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill="var(--surface)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--series-1)" strokeWidth="2.5" />
            </pattern>
            <pattern id={`s${uid}`} width="6" height="6" patternTransform="rotate(135)" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill="var(--surface)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--series-2)" strokeWidth="2.5" />
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

          {meses.map((m, i) => {
            const x0 = M.left + i * grupoW
            const centro = x0 + grupoW / 2
            const projetado = m.tipo === 'previsto'
            const medidoEnt = projetado ? 0 : (m.realizadoEntradas ?? m.entradas)
            const medidoSai = projetado ? 0 : (m.realizadoSaidas ?? m.saidas)
            const prevEnt = projetado ? m.entradas : (m.aReceberNoMes ?? 0)
            const prevSai = projetado ? m.saidas : (m.aPagarNoMes ?? 0)
            return (
              <g key={m.competencia}>
                {ativo === i && (
                  <rect x={x0} y={M.top} width={grupoW} height={plotH}
                        fill="var(--text-primary)" opacity="0.04" />
                )}
                <Barra x={centro - barraW - 2} medido={medidoEnt} previsto={prevEnt}
                       cor="var(--series-1)" padrao={`e${uid}`} />
                <Barra x={centro + 2} medido={medidoSai} previsto={prevSai}
                       cor="var(--series-2)" padrao={`s${uid}`} />
                {(meses.length <= 14 || i % 2 === 0) && (
                  <text x={centro} y={H - 10} textAnchor="middle" fontSize="11"
                        fill={i === iCorte ? 'var(--text-primary)' : 'var(--text-muted)'}>
                    {rotuloMes(m.competencia)}
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
            left: `${Math.min(72, ((M.left + ativo * grupoW) / W) * 100)}%`, top: 4,
          }}>
            <div className="t-title">{rotuloMes(meses[ativo].competencia)}</div>
            <div className="t-row"><span>Entradas</span><span>{brl(meses[ativo].entradas)}</span></div>
            <div className="t-row"><span>Saídas</span><span>{brl(meses[ativo].saidas)}</span></div>
            <div className="t-row" style={{ fontWeight: 600, marginTop: 4 }}>
              <span>Líquido</span><span>{brl(meses[ativo].liquido)}</span>
            </div>
            {meses[ativo].aReceberNoMes > 0 && (
              <div className="t-row" style={{ color: 'var(--text-muted)', marginTop: 5 }}>
                <span>ja no caixa</span><span>{brl(meses[ativo].realizadoEntradas ?? 0)}</span>
              </div>
            )}
            {meses[ativo].aReceberNoMes > 0 && (
              <div className="t-row" style={{ color: 'var(--text-muted)' }}>
                <span>ainda no mes</span><span>{brl(meses[ativo].aReceberNoMes)}</span>
              </div>
            )}
            {meses[ativo].carteiraEntradas > 0 && (
              <div className="t-row" style={{ color: 'var(--text-muted)', marginTop: 5 }}>
                <span>já lançado</span><span>{brl(meses[ativo].carteiraEntradas)}</span>
              </div>
            )}
            {meses[ativo].novosEntradas > 0 && (
              <div className="t-row" style={{ color: 'var(--text-muted)' }}>
                <span>estimado</span><span>{brl(meses[ativo].novosEntradas)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
