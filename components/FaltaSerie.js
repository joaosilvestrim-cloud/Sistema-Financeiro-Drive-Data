import Link from 'next/link'

// Estado vazio que ensina o caminho.
//
// "Sem dados" não ajuda ninguém. Aqui o texto diz qual série falta, o que o
// indicador passa a mostrar quando ela existir, e leva direto para a tela de
// preenchimento.
export default function FaltaSerie({ titulo, serie, oQueMostra, exemplo }) {
  return (
    <div className="empty" style={{ textAlign: 'left', display: 'grid', gap: 8 }}>
      <strong style={{ color: 'var(--text-primary)' }}>{titulo}</strong>
      <div>
        Falta a série <strong>{serie}</strong>. Com ela preenchida, esta seção passa a mostrar {oQueMostra}.
      </div>
      {exemplo && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{exemplo}</div>
      )}
      <div>
        <Link href="/dados" className="btn" style={{ display: 'inline-block', textDecoration: 'none' }}>
          Preencher em Dados auxiliares
        </Link>
      </div>
    </div>
  )
}
