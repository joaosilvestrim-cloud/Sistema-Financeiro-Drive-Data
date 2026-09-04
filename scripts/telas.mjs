// Exercita a camada de dados de cada tela contra o banco real.
//
// O build do Next só prova que o JavaScript compila. Ele não roda uma consulta,
// não vê coluna que não existe, não vê divisão por zero nem null onde a tela
// espera número. Este script roda tudo o que cada página chama, com a sessão do
// jeito que a página recebe, e reporta o que quebra.
//
// Roda em dois escopos, consolidado e por empresa, porque o filtro por conexão
// muda a consulta e já escondeu erro antes.

import { pool, query } from '../src/db.mjs'

const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
let falhas = 0
let avisos = 0

async function checa(tela, nome, fn, valida) {
  try {
    const r = await fn()
    const problema = valida ? valida(r) : null
    if (problema) {
      avisos++
      console.log(`  aviso ${nome.padEnd(38)} ${problema}`)
    } else {
      console.log(`  ok    ${nome.padEnd(38)} ${resumo(r)}`)
    }
    return r
  } catch (e) {
    falhas++
    console.log(`  FALHA ${nome.padEnd(38)} ${e.message.slice(0, 110)}`)
    return null
  }
}

function resumo(r) {
  if (r === null || r === undefined) return 'vazio'
  if (Array.isArray(r)) return `${r.length} linha(s)`
  if (typeof r === 'object') {
    const chaves = Object.keys(r)
    return `${chaves.length} campo(s)`
  }
  return String(r)
}

const vazio = (r) => (Array.isArray(r) && r.length === 0 ? 'devolveu lista vazia' : null)

const { rows: [t] } = await query(`
  select t.id, t.nome, t.plano, t.status, t.trial_ate, t.acesso_ate,
         t.limite_empresas, t.ia_habilitada
    from core.tenant t order by t.slug limit 1`)
if (!t) { console.error('nenhum tenant'); await pool.end(); process.exit(1) }

const { rows: conexoes } = await query(
  `select id, nome, status, last_sync_at, sync_interval_minutes
     from core.connection where tenant_id = $1 order by nome`, [t.id])

// A mesma forma que o requireSession devolve. Se a sessão que a página recebe
// mudar, este objeto tem que mudar junto, e é de propósito: quebrar aqui é
// melhor do que quebrar na tela.
const montarSessao = (connectionId) => ({
  user: { id: null },
  tenantId: t.id,
  tenantNome: t.nome,
  role: 'owner',
  conexoes,
  connectionId,
  conta: {
    plano: t.plano, status: t.status, iaHabilitada: t.ia_habilitada,
    emTeste: false, diasRestantes: null, testeVencido: false,
    limiteEmpresas: t.limite_empresas,
    empresasConectadas: conexoes.filter((c) => c.status === 'connected').length,
    podeConectarMais: true, bloqueado: false,
  },
})

const q = await import('../lib/queries.js')
const executivo = await import('../lib/executivo.js')
const duplicidade = await import('../lib/duplicidade.js')
const cashflow = await import('../lib/cashflow.js')
const forecast = await import('../lib/forecast.js')
const dreLib = await import('../lib/dre.js')
const preco = await import('../lib/precificacao.js')
const aux = await import('../lib/indicadoresAux.js')
const alerts = await import('../lib/alerts.js')
const analise = await import('../lib/analise.js')
const fatura = await import('../lib/faturaServidor.js')
const conta = await import('../lib/conta.js')

