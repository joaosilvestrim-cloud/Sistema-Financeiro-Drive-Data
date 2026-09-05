import { requireSession } from '@/lib/session'
import { topClientes } from '@/lib/queries'
import { titulosPorPessoa } from '@/lib/executivo'
import Exportar from '@/components/Exportar'
import LinhaExpansivel from '@/components/LinhaExpansivel'
import { brl } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function Clientes() {
  const sessao = await requireSession()
  const [clientes, titulos] = await Promise.all([
    topClientes(sessao, 40),
    // Uma consulta serve as quarenta linhas. Quarenta consultas sob demanda,
    // uma por clique, custariam quarenta idas ao banco para mostrar o mesmo.
    titulosPorPessoa(sessao, 'receivable'),
  ])

  // Só os maiores viajam para dentro da linha; o total vai junto para a tela
  // saber dizer quantos ficaram de fora.
  const MAIORES = 8
  const maiores = (lista) =>
    [...lista].sort((x, y) => Number(y.nao_pago) - Number(x.nao_pago)).slice(0, MAIORES)

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
        <Exportar
          linhas={clientes} arquivo="clientes"
          colunas={[
            ['cliente', 'Cliente', 'texto'],
            ['faturado', 'Faturado', 'dinheiro'],
            ['em_aberto', 'Em aberto', 'dinheiro'],
            ['vencido', 'Vencido', 'dinheiro'],
            ['atraso_medio_dias', 'Atraso médio em dias', 'inteiro'],
            ['participacao', 'Participação', 'percentual'],
          ]}
        />
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th />
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
              const dele = titulos.filter((t) => t.pessoa === c.cliente)
              return (
                <LinhaExpansivel
                  key={c.cliente} colunas={7}
                  itens={maiores(dele)} total={dele.length}
                  rotulo={`${dele.length} título(s) em aberto de ${c.cliente}`}
                  rodape="A lista completa está em Recebíveis."
                  celulas={
                    <>
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
                    </>
                  }
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
