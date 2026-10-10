'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

// Barra fina no topo durante a troca de tela. O esqueleto da página já aparece
// em poucos milissegundos, mas quando o servidor demora (partida a frio), a
// barra continua andando e diz que o clique foi ouvido. Some quando a tela nova
// chega.
export default function BarraNavegacao() {
  const caminho = usePathname()
  const busca = useSearchParams()
  const [largura, setLargura] = useState(0)
  const [visivel, setVisivel] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    const clique = (e) => {
      const a = e.target.closest?.('a[href]')
      if (!a || a.target === '_blank' || e.ctrlKey || e.metaKey || e.shiftKey) return
      const url = new URL(a.href, location.href)
      if (url.origin !== location.origin) return
      if (url.pathname === location.pathname && url.search === location.search) return
      clearInterval(timer.current)
      setVisivel(true)
      setLargura(12)
      // Avança devagar e nunca chega ao fim sozinha: quem fecha é a tela nova.
      timer.current = setInterval(() => setLargura((w) => (w < 85 ? w + (90 - w) * 0.08 : w)), 160)
    }
    document.addEventListener('click', clique, true)
    return () => document.removeEventListener('click', clique, true)
  }, [])

  useEffect(() => {
    if (!visivel) return
    clearInterval(timer.current)
    setLargura(100)
    const t = setTimeout(() => { setVisivel(false); setLargura(0) }, 320)
    return () => clearTimeout(t)
  }, [caminho, busca]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="barra-navegacao" aria-hidden="true"
      style={{ width: `${largura}%`, opacity: visivel ? 1 : 0 }} />
  )
}
