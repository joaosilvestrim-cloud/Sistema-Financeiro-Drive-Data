import 'server-only'
import { q, q1 } from './db.js'
import { escopo } from './escopo.js'
import { projecao } from './forecast.js'

// Fluxo de caixa mês a mês, o passado medido e o futuro projetado, na mesma
// régua e com o saldo acumulado atravessando os dois.
//
// Uma decisão que precisa estar explícita: o saldo do passado é reconstruído,
// não medido. Só existe uma foto de saldo por dia a partir do momento em que
// passamos a sincronizar, então o histórico vem de trás para frente, tirando do
// saldo de hoje o líquido de cada mês. Isso assume que todo movimento da conta
// passou por uma baixa. Transferência entre contas próprias se anula na soma,
// mas ajuste manual feito direto no extrato não aparece, e nesse caso a curva
// antiga desloca junto. Do dia da primeira sincronização em diante o saldo passa
// a ser fotografado e vira medição.

// `modo` decide o que o futuro significa, e as duas respostas são legítimas.
//
//   projecao  o que esperamos que entre e saia de verdade: a carteira descontada
//             pela taxa histórica de recebimento, mais o negócio novo estimado.
//             É a pergunta de quem decide se cabe contratar.
//
//   erp       a agenda de vencimentos, valor cheio e na data, sem estimativa
//             nenhuma. É exatamente o que o Conta Azul mostra, e é a pergunta de
//             quem está conferindo.
//
// A gestora pediu os dois, e ela tem razão: forçar uma escolha entre confiar e
// conferir é uma escolha falsa. O passado não muda com o modo, porque ali não
// há projeção nenhuma: é baixa por data de pagamento nos dois casos.
export async function fluxoDeCaixa(
  sessao,
  { mesesAtras = 12, mesesFrente = 6, modo = 'projecao', contas: contasSel = [] } = {},
) {
  // Com contas escolhidas, o fluxo é sempre o real: a projeção de negócio novo
  // é da empresa inteira e não tem conta. Repartir a estimativa entre contas
  // seria inventar um número com cara de medido.
  const porConta = contasSel.length > 0
  const projetando = modo !== 'erp' && !porConta
  const { where, params } = escopo(sessao)
  const escopoB = escopo(sessao, 'b')

  const escopoI = escopo(sessao, 'i')
  const [realizado, base, contas, taxas, vencidos] = porConta
    ? await fontesDasContas(sessao, contasSel, mesesAtras, mesesFrente)
    : await Promise.all([
    q(`select to_char(dia, 'YYYY-MM') as competencia,
              sum(entradas) as entradas,
              sum(saidas)   as saidas
         from mart.cashflow_realized_daily
        where ${where}
          and dia >= date_trunc('month', current_date) - make_interval(months => ${mesesAtras})
        group by 1 order by 1`, params),

    projecao(sessao, mesesFrente),

    q(`select distinct on (b.account_id) a.nome, a.tipo, b.saldo, b.snapshot_date
         from core.account_balance_snapshot b
         join core.account a on a.id = b.account_id
        where ${escopoB.where}
        order by b.account_id, b.snapshot_date desc`, escopoB.params),

    q(`select to_char(mes, 'YYYY-MM') as competencia, sum(taxa) as taxa
         from mart.taxas_mensais
        where ${where} and mes >= date_trunc('month', current_date) - make_interval(months => ${mesesAtras})
        group by 1 order by 1`, params),

    // O que já venceu e segue em aberto. A carteira futura começa em hoje,
    // então sem esta consulta os vencidos não existem em mês nenhum do
    // futuro: R$ 100 mil a receber atrasados simplesmente sumiam da curva.
    // O Conta Azul rola esse dinheiro para o mês seguinte, e foi assim que a
    // gestora pegou a diferença: o outubro dela tinha os vencidos de
    // setembro, o nosso não.
    q1(`select
          coalesce(sum(i.nao_pago) filter (where i.kind = 'receivable'), 0) as entradas,
          coalesce(sum(i.nao_pago) filter (where i.kind = 'payable'), 0)   as saidas
          from core.installment i
         where ${escopoI.where} and i.deleted_at is null
           and coalesce(i.nao_pago, 0) > 0.009
           and i.data_vencimento < current_date`, escopoI.params),
  ])

  const saldoHoje = Number(base.saldoInicial ?? 0)
  const mesAtual = new Date().toISOString().slice(0, 7)
  const taxaPor = Object.fromEntries(taxas.map((t) => [t.competencia, Number(t.taxa)]))

  // Passado: meses fechados e o mês corrente até hoje.
  const passado = realizado.map((r) => ({
    competencia: r.competencia,
    tipo: r.competencia === mesAtual ? 'parcial' : 'realizado',
    entradas: Number(r.entradas ?? 0),
    saidas: Number(r.saidas ?? 0),
    realizadoEntradas: Number(r.entradas ?? 0),
    realizadoSaidas: Number(r.saidas ?? 0),
    taxa: taxaPor[r.competencia] ?? 0,
  }))

  // Futuro: carteira já lançada descontada pela taxa histórica de recebimento,
  // mais a estimativa de novos negócios. As duas partes seguem separadas para
  // que a tela possa mostrar de onde vem cada real.
  const futuro = base.linhas
    .filter((l) => l.competencia > mesAtual)
    .map((l) => {
      const carteiraEnt = projetando ? l.carteiraEntradas * base.taxaNoPrazo : l.carteiraEntradas
      const novosEnt = projetando ? l.novosEntradas * base.taxaNoPrazo : 0
      const novosSai = projetando ? l.novosSaidas : 0
      return {
        competencia: l.competencia,
        tipo: 'previsto',
        entradas: carteiraEnt + novosEnt,
        saidas: l.carteiraSaidas + novosSai,
        taxa: 0,
        carteiraEntradas: carteiraEnt,
        novosEntradas: novosEnt,
        carteiraSaidas: l.carteiraSaidas,
        novosSaidas: novosSai,
        // A carteira crua, antes de qualquer ajuste nosso. É exatamente o que o
        // Conta Azul mostra no fluxo dele: a soma do que vence no mês, sem
        // desconto e sem estimativa. Ela viaja junto para a tela poder colocar
        // os dois números lado a lado, porque quem confere contra o ERP precisa
        // ver de onde vem a diferença, não ouvir que existe uma.
        erpEntradas: l.carteiraEntradas,
        erpSaidas: l.carteiraSaidas,
      }
    })

  // O mês corrente tem uma parte já no caixa e uma parte ainda a acontecer.
  //
  // Mostrar só o realizado faz o mês em curso parecer catastrofico no dia 4, com
  // as despesas do inicio do mes ja pagas e nenhuma receita recebida. O mes
  // aparece somado, com as duas partes separadas para o grafico distinguir uma
  // da outra.
  //
  // A formula e exatamente a mesma da tela de Previsao, de proposito. Duas telas
  // do mesmo sistema mostrando numeros diferentes para o mesmo mes e o jeito
  // mais rapido de perder a confianca de quem usa.
  const noMes = base.linhas.find((l) => l.competencia === mesAtual)
  const aReceber = noMes
    ? (projetando
        ? (noMes.carteiraEntradas + noMes.novosEntradas) * base.taxaNoPrazo
        : noMes.carteiraEntradas)
    : 0
  const aPagar = noMes
    ? (projetando ? noMes.carteiraSaidas + noMes.novosSaidas : noMes.carteiraSaidas)
    : 0
  let linhaAtual = passado.find((p) => p.competencia === mesAtual)
  if (!linhaAtual) {
    linhaAtual = {
      competencia: mesAtual, tipo: 'parcial', entradas: 0, saidas: 0,
      realizadoEntradas: 0, realizadoSaidas: 0, taxa: 0,
    }
    passado.push(linhaAtual)
  }
  linhaAtual.aReceberNoMes = aReceber
  linhaAtual.aPagarNoMes = aPagar
  linhaAtual.carteiraEntradas = noMes
    ? (projetando ? noMes.carteiraEntradas * base.taxaNoPrazo : noMes.carteiraEntradas)
    : 0
  linhaAtual.novosEntradas = noMes && projetando ? noMes.novosEntradas * base.taxaNoPrazo : 0
  linhaAtual.entradas = linhaAtual.realizadoEntradas + aReceber
  linhaAtual.saidas = linhaAtual.realizadoSaidas + aPagar

  // Os vencidos rolam para o primeiro mês previsto, pelo valor de face e
  // como componente separado. Valor de face porque é a convenção do próprio
  // ERP (e o modo real promete não estimar nada); separado porque quem
  // confere precisa ver "agenda do mês + vencidos rolados", não um número
  // maior sem explicação. A recuperação parcial disso é assunto da projeção,
  // que já desconta a carteira pela taxa histórica.
  const vencEnt = Number(vencidos?.entradas ?? 0)
  const vencSai = Number(vencidos?.saidas ?? 0)
  if (futuro.length && (vencEnt || vencSai)) {
    const alvo = futuro[0]
    alvo.vencidosEntradas = vencEnt
    alvo.vencidosSaidas = vencSai
    alvo.entradas += vencEnt
    alvo.saidas += vencSai
  }

  const meses = [...passado, ...futuro].sort((a, b) => a.competencia.localeCompare(b.competencia))

  // Saldo.
  //
  // O saldo de hoje é o único número medido, e ele está no meio do mês corrente.
  // Para trás, reconstruímos tirando o líquido de cada mês. Para frente,
  // somamos. O mês corrente é o ponto de virada: o início dele vem do realizado
  // até agora, e o fim já é projeção.
  const iAtual = meses.findIndex((m) => m.competencia === mesAtual)
  const corte = iAtual === -1 ? meses.length - 1 : iAtual

  // Início do mês corrente: saldo de hoje menos o que já passou pelo caixa nele.
  const atual = meses[corte]
  const realizadoLiquido = (atual.realizadoEntradas ?? atual.entradas) - (atual.realizadoSaidas ?? atual.saidas)
  meses[corte].saldoInicio = saldoHoje - realizadoLiquido

  for (let i = corte - 1; i >= 0; i--) {
    meses[i].saldoFim = meses[i + 1].saldoInicio
    meses[i].saldoInicio = meses[i].saldoFim - (meses[i].entradas - meses[i].saidas)
  }
  let saldo = meses[corte].saldoInicio
  for (let i = corte; i < meses.length; i++) {
    saldo += meses[i].entradas - meses[i].saidas
    meses[i].saldoFim = saldo
    meses[i].saldoInicio = saldo - (meses[i].entradas - meses[i].saidas)
  }
  for (const m of meses) m.liquido = m.entradas - m.saidas

  // Quanto do mês corrente já passou. Serve para a marca de hoje cair no lugar
  // certo dentro da barra do mês, e não na virada.
  const hoje = new Date()
  const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()
  const fracaoDoMes = hoje.getDate() / diasNoMes

  const futuros = meses.filter((m) => m.tipo === 'previsto' || m.tipo === 'parcial')
  const pior = futuros.length
    ? futuros.reduce((a, b) => (b.saldoFim < a.saldoFim ? b : a))
    : null

  return {
    modo: projetando ? 'projecao' : 'erp',
    porConta,
    semConta: porConta ? base.semConta : null,
    meses,
    mesAtual,
    fracaoDoMes,
    saldoHoje,
    saldoEm: contas[0]?.snapshot_date ?? null,
    contas,
    saldoFinal: meses.at(-1)?.saldoFim ?? saldoHoje,
    pior,
    premissas: {
      taxaNoPrazo: base.taxaNoPrazo,
      prazoReceber: base.prazoReceber,
      prazoPagar: base.prazoPagar,
      mediaReceita: base.mediaReceita,
      mediaDespesa: base.mediaDespesa,
      baseReceita: base.baseReceita,
      baseDespesa: base.baseDespesa,
    },
  }
}

