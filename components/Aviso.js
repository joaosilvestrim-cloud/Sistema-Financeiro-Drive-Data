// Recado de falha, no topo da tela que tentou a ação.
//
// Vem da URL, posto lá por lib/acao.js. Um cartão, com a borda na cor de
// crítico e a frase de verdade dentro. Sem ícone de alerta e sem pedido de
// desculpas: quem clicou quer saber o que corrigir, não ser consolado.
export default function Aviso({ erro, titulo = 'A ação não foi concluída' }) {
  if (!erro) return null
  return (
    <div className="card" style={{ marginBottom: 14, borderColor: 'var(--critical)' }} role="alert">
      <h2 style={{ color: 'var(--critical)' }}>{titulo}</h2>
      <p style={{ margin: 0 }}>{erro}</p>
    </div>
  )
}
