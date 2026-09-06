'use client'
import { useState } from 'react'
import { brl, compacto } from '@/lib/format'

// Pareto. Barras pelo tamanho, linha pelo acumulado, corte nos 80%.
//
// A tela de Indicadores já dizia "para leitura de Pareto" e entregava uma
// tabela com duas colunas de percentual. A conta estava certa e o trabalho de
// achar onde o acumulado cruza os 80% ficava com quem lia.
//
// Aqui o cruzamento é o desenho. As barras até o corte ficam cheias, as de
// depois ficam apagadas, e a linha tracejada dos 80% atravessa a área. A
// pergunta que isso responde é quantos clientes seguram a empresa, e a resposta
// é o número de barras acesas.
//
// Duas escalas convivem porque as unidades são diferentes: reais à esquerda,
// percentual acumulado à direita. É a única combinação em que dois eixos não
// enganam, porque a segunda série é derivada da primeira e vai sempre de zero a
// cem.

const W = 960
const H = 300
const M = { top: 22, right: 52, bottom: 74, left: 68 }

export default function Pareto({ dados, corte = 0.8 }) {
  const [ativo, setAtivo] = useState(null)
  if (!dados?.length) return <p className="empty">Sem faturamento para ordenar.</p>

  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const maior = Math.max(...dados.map((d) => Number(d.valor) || 0), 1)

  const passo = plotW / dados.length
  const largura = Math.min(passo * 0.66, 54)
  const x = (i) => M.left + i * passo + (passo - largura) / 2
  const centro = (i) => x(i) + largura / 2
  const yBarra = (v) => M.top + plotH - (v / maior) * plotH
  const yLinha = (p) => M.top + plotH - Math.min(p, 1) * plotH

  // O primeiro que fecha os 80%. Ele entra, porque é ele que completa a conta.
  const iCorte = dados.findIndex((d) => Number(d.acumulado) >= corte)
  const dentro = (i) => iCorte === -1 || i <= iCorte

  const caminho = dados
    .map((d, i) => `${i ? 'L' : 'M'}${centro(i).toFixed(1)} ${yLinha(Number(d.acumulado)).toFixed(1)}`)
    .join(' ')

  const ticks = [0, maior / 2, maior]

  return (
    <div className="chart-wrap" onMouseLeave={() => setAtivo(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
           aria-label="Faturamento por cliente e participação acumulada">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={M.left} x2={W - M.right} y1={yBarra(t)} y2={yBarra(t)} stroke="var(--grid)" />
            <text x={M.left - 10} y={yBarra(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
              {compacto(t)}
            </text>
          </g>
        ))}

        {/* Eixo do acumulado, à direita. */}
        {[0, 0.5, 1].map((p) => (
          <text key={p} x={W - M.right + 8} y={yLinha(p) + 4} fontSize="11" fill="var(--text-muted)">
            {Math.round(p * 100)}%
          </text>
        ))}

        <line x1={M.left} x2={W - M.right} y1={yLinha(corte)} y2={yLinha(corte)}
              stroke="var(--series-2)" strokeDasharray="5 4" />
        <text x={M.left + 4} y={yLinha(corte) - 6} fontSize="10" fill="var(--series-2)">
          {Math.round(corte * 100)}% do faturamento
        </text>

        {dados.map((d, i) => (
          <rect
            key={`b${i}`} className="anima-barra"
            style={{ '--origem': `center ${M.top + plotH}px`, animationDelay: `${i * 40}ms` }}
            x={x(i)} y={yBarra(Number(d.valor))}
            width={largura} height={Math.max(M.top + plotH - yBarra(Number(d.valor)), 2)}
            rx="3"
            fill={dentro(i) ? 'var(--series-1)' : 'var(--ramp-250)'}
            opacity={ativo === null || ativo === i ? 1 : 0.5}
            onMouseEnter={() => setAtivo(i)}
          />
        ))}

        <path d={caminho} fill="none" stroke="var(--series-3)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />
        {dados.map((d, i) => (
          <circle key={`p${i}`} className="marca" cx={centro(i)} cy={yLinha(Number(d.acumulado))}
                  r={ativo === i ? 5 : 3} fill="var(--surface)"
                  stroke="var(--series-3)" strokeWidth="2" />
        ))}

        {dados.map((d, i) => (
          <text key={`r${i}`} x={centro(i)} y={M.top + plotH + 16}
                textAnchor="end" fontSize="10.5"
                transform={`rotate(-38 ${centro(i)} ${M.top + plotH + 16})`}
                fill={ativo === i ? 'var(--text-primary)' : 'var(--text-muted)'}>
            {d.rotulo.length > 16 ? d.rotulo.slice(0, 15) + '…' : d.rotulo}
          </text>
        ))}
      </svg>

      <div className="legend" style={{ marginTop: 4 }}>
        <span><i style={{ background: 'var(--series-1)' }} />segura os {Math.round(corte * 100)}%</span>
        <span><i style={{ background: 'var(--ramp-250)' }} />o resto</span>
        <span><i style={{ background: 'var(--series-3)' }} />acumulado</span>
      </div>

      {ativo !== null && (
        <div className="tooltip" style={{ left: `${(x(ativo) / W) * 100}%`, top: 0 }}>
          <div className="t-title">{dados[ativo].rotulo}</div>
          <div className="t-row"><span>faturado</span><span>{brl(dados[ativo].valor)}</span></div>
          <div className="t-row">
            <span>participação</span>
            <span>{(Number(dados[ativo].participacao) * 100).toFixed(1).replace('.', ',')}%</span>
          </div>
          <div className="t-row">
            <span>acumulado</span>
            <span>{(Number(dados[ativo].acumulado) * 100).toFixed(1).replace('.', ',')}%</span>
          </div>
        </div>
      )}
    </div>
  )
}
