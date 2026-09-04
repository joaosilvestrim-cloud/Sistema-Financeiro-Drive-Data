'use client'
import { useEffect, useState } from 'react'

// Botão de tema, flutuante no canto.
//
// Fica fora do painel de propósito: as telas de cadastro, planos, termos e
// carga também precisam dele, e nenhuma delas tem barra lateral.
//
// A escolha vive no localStorage e é aplicada pelo script inline do layout,
// antes da primeira pintura. Aqui só trocamos o atributo e guardamos.

export default function TemaToggle() {
  const [tema, setTema] = useState(null)

  // Lê o que o script inline já decidiu, em vez de decidir de novo. Decidir
  // duas vezes daria divergência entre o servidor e o cliente.
  useEffect(() => {
    setTema(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  }, [])

  function alternar() {
    const novo = tema === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', novo)
    try { localStorage.setItem('tema', novo) } catch { /* aba anônima, vale só nesta sessão */ }
    setTema(novo)
  }

  // Enquanto não sabe o tema, não desenha. Desenhar "escuro" e corrigir para
  // "claro" no instante seguinte é o mesmo piscar que o script inline evita.
  if (!tema) return null

  return (
    <button
      onClick={alternar}
      aria-label={tema === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      title={tema === 'dark' ? 'Tema claro' : 'Tema escuro'}
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
