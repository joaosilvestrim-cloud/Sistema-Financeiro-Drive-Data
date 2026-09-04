'use client'
import { useState } from 'react'
import { rotuloMes } from '@/lib/format'

// Grade de digitação mês a mês.
//
// Comporta-se como planilha no que importa: seta para cima e para baixo anda
// entre os meses, e Enter desce em vez de enviar o formulário. Quem preenche
// meta anual digita 12 números seguidos e não quer tocar no mouse.
export default function GradeMensal({ meses, valores, unidade }) {
  const [estado, setEstado] = useState(() =>
    Object.fromEntries(meses.map((m) => [
      m,
      valores[m] === undefined
        ? ''
        : String(valores[m]).replace('.', ','),
    ])),
  )

  const mover = (i, passo) => {
    const alvo = document.querySelector(`[name="m:${meses[i + passo]}"]`)
    if (alvo) { alvo.focus(); alvo.select() }
  }

  const aoTeclar = (e, i) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); mover(i, 1) }
    if (e.key === 'ArrowUp') { e.preventDefault(); mover(i, -1) }
  }

  const hoje = new Date().toISOString().slice(0, 7)
  const preenchidos = Object.values(estado).filter((v) => v !== '').length

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        {preenchidos} de {meses.length} meses preenchidos
        {unidade === 'BRL' && ' · valores em reais'}
        {unidade === 'percentual' && ' · valores em porcentagem, 12,5 para 12,5%'}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
        gap: 8,
      }}>
        {meses.map((m, i) => {
          const futuro = m > hoje
          return (
            <label key={m} style={{ display: 'block' }}>
              <span style={{
                fontSize: 11,
                color: m === hoje ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: m === hoje ? 600 : 400,
              }}>
                {rotuloMes(m)}{futuro ? ' ·' : ''}
              </span>
              <input
                name={`m:${m}`}
                value={estado[m]}
                inputMode="decimal"
                onChange={(e) => setEstado((s) => ({ ...s, [m]: e.target.value }))}
                onKeyDown={(e) => aoTeclar(e, i)}
                onFocus={(e) => e.target.select()}
                placeholder="—"
                style={{
                  width: '100%', marginTop: 2, textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  borderColor: estado[m] !== '' ? 'var(--series-1)' : 'var(--border)',
                }}
              />
            </label>
          )
        })}
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>
        Meses marcados com ponto ainda não aconteceram. Seta para cima e para baixo anda entre eles.
      </p>
    </div>
  )
}
