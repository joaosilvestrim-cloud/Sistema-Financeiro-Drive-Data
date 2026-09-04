import { requireSession } from '@/lib/session'
import { topClientes } from '@/lib/queries'
import { brl } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function Clientes() {
  const sessao = await requireSession()
  const clientes = await topClientes(sessao, 40)

  const total = clientes.reduce((a, c) => a + Number(c.faturado), 0)
  // Concentração: quanto os cinco maiores respondem do faturamento. Acima de
  // 60% já é dependência que merece conversa comercial.
  const top5 = clientes.slice(0, 5).reduce((a, c) => a + Number(c.faturado), 0)
  const concentracao = total > 0 ? top5 / total : 0

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Clientes</h1>
          <p>
            Os cinco maiores respondem por {(concentracao * 100).toFixed(1).replace('.', ',')}% do faturado
            {concentracao > 0.6 ? '. Concentração alta, vale acompanhar.' : '.'}
          </p>
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th className="num">Faturado</th>
              <th className="num">Em aberto</th>
              <th className="num">Vencido</th>
              <th className="num">Atraso médio</th>
              <th className="num">Participação</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => {
              const part = total > 0 ? Number(c.faturado) / total : 0
              return (
                <tr key={c.cliente}>
                  <td>{c.cliente}</td>
                  <td className="num">{brl(c.faturado)}</td>
                  <td className="num">{brl(c.em_aberto)}</td>
                  <td className="num" style={{ color: Number(c.vencido) > 0 ? 'var(--critical)' : undefined }}>
                    {Number(c.vencido) > 0 ? brl(c.vencido) : '—'}
                  </td>
                  <td className="num">
                    {c.atraso_medio_dias === null ? '—' : `${Number(c.atraso_medio_dias).toFixed(0)} d`}
                  </td>
                  <td className="num">{(part * 100).toFixed(1).replace('.', ',')}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
