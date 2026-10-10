import 'server-only'
import { q, q1 } from './db.js'
import { escopo } from './escopo.js'
import { projecao } from './forecast.js'

// Base do simulador de caixa.
//
// Pedido do João em 09/10: a previsão "tem muito pouca função, não dá nem pra
// selecionar simulações por banco". A base é a mesma projeção validada da
// empresa (carteira descontada pela taxa de recebimento, negócio novo pela
// mediana recente, sazonalidade sem tendência). O que muda aqui:
//
// - os vencidos em aberto entram no primeiro mês, como no fluxo de caixa, e
//   viram uma alavanca própria (quanto deles a pessoa acha que entra);
// - com contas escolhidas, saldo e agenda passam a ser os dessas contas, e o
//   negócio novo, que não tem conta, é repartido pela fatia que essas contas
//   tiveram nas baixas reais dos últimos seis meses. A fatia vai para a tela,
//   porque é uma premissa nossa e quem simula precisa saber que ela existe.

export async function baseSimulacao(sessao, { meses = 12, contas = [] } = {}) {
  const base = await projecao(sessao, meses)
  const { where, params } = escopo(sessao, 'i')
  const n = params.length
  const porConta = contas.length > 0
  const filtroConta = porConta ? `and i.account_id = any($${n + 1}::uuid[])` : ''
  const p = porConta ? [...params, contas] : params

  const vencidos = await q1(
    `select coalesce(sum(i.nao_pago) filter (where i.kind = 'receivable'), 0) as entradas,
            coalesce(sum(i.nao_pago) filter (where i.kind = 'payable'), 0)    as saidas
       from core.installment i
      where ${where} and i.deleted_at is null and coalesce(i.nao_pago, 0) > 0.009
        and i.data_vencimento < current_date ${filtroConta}`, p)

  let info = null
  if (porConta) {
    const { where: wB, params: pB } = escopo(sessao, 'b')
    const { where: wS, params: pS } = escopo(sessao, 's')
    const [agenda, saldos, fatia, semConta] = await Promise.all([
      q(`select to_char(date_trunc('month', i.data_vencimento), 'YYYY-MM') as competencia,
                coalesce(sum(i.nao_pago) filter (where i.kind = 'receivable'), 0) as entradas,
                coalesce(sum(i.nao_pago) filter (where i.kind = 'payable'), 0)    as saidas
           from core.installment i
          where ${where} and i.deleted_at is null and coalesce(i.nao_pago, 0) > 0.009
            and i.data_vencimento >= current_date ${filtroConta}
          group by 1`, p),
      q(`select distinct on (b.account_id) a.nome, b.saldo
           from core.account_balance_snapshot b join core.account a on a.id = b.account_id
          where ${wB} and b.account_id = any($${pB.length + 1}::uuid[])
          order by b.account_id, b.snapshot_date desc`, [...pB, contas]),
      q1(`select
            coalesce(sum(s.valor) filter (where i.kind = 'receivable' and s.account_id = any($${pS.length + 1}::uuid[])), 0)
              / nullif(sum(s.valor) filter (where i.kind = 'receivable'), 0) as entradas,
            coalesce(sum(s.valor) filter (where i.kind = 'payable' and s.account_id = any($${pS.length + 1}::uuid[])), 0)
              / nullif(sum(s.valor) filter (where i.kind = 'payable'), 0) as saidas
           from core.settlement s join core.installment i on i.id = s.installment_id
          where ${wS} and i.deleted_at is null and s.data_pagamento >= current_date - interval '6 months'`, [...pS, contas]),
      q1(`select count(*)::int as titulos, coalesce(sum(i.nao_pago), 0) as valor
            from core.installment i
           where ${where} and i.deleted_at is null and coalesce(i.nao_pago, 0) > 0.009
             and i.account_id is null`, params),
    ])

    const fatiaEnt = Number(fatia?.entradas ?? 0)
    const fatiaSai = Number(fatia?.saidas ?? 0)
    const porMes = Object.fromEntries(agenda.map((r) => [r.competencia, r]))
    base.saldoInicial = saldos.reduce((a, c) => a + Number(c.saldo ?? 0), 0)
    base.linhas = base.linhas.map((l) => ({
      ...l,
      carteiraEntradas: Number(porMes[l.competencia]?.entradas ?? 0),
      carteiraSaidas: Number(porMes[l.competencia]?.saidas ?? 0),
      novosEntradas: l.novosEntradas * fatiaEnt,
      novosSaidas: l.novosSaidas * fatiaSai,
    }))
    info = {
      nomes: saldos.map((s) => s.nome),
      fatiaEntradas: fatiaEnt,
      fatiaSaidas: fatiaSai,
      semConta,
    }
  }

  base.vencidosEntradas = Number(vencidos?.entradas ?? 0)
  base.vencidosSaidas = Number(vencidos?.saidas ?? 0)
  base.contas = info
  return base
}
