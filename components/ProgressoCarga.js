'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// Barra da carga inicial.
//
// A tela é quem move o trabalho: chama o POST, ele avança uns 40 segundos,
// devolve onde parou, e ela chama de novo. Enquanto isso mostra o que está
// acontecendo, porque três anos de histórico levam alguns minutos e ninguém
// espera olhando ampulheta.

export default function ProgressoCarga({ conexaoId, nome }) {
  const router = useRouter()
  const [estado, setEstado] = useState(null)
  const [falhas, setFalhas] = useState(0)
  const rodando = useRef(false)

  useEffect(() => {
    let vivo = true

    async function passo() {
      if (!vivo || rodando.current) return
      rodando.current = true
      try {
        const r = await fetch(`/api/carga?conexao=${conexaoId}`, { method: 'POST' })
        const dado = await r.json()
        if (!vivo) return
        setEstado(dado)
        setFalhas(0)
        if (dado.status === 'concluido') {
          // Dá um instante para a pessoa ver a barra cheia antes de trocar de tela.
          setTimeout(() => { if (vivo) { router.push('/'); router.refresh() } }, 1200)
          return
        }
        if (dado.status === 'erro') return
        passo()
      } catch {
        // Rede caiu ou a função foi cortada. Tenta de novo, com paciência
        // crescente. O progresso está no banco, então nada se perde.
        if (!vivo) return
        setFalhas((n) => {
          const proxima = n + 1
          if (proxima <= 5) setTimeout(passo, 2000 * proxima)
          return proxima
        })
      } finally {
        rodando.current = false
      }
    }

    passo()
    return () => { vivo = false }
  }, [conexaoId, router])

  const pct = estado?.percentual ?? 0
  const erro = estado?.status === 'erro'

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h2>{nome}</h2>
      <p className="sub" style={{ marginTop: 4 }}>
        {erro ? 'A carga parou' : (estado?.rotulo ?? 'Começando')}
      </p>

      <div style={{
        height: 10, borderRadius: 999, background: 'var(--surface)',
        border: '1px solid var(--border)', overflow: 'hidden', marginTop: 14,
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: erro ? 'var(--critical)' : 'var(--accent)',
          transition: 'width 600ms ease',
        }} />
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', marginTop: 8,
        fontSize: 12, color: 'var(--text-muted)',
      }}>
        <span>{pct}%</span>
        <span>
          {Number(estado?.itens ?? 0).toLocaleString('pt-BR')} lançamentos
          {estado?.janelas_total > 0 && ` · mês ${estado.janela} de ${estado.janelas_total}`}
        </span>
      </div>

      {erro && (
        <>
          <p style={{ color: 'var(--critical)', fontSize: 13, marginTop: 14, marginBottom: 8 }}>
            {estado.erro}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
            O que já entrou está salvo. Continuar retoma do mês onde parou.
          </p>
          <button className="btn" onClick={() => { setEstado(null); setFalhas(0); location.reload() }}>
            Continuar de onde parou
          </button>
        </>
      )}

      {falhas > 0 && !erro && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
          Conexão instável, tentando de novo. Nada do que já entrou se perde.
        </p>
      )}

      {!erro && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 14, marginBottom: 0 }}>
          Pode deixar esta aba aberta. Se fechar, a carga continua da última
          etapa quando você voltar.
        </p>
      )}
    </div>
  )
}
