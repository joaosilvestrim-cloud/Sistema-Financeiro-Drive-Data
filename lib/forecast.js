import 'server-only'
import { q, q1 } from './db.js'
import { escopo } from './escopo.js'

// Projeção de caixa.
//
// O método, em três partes, para que ninguém precise adivinhar de onde saiu o
// número:
//
// 1. Carteira. O que já está lançado no ERP com vencimento no mês. É o pedaço
//    mais confiável. Recebimento é descontado pela taxa histórica de quanto de
//    fato entra até 30 dias do vencimento, medida na própria empresa.
// 2. Novos negócios. O que ainda não foi lançado. Sai do nível recente da
//    empresa, ajustado pelo índice sazonal daquele mês do ano, e subtraindo o
//    que já está lançado para não contar duas vezes.
//
//    "Nível recente" é a mediana dos três últimos meses fechados, e não mais a
//    média de doze. A média de doze descreve a empresa de seis meses atrás, e
//    aqui isso não é detalhe: a DriveData faturou R$ 15 mil em janeiro de 2025
//    e R$ 217 mil em agosto de 2026. A média dizia R$ 99 mil quando a empresa
//    já rodava a R$ 170 mil, e a projeção saía um terço menor que a realidade.
//
//    Mediana e não média dos três, porque um mês excepcional não deve virar o
//    novo patamar sozinho.
// 3. Deslocamento. Competência não é caixa. A parte de novos negócios entra
//    deslocada pelo prazo médio de recebimento e de pagamento observados, e o
//    deslocamento é repartido entre dois meses, não arredondado para um.
//
//    Arredondar era o defeito que fazia outubro aparecer no vermelho. Com 18
//    dias para receber e 9 para pagar, o arredondamento jogava 100% da receita
//    nova para o mês seguinte e 100% da despesa nova para o mês corrente. O
//    resultado era um buraco de um mês, seguido de um pico: outubro com
//    -R$ 55 mil e novembro com +R$ 148 mil, numa empresa que na verdade anda
//    estável. Repartido, 40% da receita de outubro cai em outubro e 60% em
//    novembro, que é o que 18 dias querem dizer.
//
// Despesa não leva desconto de recuperação. Conta a pagar costuma ser paga.

const MESES_BASE = 12
// Três meses fechados. Curto o bastante para acompanhar uma empresa que cresce,
// longo o bastante para a mediana ter o que descartar.
const MESES_RECENTES = 3

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

    q(`select kind,
              avg(competencia)                                                as media,
              percentile_cont(0.5) within group (order by competencia)
                filter (where mes >= date_trunc('month', current_date)
                                - make_interval(months => ${MESES_RECENTES}))  as recente,
              count(*) filter (where mes >= date_trunc('month', current_date)
                                - make_interval(months => ${MESES_RECENTES}))  as meses_recentes
         from mart.monthly_series
        where ${where}
          and mes < date_trunc('month', current_date)
          and mes >= date_trunc('month', current_date) - make_interval(months => ${MESES_BASE})
        group by 1`, params),

    q(`select kind, mes_do_ano, avg(indice) as indice, max(anos) as anos,
              bool_or(confiavel) as confiavel
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

  // O nível de cada lado. Cai para a média de doze meses quando ainda não há
  // três meses fechados, que é o caso de quem acabou de conectar.
  const nivelDe = (kind) => {
    const h = historico.find((x) => x.kind === kind)
    if (!h) return { nivel: 0, base: 'sem histórico', media: 0 }
    const media = Number(h.media ?? 0)
    if (Number(h.meses_recentes ?? 0) >= MESES_RECENTES && Number(h.recente) > 0) {
      return { nivel: Number(h.recente), base: `mediana dos últimos ${MESES_RECENTES} meses`, media }
    }
    return { nivel: media, base: `média de ${MESES_BASE} meses`, media }
  }
  const receita = nivelDe('receivable')
  const despesa = nivelDe('payable')
  const mediaReceita = receita.nivel
  const mediaDespesa = despesa.nivel
  const taxaNoPrazo = Number(taxa?.taxa ?? 0) || 0.9

  const prazoReceber = Number(prazos.find((p) => p.kind === 'receivable')?.prazo ?? 30)
  const prazoPagar = Number(prazos.find((p) => p.kind === 'payable')?.prazo ?? 30)
  // Em meses, com casa decimal. A parte inteira diz quantos meses inteiros o
  // dinheiro atravessa; a fração diz quanto do mês seguinte ele alcança.
  const emMeses = (dias) => Math.max(0, dias / 30)
  const deslocEnt = emMeses(prazoReceber)
  const deslocSai = emMeses(prazoPagar)

  // O índice já vem neutro da view quando os dados não o sustentam, e a coluna
  // `confiavel` diz qual é o caso. Aqui só se respeita isso: sem evidência
  // limpa, nenhum ajuste.
  const sazonalDe = (kind, mesDoAno) => {
    const linha = sazonal.find((s) => s.kind === kind && s.mes_do_ano === mesDoAno)
    if (!linha || !linha.confiavel) return 1
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
  for (let i = 0; i < horizonte + Math.ceil(Math.max(deslocEnt, deslocSai)) + 1; i++) {
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
  const compMenos = (comp, meses) => {
    const [ano, mes] = comp.split('-').map(Number)
    return chave(new Date(Date.UTC(ano, mes - 1 - meses, 1)))
  }

  // Quanto de cada competência anterior chega neste mês de caixa. Com
  // deslocamento de 0,6 mês, o mês de caixa recebe 40% da competência dele e
  // 60% da competência anterior.
  const chegaEm = (comp, desloc, campo) => {
    const inteiro = Math.floor(desloc)
    const peso = desloc - inteiro
    const perto = novosPor[compMenos(comp, inteiro)]?.[campo] ?? 0
    const longe = novosPor[compMenos(comp, inteiro + 1)]?.[campo] ?? 0
    return perto * (1 - peso) + longe * peso
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
      novosEntradas: chegaEm(comp, deslocEnt, 'receita'),
      novosSaidas: chegaEm(comp, deslocSai, 'despesa'),
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
    baseReceita: receita.base,
    baseDespesa: despesa.base,
    mediaReceita12: receita.media,
    mediaDespesa12: despesa.media,
    participacaoMaiorCliente: Number(maiorCliente?.participacao ?? 0),
    linhas,
  }
}
