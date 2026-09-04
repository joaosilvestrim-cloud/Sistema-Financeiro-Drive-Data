// Esqueleto mostrado enquanto a pagina carrega os dados.
//
// Com todas as telas dinamicas, sem isto o navegador fica parado na tela
// anterior ate a ultima consulta voltar, e a navegacao parece travada mesmo
// quando o servidor esta respondendo.
export default function Carregando() {
  const bloco = (altura) => (
    <div style={{
      height: altura,
      borderRadius: 10,
      border: '1px solid var(--border)',
      background: 'var(--surface)',
      opacity: 0.7,
    }} />
  )
  return (
    <div style={{ display: 'grid', gap: 14 }} aria-busy="true" aria-live="polite">
      <div style={{ height: 22, width: 180, borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)' }} />
      <div className="grid cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i}>{bloco(86)}</div>)}
      </div>
      {bloco(320)}
      <div className="grid cols-2">
        {bloco(220)}
        {bloco(220)}
      </div>
      <span style={{ position: 'absolute', left: -9999 }}>Carregando dados</span>
    </div>
  )
}
