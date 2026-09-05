'use client'
import { useEffect, useState } from 'react'

// Troca entre tema claro e escuro.
//
// Duas formas, o mesmo comportamento. Dentro do painel ele é um botão escrito,
// no rodapé da barra lateral, onde alguém procuraria por uma preferência. Fora
// do painel, nas telas que não têm barra lateral, ele flutua no canto.
//
// A escolha vive no localStorage e quem a aplica é o script inline do layout
// raiz, antes da primeira pintura. Aqui só trocamos o atributo e guardamos.

export default function TemaToggle({ flutuante = true }) {
  const [tema, setTema] = useState(null)

  // Lê o que o script inline já decidiu, em vez de decidir de novo. Decidir duas
  // vezes daria divergência entre o servidor e o cliente.
  useEffect(() => {
    setTema(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  }, [])

  function alternar() {
    const novo = tema === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', novo)
    try { localStorage.setItem('tema', novo) } catch { /* aba anônima, vale só nesta sessão */ }
    setTema(novo)
  }

  // Enquanto não sabe o tema, não desenha. Desenhar um estado e corrigir no
  // instante seguinte é o mesmo piscar que o script inline evita.
  if (!tema) return null

  const rotulo = tema === 'dark' ? 'Tema claro' : 'Tema escuro'

  if (!flutuante) {
    return (
      <button className="toggle" type="button" onClick={alternar} title={rotulo}>
        {tema === 'dark' ? '☀' : '☾'} {rotulo}
      </button>
    )
  }

  return (
    <button
      className="tema-flutuante"
      onClick={alternar}
      aria-label={rotulo}
      title={rotulo}
      style={{
        position: 'fixed', right: 14, bottom: 14, zIndex: 50,
        width: 34, height: 34, borderRadius: 999,
        border: '1px solid var(--border)', background: 'var(--surface)',
        color: 'var(--text-secondary)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, lineHeight: 1, padding: 0,
        boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
      }}
    >
      {tema === 'dark' ? '☀' : '☾'}
    </button>
  )
}
