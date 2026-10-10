'use client'
import { useState, useTransition } from 'react'

// Sincronizar agora, com resposta visível. A sincronização pode levar até 45
// segundos quando o Conta Azul teve um dia movimentado, e um botão parado esse
// tempo todo parece quebrado: a pessoa clica de novo, e de novo. O ícone gira
// enquanto trabalha e, no fim, a frase diz o que mudou.
export default function BotaoSincronizar({ acao, conexao }) {
  const [pendente, iniciar] = useTransition()
  const [resultado, setResultado] = useState(null)

  function sincronizar() {
    setResultado(null)
    iniciar(async () => {
      const r = await acao(conexao)
      setResultado(r)
    })
  }

  const frase = !resultado ? null
    : resultado.erro ? resultado.erro
      : resultado.itens > 0
        ? `Pronto: ${resultado.itens} ${resultado.itens === 1 ? 'lançamento atualizado' : 'lançamentos atualizados'}.`
        : 'Pronto: tudo já estava em dia.'

  return (
    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button type="button" className="toggle botao-sync" onClick={sincronizar} disabled={pendente}
        data-girando={pendente} aria-live="polite">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M13.5 6.2A5.6 5.6 0 0 0 3 4.6M2.5 9.8A5.6 5.6 0 0 0 13 11.4" />
          <path d="M3 1.8v2.8h2.8M13 14.2v-2.8h-2.8" />
        </svg>
        {pendente ? 'Sincronizando…' : 'Sincronizar agora'}
      </button>
      {frase && (
        <span style={{ fontSize: 12.5, color: resultado.erro ? 'var(--critical)' : 'var(--good-text)' }}>{frase}</span>
      )}
    </div>
  )
}
