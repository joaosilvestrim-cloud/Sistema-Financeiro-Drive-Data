import 'server-only'
import { q } from './db.js'
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
  { mesesAtras = 12, mesesFrente = 6, modo = 'projecao' } = {},
) {
  const projetando = modo !== 'erp'
  const { where, params } = escopo(sessao)
  const escopoB = escopo(sessao, 'b')

  const [realizado, base, contas, taxas] = await Promise.all([
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
    },
  }
}
