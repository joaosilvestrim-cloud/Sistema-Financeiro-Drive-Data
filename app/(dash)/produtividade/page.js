import { requireSession } from '@/lib/session'
import { porColaborador, porHora, tiposPreenchidos } from '@/lib/indicadoresAux'
import { brl, rotuloMes } from '@/lib/format'
import Tile from '@/components/Tile'
import LinhaKpi from '@/components/charts/LinhaKpi'
import FaltaSerie from '@/components/FaltaSerie'

export const dynamic = 'force-dynamic'

// Produtividade.
//
// Receita bruta cresce quando se contrata. A pergunta que importa é se ela
// cresce mais rápido que o time, e é isso que estes indicadores respondem.

const pctTexto = (v) => v === null || v === undefined
  ? '—'
  : `${(Number(v) * 100).toFixed(1).replace('.', ',')}%`

function leituraUtilizacao(v) {
  if (v === null || v === undefined) return ['—', null]
  if (v < 0.6) return ['ociosidade', 'bad']
  if (v > 0.85) return ['time no limite', 'bad']
  return ['faixa saudável', 'good']
}

export default async function Produtividade() {
  const sessao = await requireSession()
  const [pessoas, horas, tipos] = await Promise.all([
    porColaborador(sessao, 24), porHora(sessao, 24), tiposPreenchidos(sessao),
  ])

  const ultimo = pessoas.at(-1)
  const ultimoH = horas.at(-1)
  const comUtilizacao = horas.filter((h) => h.utilizacao != null)
  const [leitura, tomUtil] = leituraUtilizacao(ultimoH?.utilizacao)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Produtividade</h1>
          <p>
            Receita cresce quando se contrata. O que importa é se ela cresce mais rápido que o time.
          </p>
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        {ultimo && (
          <>
            <Tile label="Receita por pessoa" valor={brl(ultimo.receita_por_pessoa)}
                  nota={`${rotuloMes(ultimo.competencia)} · ${Number(ultimo.pessoas)} pessoas`} />
            <Tile label="Custo por pessoa" valor={brl(ultimo.custo_por_pessoa)}
                  nota={`resultado de ${brl(ultimo.resultado_por_pessoa)} por pessoa`}
                  tom={Number(ultimo.resultado_por_pessoa) >= 0 ? 'good' : 'bad'} />
          </>
        )}
        {ultimoH?.receita_por_hora != null && (
          <Tile label="Receita por hora faturável" valor={brl(ultimoH.receita_por_hora)}
                nota={`${Number(ultimoH.faturaveis).toLocaleString('pt-BR')} horas em ${rotuloMes(ultimoH.competencia)}`} />
        )}
        {ultimoH?.utilizacao != null && (
          <Tile label="Taxa de utilização" valor={pctTexto(ultimoH.utilizacao)}
                nota={leitura} tom={tomUtil} />
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Por colaborador</h2>
        <p className="sub">
          Receita e custo divididos pelo número de pessoas do mês. A distância entre as duas linhas
          é o que cada pessoa deixa.
        </p>
        {tipos.has('headcount') && pessoas.length >= 2 ? (
          <LinhaKpi
            dados={pessoas}
            series={[
              { chave: 'receita_por_pessoa', rotulo: 'Receita por pessoa', cor: 'var(--series-1)' },
              { chave: 'custo_por_pessoa', rotulo: 'Custo por pessoa', cor: 'var(--series-2)' },
            ]}
            titulo="Receita e custo por pessoa"
          />
        ) : (
          <FaltaSerie
            titulo="Sem número de pessoas"
            serie="Número de pessoas"
            oQueMostra="receita, custo e resultado por colaborador mês a mês"
            exemplo="Basta o total de pessoas no fim de cada mês, contando sócios e terceiros fixos se eles entram no custo."
          />
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Receita por hora faturável</h2>
        <p className="sub">
          Quanto cada hora vendida rende. Subir aqui sem subir a receita significa que o time está
          entregando o mesmo com menos hora.
        </p>
        {tipos.has('horas_faturaveis') && horas.filter((h) => h.receita_por_hora != null).length >= 2 ? (
          <LinhaKpi
            dados={horas.filter((h) => h.receita_por_hora != null)}
            series={[{ chave: 'receita_por_hora', rotulo: 'Receita por hora', cor: 'var(--series-1)' }]}
            titulo="Receita por hora faturável"
          />
        ) : (
          <FaltaSerie
            titulo="Sem horas faturáveis"
            serie="Horas faturáveis"
            oQueMostra="quanto cada hora vendida rende, mês a mês"
            exemplo="O total de horas apontadas em projeto de cliente no mês."
          />
        )}
      </div>

      <div className="card">
        <h2>Taxa de utilização</h2>
        <p className="sub">
          Horas faturáveis sobre horas disponíveis. Abaixo de 60% costuma ser ociosidade, acima de
          85% costuma ser time no limite, com risco de atraso e de perder gente.
        </p>
        {tipos.has('horas_faturaveis') && tipos.has('horas_disponiveis') && comUtilizacao.length >= 2 ? (
          <LinhaKpi
            dados={comUtilizacao}
            formato="percentual"
            series={[{ chave: 'utilizacao', rotulo: 'Utilização', cor: 'var(--series-3)' }]}
            referencias={[
              { valor: 0.6, rotulo: 'ociosidade abaixo daqui' },
              { valor: 0.85, rotulo: 'limite acima daqui' },
            ]}
            titulo="Taxa de utilização"
          />
        ) : (
          <FaltaSerie
            titulo="Sem as duas séries de horas"
            serie="Horas faturáveis e Horas disponíveis"
            oQueMostra="a taxa de utilização do time, com as faixas de ociosidade e de limite"
            exemplo="Disponíveis é a capacidade do mês: pessoas vezes horas úteis, descontando férias e feriados."
          />
        )}
      </div>
    </>
  )
}
