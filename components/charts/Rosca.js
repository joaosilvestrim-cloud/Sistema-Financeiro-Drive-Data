'use client'
import { useState } from 'react'
import { brl, compacto } from '@/lib/format'

// Rosca. Para composição, e só para composição.
//
// Rosca é o gráfico mais malfalado que existe, com razão: ninguém compara dois
// ângulos parecidos, e a maioria dos usos seria melhor como barra. Ela ganha
// numa pergunta só, que é a que o DRE faz: quanto do bolo cada grupo ocupa. Aí
// o total tem significado, as partes somam cem por cento, e o buraco no meio é
// onde o total mora.
//
// Três regras que a mantêm honesta.
//
// Fatia pequena demais vira "outros". Sete pedaços é o limite do que alguém
// separa de relance; abaixo de 3% o ângulo não distingue nada e só suja a
// borda.
//
// O valor e o percentual ficam na legenda, ao lado do nome, não presos ao
// desenho. Quem precisa do número lê o número; o desenho serve para a ordem de
// grandeza.
//
// E a rampa é de um tom só. Cores diferentes por fatia sugeririam categorias
// independentes; aqui a ordem da rampa carrega a ordem do peso.

// Fatias sao categorias, coisas diferentes entre si, entao cada uma ganha um
// matiz proprio. A rampa monocromatica que morava aqui dizia "mais e menos"
// para dados que nao tem ordem nenhuma.
const CORES = ['var(--cat-1)', 'var(--cat-4)', 'var(--cat-2)', 'var(--cat-5)',
               'var(--cat-3)', 'var(--cat-6)', 'var(--cat-7)']
const MAX = 7
const MINIMO = 0.03

const S = 260
const R = 108
const ESPESSURA = 34

// Arco em coordenadas polares, começando no topo e girando no sentido do
// relógio, que é como se lê um relógio e uma pizza.
function arco(de, ate, raio) {
  const ponto = (t) => {
    const a = (t - 0.25) * 2 * Math.PI
    return [S / 2 + Math.cos(a) * raio, S / 2 + Math.sin(a) * raio]
  }
  const [x1, y1] = ponto(de)
  const [x2, y2] = ponto(ate)
  const grande = ate - de > 0.5 ? 1 : 0
  return { x1, y1, x2, y2, grande }
}

export default function Rosca({ fatias, titulo = 'total' }) {
  const [ativo, setAtivo] = useState(null)
  const validas = (fatias ?? []).filter((f) => Number(f.valor) > 0)
  if (!validas.length) return <p className="empty">Nada a compor.</p>

  const total = validas.reduce((a, f) => a + Number(f.valor), 0)
  const ordenadas = [...validas].sort((a, b) => Number(b.valor) - Number(a.valor))

  const grandes = ordenadas.filter((f, i) => i < MAX && Number(f.valor) / total >= MINIMO)
  const resto = ordenadas.filter((f) => !grandes.includes(f))
  const lista = resto.length
    ? [...grandes, { rotulo: `outros (${resto.length})`, valor: resto.reduce((a, f) => a + Number(f.valor), 0) }]
    : grandes

  let acumulado = 0
  const pedacos = lista.map((f, i) => {
    const fracao = Number(f.valor) / total
    const de = acumulado
    acumulado += fracao
    return {
      ...f, fracao, de, ate: acumulado,
      cor: i === lista.length - 1 && resto.length ? 'var(--text-muted)' : CORES[i % CORES.length],
    }
  })

  return (
    <div className="chart-wrap" style={{
      display: 'grid', gridTemplateColumns: `${S}px minmax(0, 1fr)`, gap: 20, alignItems: 'center',
    }} onMouseLeave={() => setAtivo(null)}>
      <svg viewBox={`0 0 ${S} ${S}`} width={S} height={S} role="img"
           aria-label={`Composição por ${titulo}`}>
        {pedacos.map((p, i) => {
          // Uma volta inteira não pode virar arco: com de igual a ate o
          // caminho some. Um círculo resolve o caso de uma fatia só.
          if (p.fracao > 0.999) {
            return (
              <circle key={i} cx={S / 2} cy={S / 2} r={R - ESPESSURA / 2}
                      fill="none" stroke={p.cor} strokeWidth={ESPESSURA} />
            )
          }
          const a = arco(p.de, p.ate, R - ESPESSURA / 2)
          const destaque = ativo === i
          return (
            <path
              key={i} className="marca"
              d={`M${a.x1} ${a.y1} A${R - ESPESSURA / 2} ${R - ESPESSURA / 2} 0 ${a.grande} 1 ${a.x2} ${a.y2}`}
              fill="none" stroke={p.cor}
              strokeWidth={destaque ? ESPESSURA + 6 : ESPESSURA}
              opacity={ativo === null || destaque ? 1 : 0.45}
              onMouseEnter={() => setAtivo(i)}
            />
          )
        })}

        <text x={S / 2} y={S / 2 - 4} textAnchor="middle" fontSize="21"
              fill="var(--text-primary)" fontWeight="620">
          {compacto(ativo === null ? total : pedacos[ativo].valor)}
        </text>
        <text x={S / 2} y={S / 2 + 16} textAnchor="middle" fontSize="11" fill="var(--text-muted)">
          {ativo === null ? titulo : `${(pedacos[ativo].fracao * 100).toFixed(1).replace('.', ',')}%`}
        </text>
      </svg>

      <ul className="rosca-legenda" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {pedacos.map((p, i) => (
          <li key={i} data-ativo={ativo === i} onMouseEnter={() => setAtivo(i)}>
            <i style={{ background: p.cor }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.rotulo}
            </span>
            <b>{brl(p.valor)} · {(p.fracao * 100).toFixed(1).replace('.', ',')}%</b>
          </li>
        ))}
      </ul>
    </div>
  )
}
