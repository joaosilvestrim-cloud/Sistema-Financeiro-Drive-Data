import { requireSession } from '@/lib/session'
import { projecao } from '@/lib/forecast'
import { brl, pct } from '@/lib/format'
import ForecastChart from '@/components/charts/ForecastChart'

export const dynamic = 'force-dynamic'

export default async function Previsao() {
  const sessao = await requireSession()
  const base = await projecao(sessao, 6)

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
