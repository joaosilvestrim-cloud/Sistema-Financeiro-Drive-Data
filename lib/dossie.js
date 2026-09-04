import 'server-only'
import { q, q1 } from './db.js'
import { escopo } from './escopo.js'

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

  // Por padrão o último mês fechado. Mês em curso não se compara com mês
  // inteiro, e pedir análise dele produziria alarme falso todo dia 2.
  const alvo = competencia ?? (await q1(
    `select to_char(max(mes), 'YYYY-MM') as m from mart.resultado_mensal
      where ${where} and mes < date_trunc('month', current_date)`, params,
  ))?.m

  if (!alvo) return null

  const [kpis, meses, aging, clientes, categorias, desvios, prazos, cobertura] = await Promise.all([
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

    prazos: {
      dias_para_receber: prazos.find((p) => p.kind === 'receivable')?.prazo ?? null,
      dias_para_pagar: prazos.find((p) => p.kind === 'payable')?.prazo ?? null,
    },

    // Estes numeros sao do historico inteiro carregado, nao do mes analisado.
    // O nome do campo precisa dizer isso, senao vira "14,8% da receita do mes".
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
