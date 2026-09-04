import { requireSession } from '@/lib/session'
import { prazosMedios, sazonalidade, concentracao, indiceHhi, anomalias } from '@/lib/queries'
import { receitaReal, tiposPreenchidos } from '@/lib/indicadoresAux'
import { brl, rotuloMes, indice } from '@/lib/format'
import Tile from '@/components/Tile'
import HBars from '@/components/charts/HBars'
import LinhaKpi from '@/components/charts/LinhaKpi'
import FaltaSerie from '@/components/FaltaSerie'

export const dynamic = 'force-dynamic'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function leituraHhi(hhi) {
  if (hhi === null || hhi === undefined) return ['—', null]
  if (hhi >= 0.25) return ['carteira concentrada', 'bad']
  if (hhi >= 0.15) return ['concentração moderada', null]
  return ['carteira diluída', 'good']
}

export default async function Indicadores() {
  const sessao = await requireSession()
  const [prazos, sazonal, conc, hhi, anomalos, real, tipos] = await Promise.all([
    prazosMedios(sessao), sazonalidade(sessao, 'receivable'),
    concentracao(sessao, 10), indiceHhi(sessao), anomalias(sessao, 3.5, 12),
    receitaReal(sessao, 24), tiposPreenchidos(sessao),
  ])

  const receber = prazos.find((p) => p.kind === 'receivable')
  const pagar = prazos.find((p) => p.kind === 'payable')
  const prazoReceber = Number(receber?.prazo ?? 0)
  const prazoPagar = Number(pagar?.prazo ?? 0)
  const ciclo = prazoReceber - prazoPagar
  const [leitura, tomHhi] = leituraHhi(hhi?.hhi === null ? null : Number(hhi?.hhi))

  const comSazonalidade = sazonal.filter((s) => Number(s.anos) >= 2)
  const acumulado = []
  let soma = 0
  for (const c of conc) {
    soma += Number(c.participacao)
    acumulado.push({ ...c, acumulado: soma })
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Indicadores</h1>
          <p>Prazos, sazonalidade, concentração e desvios. Base dos últimos 12 meses.</p>
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Tile label="Prazo de recebimento" valor={`${prazoReceber.toFixed(0)} dias`}
              nota={`atraso médio de ${Number(receber?.atraso ?? 0).toFixed(0)} dias`}
              tom={Number(receber?.atraso ?? 0) > 15 ? 'bad' : null} />
        <Tile label="Prazo de pagamento" valor={`${prazoPagar.toFixed(0)} dias`}
              nota="da competência até sair do caixa" />
        <Tile label="Ciclo financeiro" valor={`${ciclo.toFixed(0)} dias`}
              nota={ciclo > 0 ? 'você financia o cliente nesse intervalo' : 'você recebe antes de pagar'}
              tom={ciclo > 0 ? 'bad' : 'good'} />
        <Tile label="Concentração (HHI)" valor={hhi?.hhi ? indice(hhi.hhi) : '—'}
              nota={`${leitura} · ${hhi?.clientes ?? 0} clientes`} tom={tomHhi} />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <h2>Sazonalidade da receita</h2>
          <p className="sub">
            Quanto cada mês rende em relação à média. Acima de 1,00 é mês forte.
            Meses com menos de dois anos de histórico ficam de fora.
          </p>
          {comSazonalidade.length ? (
            <HBars
              formato="indice"
              dados={comSazonalidade.map((s) => ({
                rotulo: MESES[s.mes_do_ano - 1],
                valor: Number(s.indice),
                cor: Number(s.indice) >= 1 ? 'var(--series-1)' : 'var(--ramp-250)',
                nota: brl(s.media),
              }))}
              altura={24}
            />
          ) : (
            <p className="empty">
              Menos de dois anos de histórico. O índice sazonal só passa a valer com dois ciclos completos.
            </p>
          )}
        </div>

        <div className="card">
          <h2>Concentração de receita</h2>
          <p className="sub">Participação de cada cliente e acumulado, para leitura de Pareto.</p>
          <table>
            <thead>
              <tr><th>Cliente</th><th className="num">Participação</th><th className="num">Acumulado</th></tr>
            </thead>
            <tbody>
              {acumulado.map((c) => (
                <tr key={c.cliente}>
                  <td>{c.cliente}</td>
                  <td className="num">{(Number(c.participacao) * 100).toFixed(1).replace('.', ',')}%</td>
                  <td className="num" style={{ color: c.acumulado >= 0.8 ? 'var(--text-muted)' : undefined }}>
                    {(c.acumulado * 100).toFixed(1).replace('.', ',')}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Crescimento real</h2>
        <p className="sub">
          Receita nominal contra receita deflacionada pelo índice informado. Crescer 8% num ano de
          6% de inflação não é crescer 8%.
        </p>
        {tipos.has('indice_economico') && real.length >= 2 ? (
          <>
            <LinhaKpi
              dados={real}
              series={[
                { chave: 'nominal', rotulo: 'Receita nominal', cor: 'var(--series-1)' },
                { chave: 'real', rotulo: 'Receita real', cor: 'var(--series-3)' },
              ]}
              titulo="Receita nominal e real"
            />
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
              A receita real está em poder de compra de {rotuloMes(real[0].competencia)}, o primeiro
              mês da série do índice. O deflator acumulado hoje é {indice(real.at(-1).deflator)}.
            </p>
          </>
        ) : (
          <FaltaSerie
            titulo="Sem índice econômico"
            serie="Índice econômico"
            oQueMostra="a receita descontada da inflação, separando crescimento real de reajuste de preço"
            exemplo="Digite o IPCA de cada mês em percentual, por exemplo 0,45 para 0,45%."
          />
        )}
      </div>

      <div className="card">
        <h2>Desvios do padrão</h2>
        <p className="sub">
          Meses em que uma categoria fugiu do próprio histórico. Comparação por mediana e desvio absoluto
          mediano dos 12 meses anteriores, que não se deixa levar pelo próprio outlier.
        </p>
        {anomalos.length ? (
          <table>
            <thead>
              <tr>
                <th>Mês</th><th>Categoria</th><th>Tipo</th>
                <th className="num">Valor</th><th className="num">Padrão</th><th className="num">Desvio</th>
              </tr>
            </thead>
            <tbody>
              {anomalos.map((a, i) => {
                const acima = Number(a.escore) > 0
                const ruim = (a.kind === 'payable' && acima) || (a.kind === 'receivable' && !acima)
                return (
                  <tr key={i}>
                    <td>{rotuloMes(a.competencia)}</td>
                    <td>{a.categoria}</td>
                    <td>{a.kind === 'receivable' ? 'receita' : 'despesa'}</td>
                    <td className="num">{brl(a.valor)}</td>
                    <td className="num" style={{ color: 'var(--text-muted)' }}>{brl(a.mediana)}</td>
                    <td className="num" style={{ color: ruim ? 'var(--critical)' : 'var(--good-text)' }}>
                      {acima ? '+' : ''}{Number(a.escore).toFixed(1)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="empty">Nenhum desvio relevante nos últimos 6 meses.</p>
        )}
      </div>
    </>
  )
}
