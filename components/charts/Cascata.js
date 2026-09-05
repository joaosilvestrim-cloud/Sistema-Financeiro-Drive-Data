'use client'
import { useState } from 'react'
import { brl, compacto } from '@/lib/format'

// Cascata. O gráfico que responde "de onde saiu esse resultado".
//
// Cada barra parte de onde a anterior terminou, então a altura de uma etapa é
// literalmente o quanto ela consumiu. Uma tabela com os mesmos números dá a
// resposta certa e exige que quem lê faça a subtração de cabeça; aqui o
// tamanho já é a subtração.
//
// Quatro papéis, e a diferença entre eles é o que impede o desenho de mentir:
//
//   base      começa no zero. É a receita.
//   baixa     desce a partir do acumulado. É o que sai.
//   subtotal  volta ao zero e mostra onde o acumulado chegou.
//   fora      não entra na conta. Fica solta, apagada e marcada, porque
//             empurrá-la para dentro faria a soma fechar com um número que
//             ninguém apurou.
//
// A última é a que mais importa nesta base: um quinto da despesa da DriveData
// não tem classe definida no ERP. Somar isso ao custo daria um multiplicador
// bonito e errado; deixar de fora sem dizer nada esconderia o buraco. Ela
// aparece, separada e nomeada.

const W = 960
const H = 320
const M = { top: 26, right: 20, bottom: 62, left: 74 }

export default function Cascata({ passos, formato = 'brl' }) {
  const [ativo, setAtivo] = useState(null)
  if (!passos?.length) return <p className="empty">Sem dados para montar a cascata.</p>

  // Percorre uma vez montando o topo e a base de cada barra. O acumulado só
  // anda em `base` e `baixa`; subtotal e total leem onde ele está.
  let corrente = 0
  const barras = passos.map((p) => {
    const valor = Number(p.valor) || 0
    let de = 0
    let ate = 0
    if (p.tipo === 'base') { de = 0; ate = valor; corrente = valor }
    else if (p.tipo === 'baixa') { de = corrente - valor; ate = corrente; corrente -= valor }
    else if (p.tipo === 'fora') { de = 0; ate = valor }
    else { de = 0; ate = corrente }
    return { ...p, valor, de, ate, acumulado: p.tipo === 'fora' ? null : corrente }
  })

  const topo = Math.max(...barras.map((b) => Math.max(b.de, b.ate)), 0)
  const piso = Math.min(...barras.map((b) => Math.min(b.de, b.ate)), 0)
  const folga = (topo - piso) * 0.08 || 1

  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const y = (v) => M.top + plotH - ((v - piso) / ((topo + folga) - piso)) * plotH

  const passoW = plotW / barras.length
  const largura = Math.min(passoW * 0.62, 84)
  const x = (i) => M.left + i * passoW + (passoW - largura) / 2

  const cor = (b) => {
    if (b.tipo === 'fora') return 'var(--text-muted)'
    if (b.tipo === 'baixa') return 'var(--series-2)'
    if (b.tipo === 'total') return b.ate >= 0 ? 'var(--series-3)' : 'var(--critical)'
    if (b.tipo === 'subtotal') return 'var(--ramp-550)'
    return 'var(--series-1)'
  }

  const ticks = [piso, (topo + piso) / 2, topo].filter((v, i, a) => a.indexOf(v) === i)
  const fmt = (v) => (formato === 'brl' ? brl(v) : Number(v).toLocaleString('pt-BR'))

  return (
    <div className="chart-wrap cascata" onMouseLeave={() => setAtivo(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
           aria-label="Cascata da receita até o resultado, etapa por etapa">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={M.left - 10} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
              {compacto(t)}
            </text>
          </g>
        ))}

        <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="var(--axis)" />

        {/* O fio que liga o fim de uma barra ao começo da seguinte. É ele que
            faz a leitura ser contínua em vez de virar barras avulsas. */}
        {barras.map((b, i) => {
          const prox = barras[i + 1]
          if (!prox || b.tipo === 'fora' || prox.tipo === 'fora') return null
          const yLig = y(prox.tipo === 'baixa' ? b.ate : prox.ate)
          if (prox.tipo === 'base') return null
          return (
            <line key={`c${i}`} className="conector"
                  x1={x(i)} x2={x(i + 1) + largura}
                  y1={prox.tipo === 'baixa' ? y(b.ate) : yLig}
                  y2={prox.tipo === 'baixa' ? y(b.ate) : yLig} />
          )
        })}

        {barras.map((b, i) => {
          const alto = Math.abs(y(b.ate) - y(b.de))
          const cima = Math.min(y(b.de), y(b.ate))
          return (
            <g key={b.rotulo} className={b.tipo === 'fora' ? 'fora' : undefined}
               onMouseEnter={() => setAtivo(i)}>
              <rect
                className="anima-barra"
                style={{ '--origem': `center ${y(0)}px`, animationDelay: `${i * 55}ms` }}
                x={x(i)} y={cima} width={largura} height={Math.max(alto, 2)}
                fill={cor(b)} rx="3"
                opacity={ativo === null || ativo === i ? 1 : 0.55}
              />
              {b.tipo === 'fora' && (
                <rect x={x(i)} y={cima} width={largura} height={Math.max(alto, 2)}
                      fill="none" stroke="var(--text-muted)" strokeDasharray="4 3" rx="3" />
              )}
              <text className="rotulo-valor" x={x(i) + largura / 2} y={cima - 7} textAnchor="middle">
                {b.tipo === 'baixa' ? '−' : ''}{compacto(b.valor)}
              </text>
            </g>
          )
        })}

        {barras.map((b, i) => (
          <text key={`r${i}`} x={x(i) + largura / 2} y={H - 34} textAnchor="middle"
                fontSize="11" fill={ativo === i ? 'var(--text-primary)' : 'var(--text-secondary)'}>
            {b.rotulo.length > 18 ? b.rotulo.slice(0, 17) + '…' : b.rotulo}
          </text>
        ))}
        {barras.map((b, i) => (
          b.tipo === 'fora' ? (
            <text key={`f${i}`} x={x(i) + largura / 2} y={H - 18} textAnchor="middle"
                  fontSize="10" fill="var(--text-muted)">
              fora da conta
            </text>
          ) : null
        ))}
      </svg>

      {ativo !== null && (
        <div className="tooltip" style={{ left: `${(x(ativo) / W) * 100}%`, top: 0 }}>
          <div className="t-title">{barras[ativo].rotulo}</div>
          <div className="t-row">
            <span>{barras[ativo].tipo === 'baixa' ? 'sai' : 'valor'}</span>
            <span>{fmt(barras[ativo].valor)}</span>
          </div>
          {barras[ativo].acumulado !== null && (
            <div className="t-row"><span>acumulado</span><span>{fmt(barras[ativo].acumulado)}</span></div>
          )}
          {barras[ativo].nota && (
            <div className="t-row" style={{ color: 'var(--text-muted)', marginTop: 4 }}>
              <span>{barras[ativo].nota}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
