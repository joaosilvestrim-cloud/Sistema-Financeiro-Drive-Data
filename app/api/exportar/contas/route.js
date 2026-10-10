import { requireSession } from '@/lib/session'
import { razao } from '@/lib/razao'
import { filtrosDaUrl, colunasContas } from '@/lib/contasFiltro'
import { paraCsv, nomeDoArquivo } from '@/lib/csv'

export const dynamic = 'force-dynamic'

// O recorte inteiro da tela de Contas em CSV.
//
// A tela é paginada (80 por vez) e o botão exportava só a página aberta. Aqui
// sai tudo o que o recorte tem, lido da mesma URL pelo mesmo filtrosDaUrl e
// consultado pela mesma razao(). O teto existe só para um pedido torto não
// virar uma consulta sem fim; uma empresa real fica muito abaixo dele.
const TETO = 20000

const SITUACAO = { a_vencer: 'a vencer', vencido: 'vencido', parcial: 'parcial', liquidado: 'liquidado' }

export async function GET(request) {
  const sessao = await requireSession()
  const busca = Object.fromEntries(new URL(request.url).searchParams)
  const { tipo, f } = filtrosDaUrl(busca)

  const linhas = (await razao(sessao, f, { limite: TETO, pagina: 0 }))
    .map((l) => ({ ...l, situacao: SITUACAO[l.situacao] ?? l.situacao }))

  const csv = paraCsv(linhas, colunasContas(tipo))
  const nome = nomeDoArquivo(`contas-${tipo === 'receivable' ? 'receber' : 'pagar'}`)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nome}"`,
      'Cache-Control': 'no-store',
    },
  })
}
