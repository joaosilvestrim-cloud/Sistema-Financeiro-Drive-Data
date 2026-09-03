import Link from 'next/link'

// A cor nunca carrega o recado sozinha. Cada alerta traz ícone e rótulo de
// nível, que é o que faz a leitura funcionar em impressão, em daltonismo e em
// tela de baixo contraste.
const NIVEIS = {
  critical: { cor: 'var(--critical)', icone: '▲', rotulo: 'Crítico' },
  warning: { cor: 'var(--warning)', icone: '●', rotulo: 'Atenção' },
  info: { cor: 'var(--series-1)', icone: '■', rotulo: 'Informação' },
}

export default function Alerts({ itens }) {
  if (!itens.length) return null

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h2>O que pede atenção</h2>
      <p className="sub">Ordenado por gravidade. Some quando a causa é resolvida.</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {itens.map((a, i) => {
          const n = NIVEIS[a.nivel] ?? NIVEIS.info
          return (
            <Link
              key={i}
              href={a.href}
              style={{
                display: 'grid', gridTemplateColumns: '20px 1fr', gap: 10,
                padding: '9px 11px', borderRadius: 8,
                border: '1px solid var(--border)',
                borderLeft: `3px solid ${n.cor}`,
              }}
            >
              <span aria-hidden="true" style={{ color: n.cor, fontSize: 13, lineHeight: '20px' }}>{n.icone}</span>
              <span>
                <span style={{ fontWeight: 550 }}>{a.titulo}</span>
                <span style={{ color: n.cor, fontSize: 11, marginLeft: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {n.rotulo}
                </span>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{a.texto}</div>
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
