'use client'
import { useRef } from 'react'

// Seletor de empresa. Consolidado soma todas as conexões do tenant, que é o
// caso de uso de quem tem matriz e filial no mesmo grupo.
export default function EmpresaSelect({ conexoes, selecionada, action }) {
  const form = useRef(null)
  if (conexoes.length === 0) return null

  return (
    <form action={action} ref={form}>
      <select
        name="empresa"
        defaultValue={selecionada ?? ''}
        onChange={() => form.current.requestSubmit()}
        style={{ width: '100%' }}
        aria-label="Empresa"
      >
        <option value="">Todas as empresas</option>
        {conexoes.map((c) => (
          <option key={c.id} value={c.id}>{c.nome}</option>
        ))}
      </select>
    </form>
  )
}
