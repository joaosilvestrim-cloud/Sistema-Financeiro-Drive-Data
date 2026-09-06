'use client'
import { useState } from 'react'
import { brl } from '@/lib/format'

// Calendário sazonal. Doze células, uma por mês do ano.
//
// Sazonalidade é a única variável do sistema que é cíclica: dezembro é vizinho
// de janeiro. Barra horizontal ordenada por tamanho, que era o desenho
// anterior, quebra justamente essa vizinhança e faz a pessoa reconstruir o
// calendário de cabeça para responder "quando é o mês fraco".
//
// Aqui a ordem é a do ano e a cor é a intensidade. Um mapa de calor de uma
// linha só, que se lê de uma vez.
//
// A escala é divergente em torno de 1,00 porque o índice é uma razão contra a
// média: acima de um é mês forte, abaixo é fraco, e um é o normal. Escala
// sequencial faria 0,99 e 1,01 parecerem degraus de uma rampa, quando na
// verdade estão nos dois lados de uma fronteira.

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// Mistura no espaço da própria cor do tema, então o mapa continua legível nos
// dois temas sem uma segunda paleta.
function tinta(indice) {
  if (indice === null) return { background: 'var(--plane)', color: 'var(--text-muted)' }
  const forca = Math.min(Math.abs(indice - 1) / 0.45, 1)
  const peso = (10 + forca * 62).toFixed(0)
  const base = indice >= 1 ? 'var(--series-1)' : 'var(--series-2)'
  return {
    background: `color-mix(in srgb, ${base} ${peso}%, var(--surface))`,
    color: forca > 0.55 ? '#fff' : 'var(--text-primary)',
  }
}

export default function Calendario({ meses }) {
  const [ativo, setAtivo] = useState(null)
  if (!meses?.length) return <p className="empty">Sem histórico suficiente.</p>

  const porMes = new Map(meses.map((m) => [Number(m.mes_do_ano), m]))

  return (
    <div className="chart-wrap" onMouseLeave={() => setAtivo(null)}>
      <div className="calendario">
        {MESES.map((nome, i) => {
          const m = porMes.get(i + 1)
          const indice = m ? Number(m.indice) : null
          return (
            <div
              key={nome} className="mes" style={tinta(indice)}
              onMouseEnter={() => setAtivo(i + 1)}
              title={m ? `${nome}: índice ${indice.toFixed(2)}` : `${nome}: sem histórico`}
            >
              <div className="m-nome">{nome}</div>
              <div className={`m-valor${indice === null ? ' m-vazio' : ''}`}>
                {indice === null ? '—' : indice.toFixed(2).replace('.', ',')}
              </div>
            </div>
          )
        })}
      </div>

      <div className="escala">
        <span>fraco</span>
        <div className="faixa" style={{
          background: 'linear-gradient(90deg, color-mix(in srgb, var(--series-2) 70%, var(--surface)),'
            + ' var(--surface), color-mix(in srgb, var(--series-1) 70%, var(--surface)))',
        }} />
        <span>forte</span>
        <span style={{ marginLeft: 6 }}>· 1,00 é a média do ano</span>
      </div>

      {ativo !== null && porMes.get(ativo) && (
        <div className="tooltip" style={{ right: 0, top: -6 }}>
          <div className="t-title">{MESES[ativo - 1]}</div>
          <div className="t-row">
            <span>índice</span>
            <span>{Number(porMes.get(ativo).indice).toFixed(2).replace('.', ',')}</span>
          </div>
          <div className="t-row">
            <span>média do mês</span>
            <span>{brl(porMes.get(ativo).media)}</span>
          </div>
          <div className="t-row" style={{ color: 'var(--text-muted)' }}>
            <span>anos medidos</span>
            <span>{porMes.get(ativo).anos}</span>
          </div>
        </div>
      )}
    </div>
  )
}
