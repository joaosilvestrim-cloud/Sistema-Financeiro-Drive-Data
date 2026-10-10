// Confere o grupo Caixa do menu inteiro contra o espelho do Conta Azul.
//
// Fluxo de caixa, Simulador, Contas a pagar e receber, Recebíveis e Aging,
// para todo tenant, com e sem filtro de conta. Cada número é recomputado do
// zero direto das tabelas core, escrito de outro jeito de propósito, e
// comparado com a função que a tela chama. Pedido do João em 10/10/2026:
// "todo o menu de Caixa está 100% funcionando da forma que deveria?".
//
//   npm run caixateste
import { pool, query } from '../src/db.mjs'
import { fluxoDeCaixa } from '../lib/cashflow.js'
import { baseSimulacao } from '../lib/simulador.js'
import { razao, totaisDaRazao } from '../lib/razao.js'
import { aging as agingRecebiveis, recebiveisAbertos } from '../lib/queries.js'
import { aging, lerFiltros } from '../lib/aging.js'
import { calcular, NEUTRO } from '../lib/simuladorCalculo.js'

const TOL = 0.02
let falhas = 0
let checagens = 0
const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
function igual(nome, tela, fonte) {
  checagens++
  const ok = Math.abs(Number(tela ?? 0) - Number(fonte ?? 0)) <= TOL
  if (!ok) {
    falhas++
    console.log(`  DIVERGE ${nome.padEnd(60)} tela ${brl(tela).padStart(16)}  fonte ${brl(fonte).padStart(16)}`)
  }
  return ok
}
function contagem(nome, tela, fonte) {
  checagens++
  const ok = Number(tela) === Number(fonte)
  if (!ok) {
    falhas++
    console.log(`  DIVERGE ${nome.padEnd(60)} tela ${String(tela).padStart(8)}  fonte ${String(fonte).padStart(8)}`)
  }
}

const tenants = (await query(`
  select t.id, t.nome from core.tenant t
   where exists (select 1 from core.connection c where c.tenant_id = t.id)
   order by t.created_at`)).rows

// O "hoje" e o mês corrente do banco. Todas as recomputações usam esta mesma
// régua, que é a que o painel promete: o dia de Brasília.
const { rows: [ref] } = await query(`select core.hoje()::text as hoje, to_char(core.hoje(), 'YYYY-MM') as mes`)
console.log(`Referência do banco: hoje ${ref.hoje}, mês ${ref.mes}`)

