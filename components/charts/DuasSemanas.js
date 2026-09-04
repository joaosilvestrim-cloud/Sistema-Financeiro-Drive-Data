'use client'
import { useState } from 'react'
import { brl, compacto } from '@/lib/format'

// Catorze dias, começando na segunda desta semana.
//
// Barras de entrada e saída por dia, e por cima a linha do saldo correndo. A
// linha é o que importa: o total do mês não diz se na quinta falta dinheiro, e
// é justamente isso que trava a decisão de quem paga fornecedor.
//
// A divisória entre a semana atual e a próxima é sólida de propósito, e o zero
// é sempre desenhado, mesmo quando o saldo nunca chega perto dele. Sem a linha
// do zero visível, um saldo caindo parece confortável.

const W = 960
const H = 280
const M = { top: 18, right: 56, bottom: 42, left: 56 }

const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export default function DuasSemanas({ dados }) {
  const [ativo, setAtivo] = useState(null)
  if (!dados?.length) return <p className="empty">Sem movimento nas próximas duas semanas.</p>

  const larguraUtil = W - M.left - M.right
  const alturaUtil = H - M.top - M.bottom
  const passo = larguraUtil / dados.length

  const maxBarra = Math.max(1, ...dados.map((d) => Math.max(d.entradas, d.saidas)))
  const saldos = dados.map((d) => d.saldo)
  const maxSaldo = Math.max(0, ...saldos)
  const minSaldo = Math.min(0, ...saldos)
  const faixaSaldo = maxSaldo - minSaldo || 1

  const yBarra = (v) => M.top + alturaUtil - (v / maxBarra) * (alturaUtil * 0.55)
  const alturaBarra = (v) => (v / maxBarra) * (alturaUtil * 0.55)
  const ySaldo = (v) => M.top + alturaUtil - ((v - minSaldo) / faixaSaldo) * alturaUtil

  const linha = dados
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${M.left + passo * (i + 0.5)} ${ySaldo(d.saldo)}`)
    .join(' ')

  const item = ativo != null ? dados[ativo] : null
  const dataBr = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7)

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 620, height: 'auto' }}
           role="img" aria-label="Entradas, saídas e saldo dia a dia nas próximas duas semanas">
        {/* zero do saldo, sempre visível */}
        <line x1={M.left} x2={W - M.right} y1={ySaldo(0)} y2={ySaldo(0)}
              stroke="var(--border)" strokeWidth="1" />
        <text x={W - M.right + 4} y={ySaldo(0) + 4} fontSize="10" fill="var(--text-muted)">0</text>

        {/* divisória entre a semana atual e a próxima */}
        <line
          x1={M.left + passo * 7} x2={M.left + passo * 7}
          y1={M.top} y2={M.top + alturaUtil}
          stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3 3"
        />
        <text x={M.left + passo * 7 + 5} y={M.top + 10} fontSize="10" fill="var(--text-muted)">
          próxima semana
        </text>

        {dados.map((d, i) => {
          const x = M.left + passo * i
          const meio = x + passo / 2
          return (
            <g key={d.dia}
               onMouseEnter={() => setAtivo(i)} onMouseLeave={() => setAtivo(null)}>
              <rect x={x} y={M.top} width={passo} height={alturaUtil}
                    fill={ativo === i ? 'var(--surface)' : 'transparent'} />

              {d.hoje && (
                <rect x={x} y={M.top} width={passo} height={alturaUtil}
                      fill="var(--accent)" opacity="0.08" />
              )}

              {d.entradas > 0 && (
                <rect
                  x={meio - passo * 0.34} width={passo * 0.3}
                  y={yBarra(d.entradas)} height={alturaBarra(d.entradas)}
                  fill="var(--ramp-350)" opacity={d.passado ? 0.5 : 1}
                />
              )}
              {d.saidas > 0 && (
                <rect
                  x={meio + passo * 0.04} width={passo * 0.3}
                  y={yBarra(d.saidas)} height={alturaBarra(d.saidas)}
                  fill="var(--ramp-650)" opacity={d.passado ? 0.5 : 1}
                />
              )}

              <text x={meio} y={H - M.bottom + 14} fontSize="9"
                    textAnchor="middle" fill="var(--text-muted)">
                {DIA_SEMANA[new Date(d.dia + 'T12:00:00').getDay()]}
              </text>
              <text x={meio} y={H - M.bottom + 26} fontSize="9"
                    textAnchor="middle"
                    fill={d.hoje ? 'var(--text-primary)' : 'var(--text-muted)'}
                    fontWeight={d.hoje ? 600 : 400}>
                {dataBr(d.dia)}
              </text>
            </g>
          )
        })}

        <path d={linha} fill="none" stroke="var(--accent)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />
        {dados.map((d, i) => (
          <circle key={d.dia} cx={M.left + passo * (i + 0.5)} cy={ySaldo(d.saldo)}
                  r={ativo === i ? 4 : 2.5}
                  fill={d.saldo < 0 ? 'var(--critical)' : 'var(--accent)'} />
        ))}

        <text x={M.left} y={M.top - 6} fontSize="10" fill="var(--text-muted)">
          saldo até {compacto(maxSaldo)}
        </text>
      </svg>

      <div style={{ minHeight: 44, fontSize: 13, color: 'var(--text-secondary)' }}>
        {item ? (
          <>
            <strong>{dataBr(item.dia)}</strong>
            {item.hoje && ' (hoje)'} · entra {brl(item.entradas)} · sai {brl(item.saidas)} ·{' '}
            saldo <strong style={item.saldo < 0 ? { color: 'var(--critical)' } : undefined}>
              {brl(item.saldo)}
            </strong>
            {item.passado && ' · já passou'}
          </>
        ) : (
          'Passe o mouse por um dia para ver entradas, saídas e o saldo daquele dia.'
        )}
      </div>
    </div>
  )
}
