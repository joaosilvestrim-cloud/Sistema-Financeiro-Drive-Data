import { Suspense } from 'react'
import { requireSession } from '@/lib/session'
import { conciliacao, agingDuplo, duasSemanas, dezMaiores } from '@/lib/executivo'
import { brl, dataCurta } from '@/lib/format'
import Tile from '@/components/Tile'
import BulletIA from '@/components/BulletIA'
import DuasSemanas from '@/components/charts/DuasSemanas'

export const dynamic = 'force-dynamic'

// Resumo executivo.
//
// A ordem das seções não é estética, é a ordem em que um gestor financeiro
// decide, do jeito que o Diogo descreveu: primeiro se dá para confiar no
// número, depois o que está atrasado dos dois lados, depois o caixa desta
// semana e da próxima, e por último com quem.
//
// A visão geral continua existindo, com o mês e o ano. Esta tela é a de entrada
// porque a ação de quem opera é de duas semanas, não de dois meses.

const FAIXA = {
  a_vencer: 'A vencer', d1_30: '1 a 30', d31_60: '31 a 60',
  d61_90: '61 a 90', d90_mais: '+90',
}
const ORDEM = ['a_vencer', 'd1_30', 'd31_60', 'd61_90', 'd90_mais']

const FAIXA_CONC = {
  ate_7: 'até 7 dias', d8_15: '8 a 15 dias', d16_30: '16 a 30 dias', mais_30: 'mais de 30 dias',
}

const soma = (linhas, filtro = () => true) =>
  linhas.filter(filtro).reduce((a, l) => a + Number(l.valor ?? 0), 0)

