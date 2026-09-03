import 'server-only'
import { q, q1 } from './db'
import { escopo } from './session'

// Projeção de caixa.
//
// O método, em três partes, para que ninguém precise adivinhar de onde saiu o
// número:
//
// 1. Carteira. O que já está lançado no ERP com vencimento no mês. É o pedaço
//    mais confiável. Recebimento é descontado pela taxa histórica de quanto de
//    fato entra até 30 dias do vencimento, medida na própria empresa.
// 2. Novos negócios. O que ainda não foi lançado. Sai da média dos últimos 12
//    meses de competência, ajustada pelo índice sazonal daquele mês do ano, e
//    subtraindo o que já está lançado para não contar duas vezes.
// 3. Deslocamento. Competência não é caixa. A parte de novos negócios entra
//    deslocada pelo prazo médio de recebimento e de pagamento observados.
//
// Despesa não leva desconto de recuperação. Conta a pagar costuma ser paga.

const MESES_BASE = 12

export async function projecao(sessao, horizonte = 6) {
  const { where, params } = escopo(sessao)

  const [saldo, carteira, historico, sazonal, prazos, lancadoFuturo, taxa, maiorCliente] = await Promise.all([
    q1(`select sum(saldo_atual) as saldo from mart.kpi_overview where ${where}`, params),

    q(`select to_char(dia, 'YYYY-MM') as competencia,
              sum(coalesce(entradas_previstas, 0)) as entradas,
              sum(coalesce(saidas_previstas, 0))   as saidas
         from mart.cashflow_daily
        where ${where} and dia >= current_date
        group by 1 order by 1`, params),

    q(`select kind, avg(competencia) as media
         from mart.monthly_series
        where ${where}
          and mes < date_trunc('month', current_date)
          and mes >= date_trunc('month', current_date) - make_interval(months => ${MESES_BASE})
        group by 1`, params),

    q(`select kind, mes_do_ano, avg(indice) as indice, max(anos) as anos
         from mart.indice_sazonal where ${where} group by 1, 2`, params),

    q(`select kind, round(avg(prazo_medio_dias), 0) as prazo
         from mart.prazos_mensais
        where ${where} and mes >= date_trunc('month', current_date) - interval '12 months'
        group by 1`, params),

    q(`select kind, to_char(mes, 'YYYY-MM') as competencia, sum(competencia) as total
         from mart.monthly_series
        where ${where} and mes >= date_trunc('month', current_date)
        group by 1, 2`, params),

    q1(`select round(sum(recebido) / nullif(sum(total), 0), 4) as taxa
          from mart.taxa_no_prazo where ${where}`, params),

    q1(`select max(participacao) as participacao from mart.concentracao_clientes where ${where}`, params),
  ])

  const mediaReceita = Number(historico.find((h) => h.kind === 'receivable')?.media ?? 0)
  const mediaDespesa = Number(historico.find((h) => h.kind === 'payable')?.media ?? 0)
  const taxaNoPrazo = Number(taxa?.taxa ?? 0) || 0.9

  const prazoReceber = Number(prazos.find((p) => p.kind === 'receivable')?.prazo ?? 30)
  const prazoPagar = Number(prazos.find((p) => p.kind === 'payable')?.prazo ?? 30)
  const deslocEnt = Math.max(0, Math.round(prazoReceber / 30))
  const deslocSai = Math.max(0, Math.round(prazoPagar / 30))

  const sazonalDe = (kind, mesDoAno) => {
    const linha = sazonal.find((s) => s.kind === kind && s.mes_do_ano === mesDoAno)
    // Menos de dois anos de histórico não sustenta ajuste sazonal. Fica neutro.
    if (!linha || Number(linha.anos) < 2) return 1
    return Number(linha.indice) || 1
  }

  const chave = (d) => d.toISOString().slice(0, 7)
  const hoje = new Date()
  const mesRef = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1))

  const carteiraPor = Object.fromEntries(carteira.map((c) => [c.competencia, c]))
  const lancadoPor = {}
  for (const l of lancadoFuturo) lancadoPor[`${l.kind}|${l.competencia}`] = Number(l.total)

  // Novos negócios por competência, antes do deslocamento para caixa.
  const novosCompetencia = []
  for (let i = 0; i < horizonte + Math.max(deslocEnt, deslocSai); i++) {
    const d = new Date(Date.UTC(mesRef.getUTCFullYear(), mesRef.getUTCMonth() + i, 1))
    const comp = chave(d)
    const mesDoAno = d.getUTCMonth() + 1
    const esperadoRec = mediaReceita * sazonalDe('receivable', mesDoAno)
    const esperadoDes = mediaDespesa * sazonalDe('payable', mesDoAno)
    novosCompetencia.push({
      competencia: comp,
      receita: Math.max(0, esperadoRec - (lancadoPor[`receivable|${comp}`] ?? 0)),
      despesa: Math.max(0, esperadoDes - (lancadoPor[`payable|${comp}`] ?? 0)),
    })
  }
  const novosPor = Object.fromEntries(novosCompetencia.map((n) => [n.competencia, n]))
  const compDeslocada = (comp, meses) => {
    const [ano, mes] = comp.split('-').map(Number)
    return chave(new Date(Date.UTC(ano, mes - 1 - meses, 1)))
  }

  const linhas = []
  for (let i = 0; i < horizonte; i++) {
    const d = new Date(Date.UTC(mesRef.getUTCFullYear(), mesRef.getUTCMonth() + i, 1))
    const comp = chave(d)
    const c = carteiraPor[comp]
    linhas.push({
      competencia: comp,
      carteiraEntradas: Number(c?.entradas ?? 0),
      carteiraSaidas: Number(c?.saidas ?? 0),
      novosEntradas: novosPor[compDeslocada(comp, deslocEnt)]?.receita ?? 0,
      novosSaidas: novosPor[compDeslocada(comp, deslocSai)]?.despesa ?? 0,
    })
  }

  return {
    saldoInicial: Number(saldo?.saldo ?? 0),
    taxaNoPrazo,
    prazoReceber,
    prazoPagar,
    deslocEnt,
    deslocSai,
    mediaReceita,
    mediaDespesa,
    participacaoMaiorCliente: Number(maiorCliente?.participacao ?? 0),
    linhas,
  }
}
