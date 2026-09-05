import { requireSession } from '@/lib/session'
import { aging, recebiveisAbertos } from '@/lib/queries'
import { historicoDosTitulos } from '@/lib/memoria'
import Exportar from '@/components/Exportar'
import LinhaExpansivel from '@/components/LinhaExpansivel'
import { brl, dataCurta } from '@/lib/format'
import HBars from '@/components/charts/HBars'

export const dynamic = 'force-dynamic'

const FAIXAS = {
  a_vencer: ['A vencer', 'var(--ramp-250)'],
  d1_30:    ['1 a 30 dias', 'var(--ramp-350)'],
  d31_60:   ['31 a 60 dias', 'var(--ramp-450)'],
  d61_90:   ['61 a 90 dias', 'var(--ramp-550)'],
  d90_mais: ['mais de 90 dias', 'var(--ramp-650)'],
}

// O que abre dentro da linha de um título: a história dele.
//
// "Visto em" é o dia em que a nossa leitura passou a valer, e a linha seguinte
// só existe porque alguma coisa mudou no ERP. Duas linhas com vencimentos
// diferentes é um adiamento; com pago diferente é uma baixa parcial.
const VERSOES = [
  { chave: 'visto_em', titulo: 'Visto em', tipo: 'data' },
  { chave: 'data_vencimento', titulo: 'Vencimento', tipo: 'data' },
  { chave: 'total', titulo: 'Total', tipo: 'dinheiro' },
  { chave: 'pago', titulo: 'Pago', tipo: 'dinheiro' },
  { chave: 'nao_pago', titulo: 'Em aberto', tipo: 'dinheiro' },
  { chave: 'situacao', titulo: 'Situação', tipo: 'texto' },
]

export default async function Recebiveis() {
  const sessao = await requireSession()
  const [rec, pag, titulos, versoes] = await Promise.all([
    aging(sessao, 'receivable'), aging(sessao, 'payable'), recebiveisAbertos(sessao, 80),
    historicoDosTitulos(sessao, 'receivable', 80),
  ])

  // Agrupado uma vez, não uma vez por linha: com oitenta títulos, filtrar a
  // lista inteira dentro do map seria oitenta varreduras da mesma lista.
  const historico = new Map()
  for (const v of versoes) {
    if (!historico.has(v.installment_id)) historico.set(v.installment_id, [])
    // Só os campos que a linha aberta desenha. Espalhar a linha inteira levava
    // installment_id e valid_to no payload de cada versão, oitenta vezes.
    historico.get(v.installment_id).push({
      visto_em: v.visto_em,
      data_vencimento: v.data_vencimento,
      total: v.total,
      pago: v.pago,
      nao_pago: v.nao_pago,
      situacao: String(v.status ?? '').toLowerCase().replaceAll('_', ' ') || '—',
    })
  }

  const emAberto = rec.reduce((a, f) => a + Number(f.valor), 0)
  const vencido = rec.filter((f) => f.faixa !== 'a_vencer').reduce((a, f) => a + Number(f.valor), 0)

  const bars = (dados) => dados.map((f) => ({
    rotulo: FAIXAS[f.faixa]?.[0] ?? f.faixa,
    cor: FAIXAS[f.faixa]?.[1],
    valor: f.valor,
    nota: `${f.titulos} títulos`,
  }))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Recebíveis</h1>
          <p>
            {brl(emAberto)} em aberto, sendo {brl(vencido)} vencidos
            {emAberto > 0 && ` (${((vencido / emAberto) * 100).toFixed(1).replace('.', ',')}%)`}.
            Títulos com seta já mudaram desde que começamos a olhar: clique para
            ver o histórico.
          </p>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <h2>A receber por faixa</h2>
          <p className="sub">Dias de atraso em relação ao vencimento.</p>
          <HBars dados={bars(rec)} />
        </div>
        <div className="card">
          <h2>A pagar por faixa</h2>
          <p className="sub">Mesma régua, do outro lado.</p>
          <HBars dados={bars(pag)} cor="var(--series-2)" />
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
          <div>
            <h2>Títulos em aberto</h2>
            <p className="sub">Os {titulos.length} mais antigos primeiro.</p>
          </div>
          <Exportar
            linhas={titulos} arquivo="titulos-em-aberto"
            colunas={[
              ['data_vencimento', 'Vencimento', 'data'],
              ['cliente', 'Cliente', 'texto'],
              ['descricao', 'Descrição', 'texto'],
              ['categoria', 'Categoria', 'texto'],
              ['total', 'Total', 'dinheiro'],
              ['nao_pago', 'Em aberto', 'dinheiro'],
              ['dias_atraso', 'Dias de atraso', 'inteiro'],
              ['status_traduzido', 'Situação', 'texto'],
            ]}
          />
        </div>
        <table>
          <thead>
            <tr>
              <th />
              <th>Vencimento</th>
              <th>Cliente</th>
              <th>Descrição</th>
              <th>Categoria</th>
              <th className="num">Em aberto</th>
              <th className="num">Atraso</th>
            </tr>
          </thead>
          <tbody>
            {titulos.map((t, i) => {
              const atraso = Number(t.dias_atraso)
              const versoes = historico.get(t.installment_id) ?? []
              const celulas = (
                    <>
                      <td>{dataCurta(t.data_vencimento)}</td>
                      <td>{t.cliente ?? '—'}</td>
                      <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.descricao ?? '—'}
                      </td>
                      <td>{t.categoria ?? '—'}</td>
                      <td className="num">{brl(t.nao_pago)}</td>
                      <td className="num" style={{ color: atraso > 0 ? 'var(--critical)' : 'var(--text-muted)' }}>
                        {atraso > 0 ? `${atraso} d` : '—'}
                      </td>
                    </>
              )

              // Só abre o que tem o que contar. A maioria dos títulos foi lida
              // uma vez e não se mexeu; transformar essas linhas em botão
              // custaria payload em todas para frustrar quem clica em quase
              // todas. Quem tem história ganha a seta, e a seta passa a
              // significar alguma coisa.
              if (versoes.length < 2) {
                return <tr key={i}><td className="seta" />{celulas}</tr>
              }
              return (
                <LinhaExpansivel
                  key={i} colunas={7} campos={VERSOES}
                  itens={versoes} total={versoes.length}
                  rotulo={`${versoes.length} leituras deste título desde que começamos a olhar`}
                  rodape="Cada linha é um momento em que o ERP devolveu algo diferente. O Conta Azul sobrescreve; aqui fica o rastro."
                  celulas={celulas}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
