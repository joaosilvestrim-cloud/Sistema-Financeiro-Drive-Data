'use client'
import { useState } from 'react'
import { brl } from '@/lib/format'

// Barras horizontais para ranking e para faixas ordenadas.
//
// Rótulo direto no fim de cada barra, então a leitura não depende de eixo nem
// de tooltip. Quando as cores vêm de uma rampa de um tom só, a ordem da rampa
// carrega a ordem da faixa, não a identidade de uma série.
//
// O detalhe do tooltip vem pronto em cada item (`detalhes`), porque função não
// atravessa a fronteira entre Server e Client Component.
export default function HBars({ dados, cor = 'var(--series-1)', altura = 30 }) {
  const [ativo, setAtivo] = useState(null)
  if (!dados.length) return <p className="empty">Sem dados.</p>

  const maximo = Math.max(...dados.map((d) => Number(d.valor) || 0), 1)

  return (
    <div className="chart-wrap" onMouseLeave={() => setAtivo(null)}>
      <div style={{ display: 'grid', gap: 6 }}>
        {dados.map((d, i) => {
          const valor = Number(d.valor) || 0
          const largura = Math.max((valor / maximo) * 100, 0.6)
          return (
            <div
              key={d.rotulo}
              onMouseEnter={() => setAtivo(i)}
              style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, alignItems: 'center' }}
            >
              <div style={{
                fontSize: 12,
                color: ativo === i ? 'var(--text-primary)' : 'var(--text-secondary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {d.rotulo}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: altura }}>
                <div style={{
                  width: `${largura}%`,
                  height: altura - 12,
                  background: d.cor ?? cor,
                  borderRadius: '3px 4px 4px 3px',
                  minWidth: 3,
                }} />
                <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {brl(valor)}
                  {d.nota && <span style={{ color: 'var(--text-muted)' }}> · {d.nota}</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {ativo !== null && dados[ativo].detalhes?.length > 0 && (
        <div className="tooltip" style={{ right: 0, top: 0 }}>
          <div className="t-title">{dados[ativo].rotulo}</div>
          {dados[ativo].detalhes.map(([k, v]) => (
            <div className="t-row" key={k}><span>{k}</span><span>{v}</span></div>
          ))}
        </div>
      )}
    </div>
  )
}
