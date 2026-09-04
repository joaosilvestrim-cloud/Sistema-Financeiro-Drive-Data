import { requireSession } from '@/lib/session'
import { projecao } from '@/lib/forecast'
import { pipelineFuturo, tiposPreenchidos } from '@/lib/indicadoresAux'
import { brl, pct, rotuloMes } from '@/lib/format'
import ForecastChart from '@/components/charts/ForecastChart'
import FaltaSerie from '@/components/FaltaSerie'

export const dynamic = 'force-dynamic'

export default async function Previsao() {
  const sessao = await requireSession()
  const [base, pipeline, tipos] = await Promise.all([
    projecao(sessao, 6), pipelineFuturo(sessao), tiposPreenchidos(sessao),
  ])

  if (!base.linhas.length) {
    return (
      <>
        <div className="page-head"><div><h1>Previsão</h1></div></div>
        <p className="empty">Sem histórico suficiente para projetar.</p>
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Previsão de caixa</h1>
          <p>Seis meses à frente, partindo do saldo de {brl(base.saldoInicial)}. Mexa nos cenários para testar hipóteses.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <ForecastChart base={base} />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Pipeline contra o que a projeção espera</h2>
        <p className="sub">
          A projeção estima novos negócios pela média histórica. O pipeline diz o que está de fato
          em negociação. Quando o pipeline fica bem abaixo, a projeção conta com receita que
          ninguém está vendendo.
        </p>
        {tipos.has('pipeline') ? (
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th className="num">Projeção espera</th>
                <th className="num">Pipeline informado</th>
                <th className="num">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {base.linhas.map((l) => {
                const esperado = l.novosEntradas
                const informado = Number(pipeline.find((p) => p.competencia === l.competencia)?.pipeline ?? 0)
                const dif = informado - esperado
                // Só cobra quando a projeção espera algo relevante daquele mês.
                const relevante = esperado > 0
                return (
                  <tr key={l.competencia}>
                    <td>{rotuloMes(l.competencia)}</td>
                    <td className="num">{brl(esperado)}</td>
                    <td className="num">{informado > 0 ? brl(informado) : '—'}</td>
                    <td className="num" style={{
                      color: !relevante ? undefined : dif >= 0 ? 'var(--good-text)' : 'var(--critical)',
                    }}>
                      {relevante ? brl(dif) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <FaltaSerie
            titulo="Sem pipeline informado"
            serie="Pipeline comercial"
            oQueMostra="mês a mês, quanto a projeção espera de negócio novo contra quanto está em negociação"
            exemplo="Use o valor ponderado pela probabilidade de fechar, e não o total bruto do funil."
          />
        )}
      </div>

      <div className="card">
        <h2>Como esse número é montado</h2>
        <p className="sub">Sem isso a projeção vira chute com aparência de precisão.</p>
        <table>
          <tbody>
            <tr>
              <td>Carteira</td>
              <td style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                Títulos já lançados no ERP com vencimento no mês.
              </td>
            </tr>
            <tr>
              <td>Taxa de recebimento</td>
              <td style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                {pct(base.taxaNoPrazo)} do que vence costuma entrar até 30 dias depois, medido nesta empresa.
                A projeção aplica esse desconto sobre o que está a receber.
              </td>
            </tr>
            <tr>
              <td>Novos negócios</td>
              <td style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                Média dos últimos 12 meses ({brl(base.mediaReceita)} de receita e {brl(base.mediaDespesa)} de despesa
                por mês), ajustada pelo índice sazonal e subtraindo o que já está lançado.
              </td>
            </tr>
            <tr>
              <td>Prazo até o caixa</td>
              <td style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                {base.prazoReceber} dias para receber e {base.prazoPagar} dias para pagar, contados da competência.
                Novos negócios entram deslocados por isso.
              </td>
            </tr>
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
          A projeção não conhece contrato assinado que ainda não virou lançamento, nem despesa nova fora do padrão
          histórico. Quanto mais longe o mês, menos confiável o número.
          Como guardamos o histórico versionado de cada parcela, depois de alguns meses de sincronização dá para
          medir a própria acurácia e mostrar o quanto essa previsão costuma errar.
        </p>
      </div>
    </>
  )
}
