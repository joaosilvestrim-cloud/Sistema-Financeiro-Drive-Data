'use client'
import { useState } from 'react'
import { brl } from '@/lib/format'

// Tabela de classificação de categoria.
//
// Cada linha envia sozinha, sem botão de salvar geral. É de propósito:
// classificar 25 categorias com um botão só no fim significa perder tudo se a
// aba fechar no meio, e a pessoa não faz isso de uma sentada.
//
// O que precisa de decisão vem primeiro e fica destacado. O resto já tem um
// palpite do DRE do ERP e só precisa de conferência.

const CLASSES = [
  ['receita', 'Receita', 'o que a empresa fatura'],
  ['direto', 'Custo direto', 'anda junto com a entrega'],
  ['variavel', 'Custo variável', 'percentual da venda, como imposto'],
  ['fixo', 'Custo fixo', 'existe mesmo sem vender'],
  ['fora', 'Fora da operação', 'investimento, empréstimo, lucro distribuído'],
]

export default function Classificador({ categorias, acao }) {
  const [soPendentes, setSoPendentes] = useState(false)

  const pendentes = categorias.filter((c) => !c.classe_manual && !c.classe_sugerida)
  const lista = soPendentes ? pendentes : categorias

  return (
    <>
      {pendentes.length > 0 && (
        <p style={{ fontSize: 13, marginTop: 0 }}>
          <strong>{pendentes.length} categoria(s) sem palpite do ERP.</strong>{' '}
          São elas que travam o multiplicador.{' '}
          <button className="toggle" type="button" onClick={() => setSoPendentes((v) => !v)}>
            {soPendentes ? 'ver todas' : 'ver só as pendentes'}
          </button>
        </p>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Categoria</th>
              <th className="num">12 meses</th>
              <th>Classe</th>
              <th>Origem</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((c) => {
              const atual = c.classe_manual ?? c.classe_sugerida ?? ''
              const pendente = !atual
              return (
                <tr key={c.id} style={pendente ? { background: 'color-mix(in srgb, var(--warning) 10%, transparent)' } : undefined}>
                  <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.nome}
                  </td>
                  <td className="num">{brl(c.valor)}</td>
                  <td>
                    <form action={acao}>
                      <input type="hidden" name="categoria" value={c.id} />
                      <select
                        name="classe" defaultValue={atual}
                        onChange={(e) => e.target.form.requestSubmit()}
                        style={{
                          fontSize: 12, maxWidth: 190,
                          borderColor: pendente ? 'var(--warning)' : 'var(--border)',
                        }}
                      >
                        <option value="" disabled>escolha</option>
                        {CLASSES.map(([valor, rotulo]) => (
                          <option key={valor} value={valor}>{rotulo}</option>
                        ))}
                      </select>
                      <noscript>
                        <button className="toggle" type="submit" style={{ marginLeft: 6 }}>ok</button>
                      </noscript>
                    </form>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {c.classe_manual
                      ? 'você definiu'
                      : c.classe_sugerida
                        ? `DRE do ERP${c.entrada_dre ? `: ${c.entrada_dre.toLowerCase().replaceAll('_', ' ')}` : ''}`
                        : 'sem DRE no ERP, precisa da sua decisão'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, display: 'grid', gap: 3 }}>
        {CLASSES.map(([valor, rotulo, explica]) => (
          <div key={valor}><strong>{rotulo}:</strong> {explica}</div>
        ))}
      </div>
    </>
  )
}
