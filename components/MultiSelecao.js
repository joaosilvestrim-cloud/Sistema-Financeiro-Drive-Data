'use client'
import { useEffect, useRef, useState } from 'react'
import s from './aging.module.css'

// Seletor múltiplo em painel suspenso, com busca quando a lista é longa.
// Aplica ao fechar, e não a cada clique: marcar cinco contas não deve disparar
// cinco consultas. Usado no aging, no fluxo de caixa e na lista de contas.
export default function Multi({ rotulo, opcoes, selecionados, aoMudar }) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [rascunho, setRascunho] = useState(selecionados)
  const ref = useRef(null)
  useEffect(() => setRascunho(selecionados), [selecionados])
  useEffect(() => {
    if (!aberto) return
    const fora = (e) => { if (!ref.current?.contains(e.target)) fechar() }
    const esc = (e) => { if (e.key === 'Escape') fechar() }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  })
  // Aplica ao fechar, e não a cada clique: marcar cinco contas não deve
  // disparar cinco consultas.
  function fechar() {
    setAberto(false)
    setBusca('')
    if (rascunho.join() !== selecionados.join()) aoMudar(rascunho)
  }
  const visiveis = opcoes.filter((o) => o.rotulo.toLowerCase().includes(busca.toLowerCase()))
  const alternar = (id) => setRascunho((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]))
  return (
    <div className={s.multi} ref={ref}>
      <button type="button" className={s.gatilho} aria-expanded={aberto} onClick={() => (aberto ? fechar() : setAberto(true))}>
        {rotulo}
        {selecionados.length > 0 && <span className={s.conta}>{selecionados.length}</span>}
        <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>▾</span>
      </button>
      {aberto && (
        <div className={s.painel}>
          {opcoes.length > 7 && (
            <input type="search" placeholder="Buscar" value={busca} autoFocus onChange={(e) => setBusca(e.target.value)} />
          )}
          <div className={s.opcoes} style={{ paddingTop: opcoes.length > 7 ? 0 : 6 }}>
            {visiveis.map((o) => (
              <label key={o.id} className={s.opcao}>
                <input type="checkbox" checked={rascunho.includes(o.id)} onChange={() => alternar(o.id)} />
                <span>{o.rotulo}</span>
                {o.extra && <small>{o.extra}</small>}
              </label>
            ))}
            {!visiveis.length && <div className={s.opcao} style={{ cursor: 'default', color: 'var(--text-muted)' }}>Nada encontrado</div>}
          </div>
          <div className={s.rodapePainel}>
            <button type="button" onClick={() => setRascunho([])}>Limpar</button>
            <button type="button" onClick={fechar}>Aplicar</button>
          </div>
        </div>
      )}
    </div>
  )
}
