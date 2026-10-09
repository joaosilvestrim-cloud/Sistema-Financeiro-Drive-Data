'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// Busca rápida de telas, aberta com Ctrl+K (ou Cmd+K no Mac) de qualquer lugar
// do painel. Quem usa todo dia decora o caminho e para de procurar no menu:
// "agi" Enter abre o aging, "flu" Enter o fluxo.
//
// A busca ignora acento e casa por pedaço de palavra, porque ninguém digita
// "projeção" com til no meio da pressa.

const semAcento = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function Paleta({ itens }) {
  const router = useRouter()
  const [aberta, setAberta] = useState(false)
  const [termo, setTermo] = useState('')
  const [indice, setIndice] = useState(0)
  const campo = useRef(null)

  useEffect(() => {
    const tecla = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setAberta((a) => !a)
      }
    }
    const abrir = () => setAberta(true)
    window.addEventListener('keydown', tecla)
    window.addEventListener('abrir-paleta', abrir)
    return () => { window.removeEventListener('keydown', tecla); window.removeEventListener('abrir-paleta', abrir) }
  }, [])

  useEffect(() => {
    if (aberta) { setTermo(''); setIndice(0); setTimeout(() => campo.current?.focus(), 10) }
  }, [aberta])

  const achados = useMemo(() => {
    const t = semAcento(termo.trim())
    if (!t) return itens
    return itens
      .map((i) => {
        const alvo = semAcento(`${i.titulo} ${i.grupo}`)
        const pos = alvo.indexOf(t)
        const inicioPalavra = alvo.split(' ').some((p) => p.startsWith(t))
        return { ...i, nota: pos === -1 ? -1 : (inicioPalavra ? 2 : 1) }
      })
      .filter((i) => i.nota > 0)
      .sort((a, b) => b.nota - a.nota)
  }, [termo, itens])

  function ir(item) {
    if (!item) return
    setAberta(false)
    router.push(item.href)
  }

  function teclas(e) {
    if (e.key === 'Escape') setAberta(false)
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndice((i) => Math.min(achados.length - 1, i + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIndice((i) => Math.max(0, i - 1)) }
    if (e.key === 'Enter') { e.preventDefault(); ir(achados[indice]) }
  }

  if (!aberta) return null

  return (
    <div className="paleta-fundo" onMouseDown={() => setAberta(false)}>
      <div className="paleta" role="dialog" aria-label="Ir para uma tela" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={campo} value={termo} placeholder="Ir para..." aria-label="Buscar tela"
          onChange={(e) => { setTermo(e.target.value); setIndice(0) }} onKeyDown={teclas}
        />
        <ul>
          {achados.map((i, k) => (
            <li key={i.href} data-ativo={k === indice} onMouseEnter={() => setIndice(k)} onClick={() => ir(i)}>
              <i style={{ background: i.cor }} />
              <span>{i.titulo}</span>
              <small>{i.grupo}</small>
            </li>
          ))}
          {!achados.length && <li className="paleta-vazio">Nenhuma tela com esse nome</li>}
        </ul>
        <div className="paleta-dica">↑ ↓ para escolher · Enter para abrir · Esc para fechar</div>
      </div>
    </div>
  )
}