export default async function Resumo() {
  const sessao = await requireSession()
  const [conc, aging, semanas, clientes, fornecedores] = await Promise.all([
    conciliacao(sessao), agingDuplo(sessao), duasSemanas(sessao),
    dezMaiores(sessao, 'receivable'), dezMaiores(sessao, 'payable'),
  ])

  const empresa = sessao.connectionId
    ? sessao.conexoes.find((c) => c.id === sessao.connectionId)?.nome
    : 'Todas as empresas'

  const vencidoReceber = soma(aging.receber, (l) => l.faixa !== 'a_vencer')
  const vencidoPagar = soma(aging.pagar, (l) => l.faixa !== 'a_vencer')
  const pendentes = Number(conc.pendentes ?? 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Resumo executivo</h1>
          <p>{empresa} · o que exige decisão nesta semana e na próxima</p>
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Tile
          label="Conciliação bancária"
          valor={pendentes === 0 ? 'Em dia' : `${pendentes} pendentes`}
          nota={pendentes === 0
            ? 'tudo casado com o extrato'
            : `${brl(conc.valor_pendente)} sem conferir`}
          tom={pendentes === 0 ? 'good' : conc.diasDaMaisAntiga > 30 ? 'bad' : 'warn'}
        />
        <Tile
          label="Vencido a receber" valor={brl(vencidoReceber)}
          nota={vencidoReceber > 0 ? 'já passou do vencimento' : 'nada vencido'}
          tom={vencidoReceber > 0 ? 'bad' : 'good'}
          insight={<Suspense fallback={null}><BulletIA sessao={sessao} chave="vencido" /></Suspense>}
        />
        <Tile
          label="Vencido a pagar" valor={brl(vencidoPagar)}
          nota={vencidoPagar > 0 ? 'atraso com fornecedor' : 'nada em atraso'}
          tom={vencidoPagar > 0 ? 'bad' : 'good'}
        />
        <Tile
          label="Menor saldo em 14 dias" valor={brl(semanas.menor.saldo)}
          nota={semanas.diaNegativo
            ? `fica negativo em ${dataCurta(semanas.diaNegativo.dia)}`
            : `no dia ${dataCurta(semanas.menor.dia)}`}
          tom={semanas.diaNegativo ? 'bad' : null}
          insight={<Suspense fallback={null}><BulletIA sessao={sessao} chave="curva_saldo" /></Suspense>}
        />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Dá para confiar no saldo?</h2>
        <p className="sub">
          Enquanto um pagamento não é casado com o extrato do banco, ele é um
          lançamento, não um fato. O Conta Azul não mostra o envelhecimento
          disso.
        </p>

        {pendentes === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--good)', margin: 0 }}>
            Tudo conciliado. O saldo da tela é o saldo do banco.
          </p>
        ) : (
          <>
            <div className="grid cols-3" style={{ gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Conciliado até</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>
                  {dataCurta(conc.ultima_conciliacao)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {conc.diasDesdeUltima === 0 ? 'hoje' : `há ${conc.diasDesdeUltima} dias`}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Parado sem conferir</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>{brl(conc.valor_pendente)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {pendentes} lançamento{pendentes === 1 ? '' : 's'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Base conciliada</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>{conc.percentualConciliado}%</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  o mais antigo tem {conc.diasDaMaisAntiga} dias
                </div>
              </div>
            </div>

            <table>
              <thead>
                <tr><th>Parado há</th><th className="num">Lançamentos</th><th className="num">Valor</th></tr>
              </thead>
              <tbody>
                {['ate_7', 'd8_15', 'd16_30', 'mais_30'].map((f) => {
                  const linha = conc.faixas.find((x) => x.faixa === f)
                  if (!linha) return null
                  return (
                    <tr key={f}>
                      <td>{FAIXA_CONC[f]}</td>
                      <td className="num">{linha.titulos}</td>
                      <td className="num">{brl(linha.valor)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="grid cols-2" style={{ marginBottom: 14 }}>
        {[['A receber', aging.receber], ['A pagar', aging.pagar]].map(([titulo, linhas]) => (
          <div className="card" key={titulo}>
            <h2>{titulo}</h2>
            <p className="sub">Por tempo de atraso, em aberto hoje.</p>
            <table>
              <thead>
                <tr><th>Faixa</th><th className="num">Títulos</th><th className="num">Valor</th></tr>
              </thead>
              <tbody>
                {ORDEM.map((f) => {
                  const l = linhas.find((x) => x.faixa === f)
                  if (!l) return null
                  return (
                    <tr key={f} style={f !== 'a_vencer' ? { color: 'var(--critical)' } : undefined}>
                      <td>{FAIXA[f]}</td>
                      <td className="num">{l.titulos}</td>
                      <td className="num">{brl(l.valor)}</td>
                    </tr>
                  )
                })}
                <tr style={{ fontWeight: 600 }}>
                  <td>Total</td>
                  <td className="num">{linhas.reduce((a, l) => a + Number(l.titulos), 0)}</td>
                  <td className="num">{brl(soma(linhas))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Esta semana e a próxima</h2>
        <p className="sub">
          Onde a decisão acontece. A linha é o saldo correndo dia a dia, partindo
          dos {brl(semanas.saldoHoje)} de hoje.
        </p>
        <DuasSemanas dados={semanas.serie} />
      </div>

      <div className="grid cols-2">
        {[['10 maiores clientes', clientes, 'a receber'],
          ['10 maiores fornecedores', fornecedores, 'a pagar']].map(([titulo, lista, lado]) => (
          <div className="card" key={titulo}>
            <h2>{titulo}</h2>
            <p className="sub">Pelo que está {lado} em aberto agora.</p>
            <table>
              <thead>
                <tr><th>Nome</th><th className="num">Em aberto</th><th className="num">Vencido</th></tr>
              </thead>
              <tbody>
                {lista.map((x, i) => (
                  <tr key={i}>
                    <td style={{ maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {x.nome}
                    </td>
                    <td className="num">{brl(x.em_aberto)}</td>
                    <td className="num" style={Number(x.vencido) > 0 ? { color: 'var(--critical)' } : undefined}>
                      {Number(x.vencido) > 0 ? brl(x.vencido) : '—'}
                    </td>
                  </tr>
                ))}
                {lista.length === 0 && (
                  <tr><td colSpan="3" style={{ color: 'var(--text-muted)' }}>Nada em aberto.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  )
}
