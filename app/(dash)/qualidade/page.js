import { requireSession } from '@/lib/session'
import { mudancas, resumoMudancas, cobertura, qualidadePorMes } from '@/lib/memoria'
import { brl, dataCurta, rotuloMes } from '@/lib/format'
import Tile from '@/components/Tile'
import Exportar from '@/components/Exportar'

export const dynamic = 'force-dynamic'

// Qualidade da previsão.
//
// A tela que só existe porque guardamos uma versão de cada parcela a cada
// mudança. O ERP sabe o estado de agora: se um título de dezembro foi adiado
// três vezes, ele mostra a data atual e mais nada. Aqui fica o rastro, e o
// rastro responde a pergunta que decide crédito e contratação: dá para confiar
// na data que o sistema promete.
//
// Nada disso se recupera depois. Quem começa a guardar hoje tem a resposta em
// dois meses; quem começa em dois meses tem a resposta em quatro.

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesCurto = (iso) => {
  const [ano, mes] = String(iso).split('-')
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`
}

export default async function Qualidade() {
  const sessao = await requireSession()
  const [cob, resumo, lista, porMes] = await Promise.all([
    cobertura(sessao), resumoMudancas(sessao), mudancas(sessao, 60),
    qualidadePorMes(sessao, 'receivable'),
  ])

  const total = Number(resumo?.total ?? 0)
  const adiadas = Number(resumo?.adiadas ?? 0)
  const delta = Number(resumo?.delta_receber ?? 0)

  // O que o ERP prevê hoje para cada mês. Enquanto não há dois pontos de
  // observação, esta é a linha de base: é contra ela que outubro vai comparar.
  const base = new Map()
  for (const l of porMes) {
    base.set(l.mes, (base.get(l.mes) ?? 0) + Number(l.previsto))
  }
  const observacoes = [...new Set(porMes.map((l) => l.visto))].sort()

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Qualidade da previsão</h1>
          <p>
            O que o seu ERP previa antes, contra o que virou depois. É a memória
            que o Conta Azul não guarda.
          </p>
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Tile
          label="Guardando desde" valor={dataCurta(cob.desde)}
          nota={cob.diasDeRastro === 0 ? 'hoje' : `${cob.diasDeRastro} dias de rastro`}
        />
        <Tile
          label="Parcelas sob observação" valor={Number(cob.versoes - cob.versoes_fechadas).toLocaleString('pt-BR')}
          nota={`${Number(cob.versoes).toLocaleString('pt-BR')} versões guardadas`}
        />
        <Tile
          label="Já mudaram" valor={String(total)}
          nota={total === 0 ? 'nada se mexeu ainda' : `${adiadas} adiada(s)`}
          tom={adiadas > 0 ? 'warn' : null}
        />
        <Tile
          label="Efeito no que há a receber" valor={brl(Math.abs(delta))}
          nota={delta === 0 ? 'sem mudança de valor'
            : delta > 0 ? 'a receber subiu desde a primeira leitura'
            : 'a receber caiu desde a primeira leitura'}
          tom={delta < 0 ? 'bad' : delta > 0 ? 'good' : null}
        />
      </div>

      {!cob.comparavel && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h2>A comparação mês a mês começa no próximo mês</h2>
          <p className="sub">
            Comparar exige dois momentos. Hoje existe um: {observacoes.map(mesCurto).join(', ') || 'o de agora'}.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            A tabela abaixo é a linha de base. É o que o seu ERP prevê hoje para
            cada mês, e é contra ela que a leitura do mês que vem vai comparar. A
            partir daí a tela passa a dizer quanto do previsto se mexeu, para
            onde e por causa de quem.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 10, marginBottom: 0 }}>
            <strong>Não existe atalho para isso.</strong> Não dá para recuperar
            histórico que nunca foi gravado, e é por isso que ele começa a ser
            guardado no dia em que a empresa conecta.
          </p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>{cob.comparavel ? 'Previsto contra realizado, por mês' : 'Linha de base do que a receber'}</h2>
        <p className="sub">
          {cob.comparavel
            ? 'Cada coluna é o que se esperava daquele mês, visto de um momento diferente.'
            : 'O que o ERP prevê hoje para cada mês de vencimento.'}
        </p>
        <table>
          <thead>
            <tr>
              <th>Mês de vencimento</th>
              {observacoes.map((o) => (
                <th className="num" key={o}>visto em {mesCurto(o)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...base.keys()].sort().map((mes) => (
              <tr key={mes}>
                <td>{rotuloMes(mes)}</td>
                {observacoes.map((o) => {
                  const linha = porMes.find((l) => l.mes === mes && l.visto === o)
                  return (
                    <td className="num" key={o}>
                      {linha ? brl(linha.previsto) : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
          <div>
            <h2>O que mudou desde a primeira leitura</h2>
            <p className="sub">
              Cada linha é uma parcela que não está mais como estava quando a
              vimos pela primeira vez. Data, valor, quanto já foi pago ou
              situação.
            </p>
          </div>
          <Exportar
            linhas={lista} arquivo="mudancas-de-previsao"
            colunas={[
              ['pessoa', 'Cliente ou fornecedor', 'texto'],
              ['descricao', 'Descrição', 'texto'],
              ['kind', 'Tipo', 'texto'],
              ['vencimento_antes', 'Vencimento antes', 'data'],
              ['vencimento_agora', 'Vencimento agora', 'data'],
              ['dias_deslocados', 'Dias deslocados', 'inteiro'],
              ['valor_antes', 'Valor antes', 'dinheiro'],
              ['valor_agora', 'Valor agora', 'dinheiro'],
              ['pago_antes', 'Pago antes', 'dinheiro'],
              ['pago_agora', 'Pago agora', 'dinheiro'],
              ['status_antes', 'Situação antes', 'texto'],
              ['status_agora', 'Situação agora', 'texto'],
            ]}
          />
        </div>

        {lista.length === 0 ? (
          <p className="empty" style={{ marginTop: 6 }}>
            Nada mudou desde que começamos a olhar. A lista se enche sozinha
            conforme o ERP for mexido.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Quem</th>
                <th>Vencimento</th>
                <th className="num">Valor</th>
                <th>O que mudou</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((m, i) => {
                const dias = Number(m.dias_deslocados ?? 0)
                const dv = Number(m.delta_valor ?? 0)
                const dp = Number(m.pago_agora ?? 0) - Number(m.pago_antes ?? 0)
                return (
                  <tr key={i}>
                    <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.pessoa}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {m.kind === 'receivable' ? 'a receber' : 'a pagar'}
                      </div>
                    </td>
                    <td>
                      {dias
                        ? <>{dataCurta(m.vencimento_antes)} → <strong>{dataCurta(m.vencimento_agora)}</strong></>
                        : dataCurta(m.vencimento_agora)}
                    </td>
                    <td className="num">
                      {dv
                        ? <>{brl(m.valor_antes)} → <strong>{brl(m.valor_agora)}</strong></>
                        : brl(m.valor_agora)}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {dias !== 0 && (
                        <span style={{ color: dias > 0 ? 'var(--critical)' : 'var(--good-text)' }}>
                          {dias > 0 ? `adiou ${dias} dias` : `antecipou ${-dias} dias`}
                        </span>
                      )}
                      {dv !== 0 && (
                        <span style={{ color: dv < 0 ? 'var(--critical)' : 'var(--good-text)', marginLeft: dias ? 8 : 0 }}>
                          {dv > 0 ? '+' : ''}{brl(dv)} no valor
                        </span>
                      )}
                      {dp !== 0 && (
                        <span style={{ color: 'var(--good-text)', marginLeft: (dias || dv) ? 8 : 0 }}>
                          {brl(dp)} pago
                        </span>
                      )}
                      {m.status_antes !== m.status_agora && (
                        <span style={{ color: 'var(--text-muted)', marginLeft: (dias || dv || dp) ? 8 : 0 }}>
                          {String(m.status_antes).toLowerCase().replaceAll('_', ' ')} → {String(m.status_agora).toLowerCase().replaceAll('_', ' ')}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
