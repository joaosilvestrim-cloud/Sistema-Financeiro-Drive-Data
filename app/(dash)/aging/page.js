import { requireSession } from '@/lib/session'
import { aging, lerFiltros, opcoesAging } from '@/lib/aging'
import AgingInterativo from '@/components/AgingInterativo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Aging · DriveAzul' }

// Aging configurável. A página só lê os filtros da URL, busca e entrega; toda
// a interação mora no componente, e cada mudança volta para cá como URL nova.
export default async function Aging({ searchParams }) {
  const sessao = await requireSession()
  const busca = await searchParams
  const filtros = lerFiltros(busca ?? {})
  const [dados, opcoes] = await Promise.all([
    aging(sessao, filtros),
    opcoesAging(sessao, filtros.kind),
  ])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Aging</h1>
          <p>
            A carteira em aberto por idade, do jeito que você precisa ler: escolha as faixas,
            agrupe, filtre por conta, centro de custo ou cliente, e veja como estava em qualquer
            data desde o início do histórico.
          </p>
        </div>
      </div>
      <AgingInterativo filtros={filtros} opcoes={opcoes} dados={dados} />
    </>
  )
}
