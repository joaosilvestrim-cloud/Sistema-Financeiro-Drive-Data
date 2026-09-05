'use client'
import { useState } from 'react'
import { brl } from '@/lib/format'

// Tabela de faturamento por cliente com o anexo editável.
//
// Cada linha envia sozinha, sem botão de salvar geral, pelo mesmo motivo do
// classificador de categorias: ninguém classifica vinte clientes de uma sentada,
// e perder tudo ao fechar a aba seria o pior desfecho possível.
//
// Cliente sem cadastro no ERP não pode ser classificado, porque a marcação
// precisa de uma pessoa para se prender. Isso aparece na linha em vez de virar
// um seletor que não salva.

export default function RegimeCliente({ clientes, acao, padrao }) {
  const [soPadrao, setSoPadrao] = useState(false)

  const naoClassificados = clientes.filter((c) => !c.classificado && c.person_id)
  const lista = soPadrao ? naoClassificados : clientes

  return (
    <>
      {naoClassificados.length > 0 && (
        <p style={{ fontSize: 13, marginTop: 0 }}>
          {naoClassificados.length} no padrão (Anexo {padrao}).{' '}
          <button className="toggle" type="button" onClick={() => setSoPadrao((v) => !v)}>
            {soPadrao ? 'ver todos' : 'ver só os que estão no padrão'}
          </button>
        </p>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th className="num">Faturamento</th>
              <th>Anexo</th>
              <th className="num">Alíquota</th>
              <th className="num">Imposto</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((c, i) => (
              <tr key={c.person_id ?? `sem-${i}`}>
                <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.cliente}
                </td>
                <td className="num">{brl(c.receita)}</td>
                <td>
                  {c.person_id ? (
                    <form action={acao}>
                      <input type="hidden" name="pessoa" value={c.person_id} />
                      <select
                        name="anexo" defaultValue={c.anexo}
                        onChange={(e) => e.target.form.requestSubmit()}
                        style={{
                          fontSize: 12,
                          borderColor: c.classificado ? 'var(--border)' : 'var(--warning)',
                        }}
                      >
                        <option value="III">Anexo III</option>
                        <option value="V">Anexo V</option>
                      </select>
                      {!c.classificado && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
                          padrão
                        </span>
                      )}
                      <noscript>
                        <button className="toggle" type="submit" style={{ marginLeft: 6 }}>ok</button>
                      </noscript>
                    </form>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      sem cadastro no ERP
                    </span>
                  )}
                </td>
                <td className="num">{c.aliquota}%</td>
                <td className="num">{brl(c.imposto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
