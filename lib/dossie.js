import 'server-only'
import { q, q1 } from './db.js'
import { escopo } from './escopo.js'
import { fluxoDeCaixa } from './cashflow.js'

// O dossiê que vai para a IA.
//
// Todo número sai daqui já formatado em texto. O modelo não recebe número solto
// e não é convidado a fazer conta: ele copia o que está escrito. É a diferença
// entre uma análise que sustenta decisão e um texto que soa certo e erra o
// valor.
//
// O dossiê também é guardado junto com a análise, então dá para responder "de
// onde saiu isso" meses depois.

const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
})
const pct = (v) => v === null || v === undefined
  ? null
  : `${(Number(v) * 100).toFixed(1).replace('.', ',')}%`
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const mesPorExtenso = (comp) => {
  if (!comp) return null
  const [ano, mes] = comp.split('-')
  return `${MESES[Number(mes) - 1]} de ${ano}`
}

export async function montarDossie(sessao, competencia = null) {
  const { where, params } = escopo(sessao)
  const escopoB = escopo(sessao, 'b')

  // Por padrão o último mês fechado. Mês em curso não se compara com mês
  // inteiro, e pedir análise dele produziria alarme falso todo dia 2.
  const alvo = competencia ?? (await q1(
    `select to_char(max(mes), 'YYYY-MM') as m from mart.resultado_mensal
      where ${where} and mes < date_trunc('month', current_date)`, params,
  ))?.m

  if (!alvo) return null

  const [kpis, meses, aging, clientes, categorias, desvios, prazos, cobertura, hhi, fluxo,
         sazonal, caixaMensal, contas] = await Promise.all([
    q1(`select sum(saldo_atual) saldo, sum(a_receber) a_receber, sum(a_pagar) a_pagar,
               sum(receber_vencido) receber_vencido, sum(pagar_vencido) pagar_vencido,
               sum(receber_30d) receber_30d, sum(pagar_30d) pagar_30d
          from mart.kpi_overview where ${where}`, params),

    q(`select to_char(mes, 'YYYY-MM') competencia, receita, despesa, resultado, margem, var_mes, var_ano
         from mart.resultado_mensal
        where ${where} and mes < date_trunc('month', current_date)
        order by mes desc limit 13`, params),

    q(`select faixa, sum(valor) valor, sum(titulos)::int titulos
         from mart.aging_snapshot where ${where} and kind = 'receivable'
        group by 1`, params),

    q(`select cliente, sum(faturado) faturado, sum(vencido) vencido,
              round(sum(faturado) / nullif(sum(sum(faturado)) over (), 0), 4) participacao
         from mart.customer_metrics where ${where}
        group by 1 having sum(faturado) > 0 order by 2 desc limit 5`, params),

    q(`select categoria, kind, sum(total) total
         from mart.dre_monthly where ${where} and competencia = $${params.length + 1}
        group by 1, 2 order by 3 desc limit 8`, [...params, alvo]),

    q(`select categoria, kind, to_char(mes, 'YYYY-MM') competencia, valor, mediana, escore
         from mart.anomalias
        where ${where} and escore is not null and abs(escore) >= 3.5
          and mes >= date_trunc('month', current_date) - interval '3 months'
          and mes < date_trunc('month', current_date)
        order by abs(escore) desc limit 5`, params),

    q(`select kind, round(sum(valor * prazo_medio_dias) / nullif(sum(valor), 0), 0) prazo
         from mart.prazos_mensais
        where ${where} and mes >= date_trunc('month', current_date) - interval '12 months'
        group by 1`, params),

    q1(`select meses_de_cobertura, despesa_mensal from mart.cobertura_caixa where ${where} limit 1`, params),

    // O HHI e a projecao entram porque a tela mostra os dois como indicador. Na
    // primeira versao eles ficavam de fora e a IA respondia, corretamente, "sem
    // base para interpretar" nos quatro cartoes correspondentes. Pedir leitura
    // de um numero sem entregar o numero e erro de quem monta o dossie.
    q1(`with base as (
          select cliente, sum(faturado) f from mart.customer_metrics
           where ${where} and faturado > 0 group by 1
        ), total as (select sum(f) t from base)
        select round(sum(power(b.f / nullif(t.t, 0), 2))::numeric, 4) hhi, count(*)::int clientes
          from base b cross join total t`, params),

    fluxoDeCaixa(sessao, { mesesAtras: 0, mesesFrente: 6 }).catch(() => null),

    // Os blocos abaixo existem porque cada cartao da tela precisa de leitura, e
    // a IA so consegue interpretar o que recebe. Cartao sem dado no dossie
    // devolve "sem base para interpretar", que e honesto e inutil.
    q(`select mes_do_ano, round(avg(indice), 2) indice, max(anos)::int anos
         from mart.indice_sazonal where ${where} and kind = 'receivable'
        group by 1 order by 1`, params),

    q(`select to_char(date_trunc('month', dia), 'YYYY-MM') mes,
              sum(entradas) entradas, sum(saidas) saidas
         from mart.cashflow_realized_daily
        where ${where} and dia >= date_trunc('month', current_date) - interval '12 months'
          and dia < date_trunc('month', current_date)
        group by 1 order by 1`, params),

    q(`select distinct on (b.account_id) a.nome, a.tipo, b.saldo
         from core.account_balance_snapshot b join core.account a on a.id = b.account_id
        where ${escopoB.where}
        order by b.account_id, b.snapshot_date desc`, escopoB.params),
  ])

  // Variacao entre dois valores que podem ser negativos. De prejuizo para lucro
  // o percentual nao significa nada, entao a frase diz a virada em vez de um
  // numero sem sentido.
  const variacao = (atual, base) => {
    if (atual === null || atual === undefined || base === null || base === undefined) return null
    const a = Number(atual), b = Number(base)
    if (b === 0) return null
    if (b < 0 && a >= 0) return 'saiu de prejuizo para lucro'
    if (b > 0 && a < 0) return 'saiu de lucro para prejuizo'
    return pct(a / b - 1)
  }

  const doMes = meses.find((m) => m.competencia === alvo)
  const anterior = meses[meses.indexOf(doMes) + 1]
  const mesmoMesAnoPassado = meses.find((m) => {
    const [a, mm] = alvo.split('-')
    return m.competencia === `${Number(a) - 1}-${mm}`
  })

  const previstos = fluxo && fluxo.meses
    .filter((m) => m.tipo !== 'realizado')
    .reduce((acc, m) => ({
      entradas: acc.entradas + m.entradas,
      saidas: acc.saidas + m.saidas,
      carteira: acc.carteira + (m.carteiraEntradas ?? 0),
    }), { entradas: 0, saidas: 0, carteira: 0 })

  const faixa = (nome) => aging.find((a) => a.faixa === nome)
  const vencidoTotal = aging
    .filter((a) => a.faixa !== 'a_vencer')
    .reduce((s, a) => s + Number(a.valor), 0)

  return {
    empresa: sessao.tenantNome,
    escopo: sessao.connectionId ? 'uma empresa' : 'todas as empresas do grupo',
    mes_analisado: mesPorExtenso(alvo),
    competencia: alvo,

    // Os nomes dizem sobre o que e cada variacao.
    //
    // Na primeira versao o campo se chamava so "variacao_contra_mes_anterior".
    // Ele era a variacao da RECEITA, mas o modelo, lendo logo depois da linha do
    // resultado, atribuiu o percentual ao resultado. O numero estava certo e a
    // frase, errada. Rotulo ambiguo em dossie de IA vira erro de interpretacao,
    // e erro de interpretacao em relatorio financeiro custa caro.
    resultado_do_mes: doMes && {
      receita: brl(doMes.receita),
      despesa: brl(doMes.despesa),
      resultado: brl(doMes.resultado),
      margem_sobre_a_receita: pct(doMes.margem),
      variacao_da_receita_contra_o_mes_anterior: pct(doMes.var_mes),
      variacao_da_receita_contra_o_mesmo_mes_do_ano_passado: pct(doMes.var_ano),
      variacao_do_resultado_contra_o_mes_anterior: variacao(doMes.resultado, anterior?.resultado),
      variacao_do_resultado_contra_o_mesmo_mes_do_ano_passado:
        variacao(doMes.resultado, mesmoMesAnoPassado?.resultado),
    },
    mes_anterior: anterior && {
      competencia: anterior.competencia,
      receita: brl(anterior.receita), despesa: brl(anterior.despesa),
      resultado: brl(anterior.resultado), margem: pct(anterior.margem),
    },
    // A margem entra aqui porque "minha margem melhorou em relacao ao ano
    // passado" e uma das perguntas mais naturais, e sem este campo a IA
    // respondia, corretamente, que nao tinha o dado.
    mesmo_mes_ano_passado: mesmoMesAnoPassado && {
      competencia: mesmoMesAnoPassado.competencia,
      receita: brl(mesmoMesAnoPassado.receita),
      despesa: brl(mesmoMesAnoPassado.despesa),
      resultado: brl(mesmoMesAnoPassado.resultado),
      margem_sobre_a_receita: pct(mesmoMesAnoPassado.margem),
    },

    posicao_hoje: {
      saldo_em_conta: brl(kpis?.saldo),
      a_receber_total: brl(kpis?.a_receber),
      a_receber_vencido: brl(kpis?.receber_vencido),
      a_receber_proximos_30_dias: brl(kpis?.receber_30d),
      a_pagar_total: brl(kpis?.a_pagar),
      a_pagar_vencido: brl(kpis?.pagar_vencido),
      a_pagar_proximos_30_dias: brl(kpis?.pagar_30d),
      meses_de_despesa_que_o_caixa_cobre: cobertura?.meses_de_cobertura ?? null,
      despesa_media_mensal: brl(cobertura?.despesa_mensal),
    },

    inadimplencia: {
      total_vencido: brl(vencidoTotal),
      vencido_ate_30_dias: brl(faixa('d1_30')?.valor),
      vencido_de_31_a_60: brl(faixa('d31_60')?.valor),
      vencido_de_61_a_90: brl(faixa('d61_90')?.valor),
      vencido_acima_de_90: brl(faixa('d90_mais')?.valor),
      titulos_vencidos_acima_de_90: faixa('d90_mais')?.titulos ?? 0,
    },

    projecao_de_caixa: fluxo && previstos && {
      horizonte: '6 meses',
      saldo_hoje: brl(fluxo.saldoHoje),
      saldo_previsto_ao_fim: brl(fluxo.saldoFinal),
      variacao_do_saldo_no_periodo: brl(fluxo.saldoFinal - fluxo.saldoHoje),
      menor_saldo_do_periodo: fluxo.pior ? brl(fluxo.pior.saldoFim) : null,
      mes_do_menor_saldo: fluxo.pior?.competencia ?? null,
      entradas_previstas: brl(previstos.entradas),
      saidas_previstas: brl(previstos.saidas),
      resultado_previsto: brl(previstos.entradas - previstos.saidas),
      quanto_do_previsto_ja_esta_lancado_no_erp: previstos.entradas > 0
        ? pct(previstos.carteira / previstos.entradas) : null,
      valor_ja_lancado: brl(previstos.carteira),
      valor_apenas_estimado: brl(previstos.entradas - previstos.carteira),
    },

    concentracao_de_clientes: hhi && {
      indice_hhi: hhi.hhi === null ? null : Number(hhi.hhi).toFixed(3).replace('.', ','),
      quantidade_de_clientes: hhi.clientes,
      leitura: hhi.hhi === null ? null
        : Number(hhi.hhi) >= 0.25 ? 'carteira concentrada'
        : Number(hhi.hhi) >= 0.15 ? 'concentracao moderada' : 'carteira diluida',
    },

    sazonalidade_da_receita: sazonal.filter((x) => Number(x.anos) >= 2).map((x) => ({
      mes_do_ano: MESES[x.mes_do_ano - 1],
      indice: String(x.indice).replace('.', ','),
    })),

    fluxo_de_caixa_realizado_por_mes: caixaMensal.map((m) => ({
      mes: m.mes,
      entrou: brl(m.entradas),
      saiu: brl(m.saidas),
      liquido: brl(Number(m.entradas) - Number(m.saidas)),
    })),

    contas_financeiras: contas.map((c) => ({
      nome: c.nome,
      tipo: String(c.tipo ?? '').toLowerCase().replaceAll('_', ' '),
      saldo: brl(c.saldo),
    })),

    prazos: {
      dias_para_receber: prazos.find((p) => p.kind === 'receivable')?.prazo ?? null,
      dias_para_pagar: prazos.find((p) => p.kind === 'payable')?.prazo ?? null,
    },

    // Estes numeros sao do historico inteiro carregado, nao do mes analisado.
    // O nome do campo precisa dizer isso, senao vira "14,8% da receita do mes".
    // O acumulado e o que a leitura de Pareto usa: quantos clientes fazem a
    // maior parte do faturamento.
    acumulado_dos_cinco_maiores_clientes: pct(
      clientes.reduce((a, c) => a + Number(c.participacao ?? 0), 0),
    ),

    maiores_clientes_no_historico_completo: clientes.map((c) => ({
      nome: c.cliente,
      faturado_no_historico: brl(c.faturado),
      participacao_no_faturamento_historico: pct(c.participacao),
      valor_vencido_hoje: Number(c.vencido) > 0 ? brl(c.vencido) : null,
    })),

    maiores_categorias_do_mes: categorias.map((c) => ({
      categoria: c.categoria,
      tipo: c.kind === 'receivable' ? 'receita' : 'despesa',
      valor: brl(c.total),
    })),

    desvios_recentes: desvios.map((d) => ({
      categoria: d.categoria,
      tipo: d.kind === 'receivable' ? 'receita' : 'despesa',
      mes: d.competencia,
      valor: brl(d.valor),
      padrao_dos_12_meses_anteriores: brl(d.mediana),
      quantas_vezes_fora_do_normal: Number(d.escore).toFixed(1),
    })),

    historico_12_meses: meses.slice(0, 12).reverse().map((m) => ({
      mes: m.competencia,
      receita: brl(m.receita),
      despesa: brl(m.despesa),
      resultado: brl(m.resultado),
    })),
  }
}