for (const escopo of [null, conexoes[0]?.id]) {
  const s = montarSessao(escopo)
  console.log(`\n${'='.repeat(72)}`)
  console.log(escopo ? `ESCOPO: ${conexoes[0].nome}` : 'ESCOPO: consolidado (todas as empresas)')
  console.log('='.repeat(72))

  console.log('\nResumo executivo  /resumo')
  await checa('resumo', 'conciliacao', () => executivo.conciliacao(s))
  await checa('resumo', 'agingDuplo', () => executivo.agingDuplo(s))
  const semanas = await checa('resumo', 'duasSemanas', () => executivo.duasSemanas(s),
    (r) => (r?.serie?.length === 14 ? null : `serie com ${r?.serie?.length} dias, esperado 14`))
  await checa('resumo', 'dezMaiores receivable', () => executivo.dezMaiores(s, 'receivable'), vazio)
  await checa('resumo', 'dezMaiores payable', () => executivo.dezMaiores(s, 'payable'), vazio)
  await checa('resumo', 'possiveisDuplicados', () => duplicidade.possiveisDuplicados(s, 12))

  console.log('\nVisao geral  /')
  await checa('visao', 'kpis', () => q.kpis(s), (r) => (r ? null : 'devolveu null'))
  await checa('visao', 'fluxoMensal', () => q.fluxoMensal(s), vazio)
  await checa('visao', 'aging receivable', () => q.aging(s, 'receivable'), vazio)
  await checa('visao', 'topClientes', () => q.topClientes(s, 8), vazio)
  await checa('visao', 'saldosPorConta', () => q.saldosPorConta(s), vazio)
  const k = await q.kpis(s)
  await checa('visao', 'alertas', () => alerts.alertas(s, k))
  await checa('visao', 'analiseSalva', () => analise.analiseSalva(s))

  console.log('\nFluxo de caixa  /fluxo')
  await checa('fluxo', 'fluxoDeCaixa', () => cashflow.fluxoDeCaixa(s))

  console.log('\nRecebiveis  /recebiveis')
  await checa('receb', 'aging payable', () => q.aging(s, 'payable'), vazio)
  await checa('receb', 'recebiveisAbertos', () => q.recebiveisAbertos(s, 60), vazio)

  console.log('\nPrevisao  /previsao')
  await checa('prev', 'projecao', () => forecast.projecao(s))
  await checa('prev', 'pipelineFuturo', () => aux.pipelineFuturo(s))

  console.log('\nIndicadores  /indicadores')
  await checa('ind', 'prazosMedios', () => q.prazosMedios(s), vazio)
  await checa('ind', 'sazonalidade', () => q.sazonalidade(s), vazio)
  await checa('ind', 'concentracao', () => q.concentracao(s))
  await checa('ind', 'indiceHhi', () => q.indiceHhi(s), (r) => (r ? null : 'devolveu null'))
  await checa('ind', 'anomalias', () => q.anomalias(s))
  await checa('ind', 'receitaReal', () => aux.receitaReal(s))
  await checa('ind', 'tiposPreenchidos', () => aux.tiposPreenchidos(s))

  console.log('\nMetas  /metas')
  await checa('metas', 'realizadoContraMeta', () => aux.realizadoContraMeta(s))

  console.log('\nProdutividade  /produtividade')
  await checa('prod', 'porColaborador', () => aux.porColaborador(s))
  await checa('prod', 'porHora', () => aux.porHora(s))

  console.log('\nDRE  /dre')
  for (const grao of ['mes', 'trimestre', 'ano']) {
    await checa('dre', `dre ${grao}`, () => dreLib.dre(s, grao),
      (r) => (r?.periodos?.length ? null : 'sem periodo nenhum'))
  }

  console.log('\nPreco e custo  /precificacao')
  const e = await checa('preco', 'estruturaCusto', () => preco.estruturaCusto(s),
    (r) => (r?.receita > 0 ? null : 'receita zero, multiplicador nao calcula'))
  await checa('preco', 'categoriasParaClassificar', () => preco.categoriasParaClassificar(s), vazio)
  await checa('preco', 'receitaPorCliente', () => preco.receitaPorCliente(s, 12, 15), vazio)
  await checa('preco', 'resultadoPorCentro', () => preco.resultadoPorCentro(s), vazio)

  console.log('\nClientes  /clientes')
  await checa('cli', 'topClientes 50', () => q.topClientes(s, 50), vazio)

  console.log('\nConexoes  /conexoes')
  await checa('conx', 'conexoes', () => q.conexoes(s.tenantId), vazio)
  await checa('conx', 'ultimasRodadas', () => q.ultimasRodadas(s.tenantId, 15))

  console.log('\nFatura  /fatura')
  await checa('fat', 'historicoImportacoes', () => fatura.historicoImportacoes(s, 25))

  console.log('\nAssinatura  /assinar e layout')
  await checa('assin', 'assinatura', () => conta.assinatura(s.tenantId),
    (r) => (r ? null : 'devolveu null'))

  // Coerencia entre telas: o saldo do resumo tem que ser o mesmo da visao geral.
  if (semanas && k) {
    const a = Number(semanas.saldoHoje).toFixed(2)
    const b = Number(k.saldo_atual).toFixed(2)
    if (a !== b) {
      falhas++
      console.log(`\n  FALHA coerencia: saldo do resumo ${brl(a)} != saldo da visao geral ${brl(b)}`)
    } else {
      console.log(`\n  ok    coerencia: resumo e visao geral mostram o mesmo saldo ${brl(a)}`)
    }
  }
}

console.log(`\n${'='.repeat(72)}`)
console.log(falhas === 0
  ? `Nenhuma falha. ${avisos} aviso(s).`
  : `${falhas} FALHA(S) e ${avisos} aviso(s).`)
await pool.end()
process.exitCode = falhas === 0 ? 0 : 1
