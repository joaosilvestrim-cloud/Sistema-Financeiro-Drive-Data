import Marca from '@/components/Marca'

// Moldura das páginas de termos e privacidade. Fica fora do painel porque
// precisam abrir sem login: a Conta Azul consulta as duas na aprovação da
// integração, e o cliente lê antes de existir conta.

export default function Legal({ titulo, atualizado, children }) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px 80px' }}>
      <Marca tamanho={34} />
      <h1 style={{ marginTop: 28, marginBottom: 4 }}>{titulo}</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
        Última atualização: {atualizado}
      </p>
      <div className="legal" style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        {children}
      </div>
    </div>
  )
}
