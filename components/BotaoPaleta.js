'use client'

// Atalho visível para a busca rápida. Quem não sabe do Ctrl+K descobre aqui.
export default function BotaoPaleta() {
  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
  return (
    <button type="button" className="botao-paleta" onClick={() => window.dispatchEvent(new Event('abrir-paleta'))}>
      Buscar tela <kbd suppressHydrationWarning>{mac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  )
}
