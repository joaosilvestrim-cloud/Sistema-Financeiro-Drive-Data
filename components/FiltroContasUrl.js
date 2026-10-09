'use client'
import { useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Multi from '@/components/MultiSelecao'

// Seletor de contas financeiras que escreve na URL (?conta=a,b) e preserva o
// resto dos filtros da tela. A visão filtrada fica compartilhável e volta
// igual depois do F5.
export default function FiltroContasUrl({ contas, selecionadas, rotulo = 'Contas' }) {
  const router = useRouter()
  const caminho = usePathname()
  const params = useSearchParams()
  const [pendente, iniciar] = useTransition()

  function aplicar(ids) {
    const p = new URLSearchParams(params)
    if (ids.length) p.set('conta', ids.join(','))
    else p.delete('conta')
    iniciar(() => router.replace(`${caminho}${p.size ? `?${p}` : ''}`, { scroll: false }))
  }

  return (
    <span style={{ opacity: pendente ? 0.6 : 1, transition: 'opacity 160ms ease' }}>
      <Multi
        rotulo={rotulo}
        opcoes={contas.map((c) => ({ id: c.id, rotulo: c.rotulo, extra: c.ativo === false ? 'inativa' : null }))}
        selecionados={selecionadas}
        aoMudar={aplicar}
      />
    </span>
  )
}