for (const t of tenants) {
  const sessao = { tenantId: t.id, connectionId: null, conexoes: [] }
  const T = t.id
  console.log(`\n######## ${t.nome} ########`)

  // ------------------------------------------------------------ verdade
  const abertos = (await query(`
    select kind, account_id, data_vencimento, nao_pago, pago, total
      from core.installment
     where tenant_id = $1 and deleted_at is null and coalesce(nao_pago, 0) > 0.009`, [T])).rows
  const baixas = (await query(`
    select i.kind, s.account_id, to_char(s.data_pagamento, 'YYYY-MM') as mes, s.valor
      from core.settlement s join core.installment i on i.id = s.installment_id
     where s.tenant_id = $1 and i.deleted_at is null and s.data_pagamento is not null`, [T])).rows
  const saldos = (await query(`
    select distinct on (b.account_id) b.account_id, a.tipo, b.saldo
      from core.account_balance_snapshot b join core.account a on a.id = b.account_id
     where b.tenant_id = $1 order by b.account_id, b.snapshot_date desc`, [T])).rows
  const mesDe = (d) => d.toISOString().slice(0, 7)
  const dia = (d) => d.toISOString().slice(0, 10)
  const somar = (xs, f) => xs.reduce((a, x) => a + Number(f(x) ?? 0), 0)

  // ------------------------------------------------------------ fluxo de caixa
  console.log('== Fluxo de caixa (real, todas as contas) ==')
  for (const frente of [6, 12]) {
    const f = await fluxoDeCaixa(sessao, { mesesAtras: 12, mesesFrente: frente, modo: 'erp' })
    const saldoVerdade = somar(saldos.filter((s) => s.tipo !== 'CARTAO_CREDITO'), (s) => s.saldo)
    igual(`saldo de hoje (${frente}m)`, f.saldoHoje, saldoVerdade)

    for (const m of f.meses) {
      const real = baixas.filter((b) => b.mes === m.competencia)
      if (m.tipo === 'realizado') {
        igual(`${m.competencia} entradas realizadas`, m.entradas, somar(real.filter((b) => b.kind === 'receivable'), (b) => b.valor))
        igual(`${m.competencia} saídas realizadas`, m.saidas, somar(real.filter((b) => b.kind === 'payable'), (b) => b.valor))
      }
      if (m.tipo === 'parcial') {
        const resto = abertos.filter((a) => dia(a.data_vencimento) >= ref.hoje && mesDe(a.data_vencimento) === m.competencia)
        igual(`${m.competencia} mês corrente: realizado de entradas`, m.realizadoEntradas, somar(real.filter((b) => b.kind === 'receivable'), (b) => b.valor))
        igual(`${m.competencia} mês corrente: a receber até o fim do mês`, m.aReceberNoMes, somar(resto.filter((a) => a.kind === 'receivable'), (a) => a.nao_pago))
        igual(`${m.competencia} mês corrente: a pagar até o fim do mês`, m.aPagarNoMes, somar(resto.filter((a) => a.kind === 'payable'), (a) => a.nao_pago))
      }
      if (m.tipo === 'previsto') {
        const doMes = abertos.filter((a) => dia(a.data_vencimento) >= ref.hoje && mesDe(a.data_vencimento) === m.competencia)
        const primeiro = m === f.meses.find((x) => x.tipo === 'previsto')
        const vencEnt = primeiro ? somar(abertos.filter((a) => a.kind === 'receivable' && dia(a.data_vencimento) < ref.hoje), (a) => a.nao_pago) : 0
        const vencSai = primeiro ? somar(abertos.filter((a) => a.kind === 'payable' && dia(a.data_vencimento) < ref.hoje), (a) => a.nao_pago) : 0
        igual(`${m.competencia} entradas previstas (${frente}m)`, m.entradas, somar(doMes.filter((a) => a.kind === 'receivable'), (a) => a.nao_pago) + vencEnt)
        igual(`${m.competencia} saídas previstas (${frente}m)`, m.saidas, somar(doMes.filter((a) => a.kind === 'payable'), (a) => a.nao_pago) + vencSai)
      }
    }
    // Encadeamento do saldo: o fim de um mês é o início do seguinte, e cada
    // mês fecha com o próprio movimento.
    for (let i = 0; i < f.meses.length; i++) {
      const m = f.meses[i]
      igual(`${m.competencia} saldo fim = início + entradas − saídas`, m.saldoFim, m.saldoInicio + m.entradas - m.saidas)
      if (i + 1 < f.meses.length) igual(`${m.competencia} saldo fim = início do mês seguinte`, m.saldoFim, f.meses[i + 1].saldoInicio)
    }
    // Horizonte: quantos meses à frente a tela promete e quantos entrega.
    const previstos = f.meses.filter((m) => m.tipo === 'previsto').length
    contagem(`meses à frente além do corrente (${frente}m)`, previstos + 1, frente)
  }

  // Por conta: cada conta sozinha, contra as baixas e a agenda dela.
  console.log('== Fluxo de caixa por conta ==')
  const contasComMovimento = [...new Set([...baixas.map((b) => b.account_id), ...abertos.map((a) => a.account_id)].filter(Boolean))]
  const transf = (await query(`select origem_id, destino_id, to_char(data, 'YYYY-MM') mes, valor from core.transfer where tenant_id = $1`, [T])).rows
  for (const conta of contasComMovimento) {
    const f = await fluxoDeCaixa(sessao, { mesesAtras: 12, mesesFrente: 6, modo: 'erp', contas: [conta] })
    const nome = (await query('select nome from core.account where id = $1', [conta])).rows[0]?.nome
    igual(`${nome}: saldo de hoje`, f.saldoHoje, somar(saldos.filter((s) => s.account_id === conta), (s) => s.saldo))
    for (const m of f.meses.filter((x) => x.tipo === 'realizado')) {
      const real = baixas.filter((b) => b.mes === m.competencia && b.account_id === conta)
      const tin = somar(transf.filter((x) => x.mes === m.competencia && x.destino_id === conta), (x) => x.valor)
      const tout = somar(transf.filter((x) => x.mes === m.competencia && x.origem_id === conta), (x) => x.valor)
      igual(`${nome} ${m.competencia} entradas`, m.entradas, somar(real.filter((b) => b.kind === 'receivable'), (b) => b.valor) + tin)
      igual(`${nome} ${m.competencia} saídas`, m.saidas, somar(real.filter((b) => b.kind === 'payable'), (b) => b.valor) + tout)
    }
    const agenda = abertos.filter((a) => a.account_id === conta && dia(a.data_vencimento) >= ref.hoje)
    const fut = f.meses.filter((x) => x.tipo === 'previsto')
    const vencC = abertos.filter((a) => a.account_id === conta && dia(a.data_vencimento) < ref.hoje)
    const ultimo = fut.at(-1)?.competencia ?? ref.mes
    igual(`${nome}: entradas previstas no horizonte`,
      somar(fut, (m) => m.entradas) + (f.meses.find((m) => m.tipo === 'parcial')?.aReceberNoMes ?? 0),
      somar(agenda.filter((a) => a.kind === 'receivable' && mesDe(a.data_vencimento) <= ultimo), (a) => a.nao_pago)
        + somar(vencC.filter((a) => a.kind === 'receivable'), (a) => a.nao_pago))
  }

  // ------------------------------------------------------------ simulador
  console.log('== Simulador de caixa ==')
  {
    const b = await baseSimulacao(sessao, { meses: 12 })
    igual('saldo inicial', b.saldoInicial, somar(saldos.filter((s) => s.tipo !== 'CARTAO_CREDITO'), (s) => s.saldo))
    igual('vencidos a receber', b.vencidosEntradas, somar(abertos.filter((a) => a.kind === 'receivable' && dia(a.data_vencimento) < ref.hoje), (a) => a.nao_pago))
    igual('vencidos a pagar', b.vencidosSaidas, somar(abertos.filter((a) => a.kind === 'payable' && dia(a.data_vencimento) < ref.hoje), (a) => a.nao_pago))
    for (const l of b.linhas) {
      const doMes = abertos.filter((a) => dia(a.data_vencimento) >= ref.hoje && mesDe(a.data_vencimento) === l.competencia)
      igual(`${l.competencia} agenda a receber`, l.carteiraEntradas, somar(doMes.filter((a) => a.kind === 'receivable'), (a) => a.nao_pago))
      igual(`${l.competencia} agenda a pagar`, l.carteiraSaidas, somar(doMes.filter((a) => a.kind === 'payable'), (a) => a.nao_pago))
    }
    // O cenário Base, sem alavanca nenhuma, é o fluxo "com projeção". Mês a
    // mês o saldo tem que ser o mesmo nas duas telas.
    const fp = await fluxoDeCaixa(sessao, { mesesAtras: 12, mesesFrente: 12, modo: 'projecao' })
    const sim = calcular(b, NEUTRO, [])
    for (const l of sim) {
      const m = fp.meses.find((x) => x.competencia === l.competencia)
      if (m) igual(`${l.competencia} simulador Base = fluxo com projeção (saldo)`, l.saldo, m.saldoFim)
    }
    for (const conta of contasComMovimento.slice(0, 4)) {
      const bc = await baseSimulacao(sessao, { meses: 12, contas: [conta] })
      igual(`por conta ${conta.slice(0, 8)}: saldo`, bc.saldoInicial, somar(saldos.filter((s) => s.account_id === conta), (s) => s.saldo))
      igual(`por conta ${conta.slice(0, 8)}: vencidos a receber`, bc.vencidosEntradas,
        somar(abertos.filter((a) => a.account_id === conta && a.kind === 'receivable' && dia(a.data_vencimento) < ref.hoje), (a) => a.nao_pago))
      for (const l of bc.linhas) {
        const doMes = abertos.filter((a) => a.account_id === conta && dia(a.data_vencimento) >= ref.hoje && mesDe(a.data_vencimento) === l.competencia)
        igual(`por conta ${conta.slice(0, 8)} ${l.competencia} agenda a receber`, l.carteiraEntradas, somar(doMes.filter((a) => a.kind === 'receivable'), (a) => a.nao_pago))
      }
    }
  }

  // ------------------------------------------------------------ contas a pagar e receber
  console.log('== Contas a pagar e receber ==')
  const todos = (await query(`
    select id, kind, account_id, data_vencimento, total, pago, nao_pago
      from core.installment where tenant_id = $1 and deleted_at is null`, [T])).rows
  const situacao = (i) => {
    if (Number(i.nao_pago ?? 0) <= 0.009) return 'liquidado'
    if (dia(i.data_vencimento) < ref.hoje) return 'vencido'
    if (Number(i.pago ?? 0) > 0.009) return 'parcial'
    return 'a_vencer'
  }
  for (const kind of ['receivable', 'payable']) {
    for (const sit of ['todas', 'aberto', 'vencido', 'a_vencer', 'parcial', 'liquidado']) {
      const tot = await totaisDaRazao(sessao, { kind, situacao: sit })
      const alvo = todos.filter((i) => i.kind === kind && (sit === 'todas'
        || (sit === 'aberto' ? Number(i.nao_pago ?? 0) > 0.009 : situacao(i) === sit)))
      contagem(`${kind} ${sit}: títulos`, tot.titulos, alvo.length)
      igual(`${kind} ${sit}: em aberto`, tot.aberto, somar(alvo, (i) => i.nao_pago))
      igual(`${kind} ${sit}: total`, tot.total, somar(alvo, (i) => i.total))
    }
    // O quadro "vencido" e a lista "vencidas" precisam falar do mesmo conjunto.
    const totAberto = await totaisDaRazao(sessao, { kind, situacao: 'aberto' })
    const totVenc = await totaisDaRazao(sessao, { kind, situacao: 'vencido' })
    igual(`${kind}: quadro vencido = lista vencidas`, totAberto.vencido, totVenc.aberto)
    // Paginação: percorrer todas as páginas traz exatamente o total.
    let vistas = 0
    for (let pg = 0; pg < 200; pg++) {
      const linhas = await razao(sessao, { kind, situacao: 'aberto' }, { limite: 80, pagina: pg })
      vistas += linhas.length
      if (linhas.length < 80) break
    }
    contagem(`${kind}: linhas somadas em todas as páginas`, vistas, totAberto.titulos)
    for (const conta of contasComMovimento.slice(0, 3)) {
      const tc = await totaisDaRazao(sessao, { kind, situacao: 'aberto', contas: [conta] })
      igual(`${kind} conta ${conta.slice(0, 8)}: em aberto`, tc.aberto,
        somar(todos.filter((i) => i.kind === kind && i.account_id === conta && Number(i.nao_pago ?? 0) > 0.009), (i) => i.nao_pago))
    }
  }

  // ------------------------------------------------------------ recebíveis
  console.log('== Recebíveis ==')
  for (const kind of ['receivable', 'payable']) {
    const faixas = await agingRecebiveis(sessao, kind)
    const ab = abertos.filter((a) => a.kind === kind)
    igual(`${kind}: soma das faixas = em aberto`, somar(faixas, (x) => x.valor), somar(ab, (a) => a.nao_pago))
    igual(`${kind}: vencido`, somar(faixas.filter((x) => !String(x.faixa).startsWith('a_vencer')), (x) => x.valor),
      somar(ab.filter((a) => dia(a.data_vencimento) < ref.hoje), (a) => a.nao_pago))
  }
  {
    const lista = await recebiveisAbertos(sessao, 100000)
    contagem('lista de títulos a receber em aberto', lista.length, abertos.filter((a) => a.kind === 'receivable').length)
  }

  // ------------------------------------------------------------ aging
  console.log('== Aging ==')
  for (const tipo of ['receivable', 'payable']) {
    const ab = abertos.filter((a) => a.kind === tipo)
    const verdadeAberto = somar(ab, (a) => a.nao_pago)
    const verdadeVencido = somar(ab.filter((a) => dia(a.data_vencimento) < ref.hoje), (a) => a.nao_pago)
    for (const faixas of ['padrao', 'curto', 'longo', 'completo', '10,20,45']) {
      for (const futuro of ['junto', 'detalhado', 'nao']) {
        for (const agrupar of ['pessoa', 'conta', 'faixa']) {
          const f = lerFiltros({ tipo, faixas, futuro, agrupar })
          const r = await aging(sessao, f)
          const nome = `${tipo} ${faixas}/${futuro}/${agrupar}`
          const somaFaixas = Object.values(r.totalFaixa).reduce((a, v) => a + v, 0)
          const somaLinhas = r.linhas.reduce((a, l) => a + l.total, 0)
          // Sem o futuro, a matriz só tem vencidos, mas o resumo segue a carteira.
          igual(`${nome}: soma das faixas`, somaFaixas, futuro === 'nao' ? verdadeVencido : verdadeAberto)
          igual(`${nome}: soma das linhas`, somaLinhas, futuro === 'nao' ? verdadeVencido : verdadeAberto)
          igual(`${nome}: resumo vencido`, r.resumo.vencido, verdadeVencido)
        }
      }
    }
    for (const conta of contasComMovimento.slice(0, 3)) {
      const r = await aging(sessao, lerFiltros({ tipo, conta }))
      igual(`${tipo} aging conta ${conta.slice(0, 8)}`, r.resumo.aberto,
        somar(ab.filter((a) => a.account_id === conta), (a) => a.nao_pago))
    }
  }
}

console.log(`\n${checagens} checagens, ${falhas} divergência(s).`)
await pool.end()
process.exit(falhas ? 1 : 0)
