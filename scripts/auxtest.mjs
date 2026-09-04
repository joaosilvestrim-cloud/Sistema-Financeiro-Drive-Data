// Valida os indicadores que dependem de série auxiliar.
//
// Cria séries temporárias com valores plausíveis, confere o cálculo contra uma
// conta feita à mão e apaga tudo no fim. Sem isso, o único jeito de saber se a
// fórmula está certa seria olhar o número na tela e achar que parece razoável.

import { pool, query } from '../src/db.mjs'

const t = (await query(`select id from core.tenant order by slug limit 1`)).rows[0]
if (!t) { console.error('nenhum tenant'); await pool.end(); process.exit(1) }

let falhas = 0
const perto = (nome, a, b, tol = 0.05) => {
  const ok = Math.abs(Number(a) - Number(b)) <= tol
  if (!ok) falhas++
  console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${nome.padEnd(44)} ${Number(a).toFixed(2)} vs ${Number(b).toFixed(2)}`)
}

const PREFIXO = '_teste_aux_'
await query(`delete from core.aux_dataset where tenant_id = $1 and chave like $2`, [t.id, PREFIXO + '%'])

async function criar(chave, tipo, unidade, valores) {
  const { rows: [d] } = await query(
    `insert into core.aux_dataset (tenant_id, chave, nome, tipo, unidade)
     values ($1, $2, $3, $4, $5) returning id`,
    [t.id, PREFIXO + chave, 'Teste ' + chave, tipo, unidade],
  )
  for (const [mes, valor] of Object.entries(valores)) {
    await query(
      `insert into core.aux_value (dataset_id, tenant_id, competencia, valor)
       values ($1, $2, ($3 || '-01')::date, $4)`,
      [d.id, t.id, mes, valor],
    )
  }
  return d.id
}

// Três meses fechados servem de base. Pegamos os valores reais do banco para
// conferir a divisão, em vez de inventar receita.
const base = (await query(
  `select to_char(mes, 'YYYY-MM') mes,
          sum(competencia) filter (where kind='receivable') receita,
          sum(competencia) filter (where kind='payable') despesa
     from mart.monthly_series
    where tenant_id = $1 and mes < date_trunc('month', current_date)
    group by 1 order by 1 desc limit 3`, [t.id])).rows.reverse()

if (base.length < 3) { console.error('historico insuficiente'); await pool.end(); process.exit(1) }
const [m1, m2, m3] = base.map((b) => b.mes)
console.log(`\nmeses usados: ${m1}, ${m2}, ${m3}\n`)

const { realizadoContraMeta, porColaborador, porHora, receitaReal, pipelineFuturo, tiposPreenchidos } =
  await import('../lib/indicadoresAux.js')
const sessao = { tenantId: t.id, connectionId: null }

console.log('META')
await criar('meta_rec', 'meta_receita', 'BRL', { [m1]: 100000, [m2]: 120000, [m3]: 140000 })
const metas = await realizadoContraMeta(sessao, 12)
const linhaMeta = metas.find((l) => l.competencia === m2)
perto('meta lida do mes', linhaMeta.meta_receita, 120000)
perto('receita do mes bate com a serie mensal', linhaMeta.receita, base[1].receita)

console.log('\nPOR COLABORADOR')
await criar('pessoas', 'headcount', 'pessoas', { [m1]: 10, [m2]: 10, [m3]: 12 })
const pc = await porColaborador(sessao, 12)
const linhaPc = pc.find((l) => l.competencia === m2)
perto('receita por pessoa', linhaPc.receita_por_pessoa, Number(base[1].receita) / 10)
perto('custo por pessoa', linhaPc.custo_por_pessoa, Number(base[1].despesa) / 10)
console.log(`  ok    so aparecem meses com headcount: ${pc.length} de 12`)

console.log('\nPOR HORA')
await criar('hf', 'horas_faturaveis', 'horas', { [m1]: 800, [m2]: 900, [m3]: 850 })
await criar('hd', 'horas_disponiveis', 'horas', { [m1]: 1200, [m2]: 1200, [m3]: 1300 })
const ph = await porHora(sessao, 12)
const linhaPh = ph.find((l) => l.competencia === m2)
perto('receita por hora', linhaPh.receita_por_hora, Number(base[1].receita) / 900)
perto('utilizacao', linhaPh.utilizacao, 900 / 1200, 0.001)

console.log('\nRECEITA REAL')
// 1% ao mes: o deflator do terceiro mes e 1,01^3 = 1,030301
await criar('ipca', 'indice_economico', 'indice', { [m1]: 1, [m2]: 1, [m3]: 1 })
const rr = await receitaReal(sessao, 12)
const linhaRr = rr.find((l) => l.competencia === m3)
perto('deflator acumulado de 3 meses a 1%', linhaRr.deflator, 1.030301, 0.0001)
perto('receita real', linhaRr.real, Number(base[2].receita) / 1.030301, 1)

console.log('\nPIPELINE')
const proximo = new Date()
proximo.setUTCMonth(proximo.getUTCMonth() + 1)
const mesProximo = proximo.toISOString().slice(0, 7)
await criar('pipe', 'pipeline', 'BRL', { [mesProximo]: 90000 })
const pipe = await pipelineFuturo(sessao)
perto('pipeline do proximo mes', pipe.find((p) => p.competencia === mesProximo)?.pipeline, 90000)

const tipos = await tiposPreenchidos(sessao)
const esperados = ['meta_receita', 'headcount', 'horas_faturaveis', 'horas_disponiveis', 'indice_economico', 'pipeline']
const faltando = esperados.filter((e) => !tipos.has(e))
console.log(`\n  ${faltando.length ? 'FALHA' : 'ok   '} tipos preenchidos detectados${faltando.length ? ': falta ' + faltando.join(', ') : ''}`)
if (faltando.length) falhas++

await query(`delete from core.aux_dataset where tenant_id = $1 and chave like $2`, [t.id, PREFIXO + '%'])
const sobrou = (await query(`select count(*)::int c from core.aux_dataset where chave like $1`, [PREFIXO + '%'])).rows[0].c
console.log(`  ${sobrou === 0 ? 'ok   ' : 'FALHA'} series de teste removidas`)
if (sobrou !== 0) falhas++

await pool.end()
console.log(falhas ? `\n${falhas} falha(s).\n` : '\nTudo passou.\n')
process.exit(falhas ? 1 : 0)