// As mesmas cinco fontes do fluxo, lidas só das contas escolhidas.
//
// Passado: as baixas cuja conta é uma das escolhidas, pela data do pagamento.
// Transferência entre contas próprias só conta quando cruza a fronteira da
// seleção: do Inter para o Asaas é saída do Inter, mas com os dois escolhidos
// é dinheiro mudando de bolso e não aparece. Futuro: a agenda dos títulos cuja
// conta prevista é uma das escolhidas. Saldo: a última foto de cada uma.
//
// Título sem conta prevista não entra na agenda de conta nenhuma. É o certo, e
// a tela avisa: dizer em qual conta um título vai cair sem o ERP dizer seria
// adivinhar.
async function fontesDasContas(sessao, contasSel, mesesAtras, mesesFrente) {
  const { where: wS, params: pS } = escopo(sessao, 's')
  const nS = pS.length
  const { where: wI, params: pI } = escopo(sessao, 'i')
  const nI = pI.length
  const { where: wT, params: pT } = escopo(sessao, 't')
  const nT = pT.length
  const { where: wB, params: pB } = escopo(sessao, 'b')
  const nB = pB.length

  const [baixas, transferencias, agenda, contas, vencidos, semConta] = await Promise.all([
    q(`select to_char(s.data_pagamento, 'YYYY-MM') as competencia,
              coalesce(sum(s.valor) filter (where i.kind = 'receivable'), 0) as entradas,
              coalesce(sum(s.valor) filter (where i.kind = 'payable'), 0)    as saidas,
              coalesce(sum(s.taxa), 0)                                        as taxa
         from core.settlement s
         join core.installment i on i.id = s.installment_id
        where ${wS} and i.deleted_at is null and s.data_pagamento is not null
          and s.account_id = any($${nS + 1}::uuid[])
          and s.data_pagamento >= date_trunc('month', current_date) - make_interval(months => ${Number(mesesAtras)})
        group by 1`, [...pS, contasSel]),

    q(`select to_char(t.data, 'YYYY-MM') as competencia,
              coalesce(sum(t.valor) filter (where t.destino_id = any($${nT + 1}::uuid[])
                                              and not (t.origem_id = any($${nT + 1}::uuid[]))), 0) as entradas,
              coalesce(sum(t.valor) filter (where t.origem_id = any($${nT + 1}::uuid[])
                                              and not (t.destino_id = any($${nT + 1}::uuid[]))), 0) as saidas
         from core.transfer t
        where ${wT}
          and t.data >= date_trunc('month', current_date) - make_interval(months => ${Number(mesesAtras)})
        group by 1`, [...pT, contasSel]),

    q(`select to_char(date_trunc('month', i.data_vencimento), 'YYYY-MM') as competencia,
              coalesce(sum(i.nao_pago) filter (where i.kind = 'receivable'), 0) as entradas,
              coalesce(sum(i.nao_pago) filter (where i.kind = 'payable'), 0)    as saidas
         from core.installment i
        where ${wI} and i.deleted_at is null and coalesce(i.nao_pago, 0) > 0.009
          and i.account_id = any($${nI + 1}::uuid[])
          and i.data_vencimento >= current_date
          and i.data_vencimento < date_trunc('month', current_date) + make_interval(months => ${Number(mesesFrente) + 1})
        group by 1`, [...pI, contasSel]),

    q(`select distinct on (b.account_id) a.nome, a.tipo, b.saldo, b.snapshot_date
         from core.account_balance_snapshot b
         join core.account a on a.id = b.account_id
        where ${wB} and b.account_id = any($${nB + 1}::uuid[])
        order by b.account_id, b.snapshot_date desc`, [...pB, contasSel]),

    q1(`select
          coalesce(sum(i.nao_pago) filter (where i.kind = 'receivable'), 0) as entradas,
          coalesce(sum(i.nao_pago) filter (where i.kind = 'payable'), 0)   as saidas
          from core.installment i
         where ${wI} and i.deleted_at is null
           and coalesce(i.nao_pago, 0) > 0.009
           and i.data_vencimento < current_date
           and i.account_id = any($${nI + 1}::uuid[])`, [...pI, contasSel]),

    // O que fica de fora por não ter conta prevista no ERP, para a tela dizer.
    q1(`select count(*)::int as titulos, coalesce(sum(i.nao_pago), 0) as valor
          from core.installment i
         where ${wI} and i.deleted_at is null and coalesce(i.nao_pago, 0) > 0.009
           and i.account_id is null`, pI),
  ])

  // Baixas e transferências do mesmo mês viram uma linha só, no formato que o
  // resto do fluxo já entende.
  const passado = new Map()
  for (const r of [...baixas, ...transferencias]) {
    const l = passado.get(r.competencia) ?? { competencia: r.competencia, entradas: 0, saidas: 0 }
    l.entradas += Number(r.entradas)
    l.saidas += Number(r.saidas)
    passado.set(r.competencia, l)
  }
  const realizado = [...passado.values()].sort((a, b) => a.competencia.localeCompare(b.competencia))

  // A agenda, mês a mês, do corrente até o horizonte, sem buraco: mês sem
  // título é mês com zero, e não mês que some do gráfico.
  const porMes = Object.fromEntries(agenda.map((r) => [r.competencia, r]))
  const hoje = new Date()
  const linhas = []
  for (let k = 0; k < mesesFrente; k++) {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + k, 1))
    const comp = d.toISOString().slice(0, 7)
    linhas.push({
      competencia: comp,
      carteiraEntradas: Number(porMes[comp]?.entradas ?? 0),
      carteiraSaidas: Number(porMes[comp]?.saidas ?? 0),
      novosEntradas: 0,
      novosSaidas: 0,
    })
  }

  const base = {
    saldoInicial: contas.reduce((a, c) => a + Number(c.saldo ?? 0), 0),
    linhas,
    taxaNoPrazo: 1,
    prazoReceber: null, prazoPagar: null, mediaReceita: null, mediaDespesa: null,
    baseReceita: null, baseDespesa: null,
    semConta,
  }
  const taxas = baixas.map((r) => ({ competencia: r.competencia, taxa: Number(r.taxa) }))

  return [realizado, base, contas, taxas, vencidos]
}
