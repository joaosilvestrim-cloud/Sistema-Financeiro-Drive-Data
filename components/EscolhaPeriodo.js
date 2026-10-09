'use client'
import { useState } from 'react'
import { useFormStatus } from 'react-dom'

// Escolha do período da carga inicial. Cada opção diz quanto tempo leva, com o
// volume real da empresa, e o que ela libera no painel. A pergunta que a pessoa
// faz aqui é "vale a pena esperar mais?", e ela só consegue responder vendo as
// duas coisas lado a lado.

const OPCOES = [
  [6, 'O mais rápido',
    'Fluxo de caixa, contas a pagar e receber, conciliação e notas completos. As comparações de um ano ficam parciais.'],
  [12, 'Recomendado',
    'Um ano inteiro: DRE do ano, faturamento médio de 12 meses e o farol de pontualidade de cada cliente.'],
  [24, null,
    'Dois anos: dá para comparar cada mês com o mesmo mês do ano anterior.'],
  [36, 'O mais completo',
    'Três anos: a sazonalidade da receita passa a valer na projeção. É o que mais demora.'],
]

function Enviar() {
  const { pending } = useFormStatus()
  return (
    <button className="btn" type="submit" disabled={pending} style={{ width: 'auto', padding: '14px 32px' }}>
      {pending ? 'Começando…' : 'Começar a carga'}
    </button>
  )
}

export default function EscolhaPeriodo({ acao, estimativa }) {
  const [meses, setMeses] = useState(12)

  return (
    <form action={acao} style={{ display: 'block' }}>
      <div role="radiogroup" aria-label="Período de histórico" style={{ display: 'grid', gap: 10 }}>
        {OPCOES.map(([m, marca, texto]) => {
          const ativo = meses === m
          return (
            <label
              key={m}
              style={{
                display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 14, alignItems: 'start',
                padding: '18px 20px', borderRadius: 16, cursor: 'pointer',
                border: `1.5px solid ${ativo ? 'var(--text-primary)' : 'var(--axis)'}`,
                background: ativo ? '#f6f9fc' : '#ffffff',
              }}
            >
              <input
                type="radio" name="meses" value={m} checked={ativo}
                onChange={() => setMeses(m)}
                style={{ width: 18, height: 18, margin: '3px 0 0', accentColor: '#0a1628' }}
              />
              <span>
                <span style={{ display: 'block', fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                  {m} meses
                  {marca && (
                    <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0, color: m === 12 ? '#15803d' : 'var(--text-muted)', marginLeft: 10 }}>
                      {marca}
                    </span>
                  )}
                </span>
                <span style={{ display: 'block', fontSize: 15, lineHeight: 1.5, marginTop: 4 }}>{texto}</span>
              </span>
              {estimativa && (
                <span style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-primary)', whiteSpace: 'nowrap', paddingTop: 3 }}>
                  ~{estimativa.minutos[m]} min
                </span>
              )}
            </label>
          )
        })}
      </div>

      <ul style={{ margin: '20px 0 0', padding: 0, listStyle: 'none', fontSize: 14, lineHeight: 1.6, color: 'var(--text-muted)' }}>
        {estimativa && (
          <li>Tempo estimado para o volume da sua empresa, cerca de {estimativa.porMes} lançamentos por mês.</li>
        )}
        <li>Em qualquer opção vêm também os vencimentos dos próximos 24 meses.</li>
        <li>Dá para trazer mais histórico depois, na tela de Conexões.</li>
        <li>Depois da carga, tudo que mudar no Conta Azul chega sozinho.</li>
      </ul>

      <div style={{ marginTop: 24 }}>
        <Enviar />
      </div>
    </form>
  )
}
