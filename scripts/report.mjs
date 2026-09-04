// Resumo do banco no terminal. Serve para conferir os marts sem abrir o dashboard
// e para validar a carga logo depois de um sync.
//
//   npm run report                 tenant drivedata
//   npm run report -- --tenant drivedata

import { pool, query } from '../src/db.mjs'

const slugArg = process.argv.indexOf('--tenant')
const SLUG = slugArg > -1 ? process.argv[slugArg + 1] : 'drivedata'

const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const { rows: [t] } = await query('select id, nome from core.tenant where slug = $1', [SLUG])
if (!t) {
  console.error(`tenant ${SLUG} nao existe`)
  await pool.end()
  process.exit(1)
}
console.log(`
### ${t.nome}`)

console.log('\n== KPIs por empresa ==')
const { rows: kpis } = await query(
  `select c.nome, k.* from mart.kpi_overview k join core.connection c on c.id = k.connection_id
    where k.tenant_id = $1 order by c.nome`, [t.id])
for (const k of kpis) {
  console.log(`\n${k.nome}`)
  console.log(`  saldo ${brl(k.saldo_atual)} em ${k.saldo_em?.toISOString?.().slice(0,10)}`)
  console.log(`  a receber ${brl(k.a_receber)} (vencido ${brl(k.receber_vencido)}) | proximos 30d ${brl(k.receber_30d)}`)
  console.log(`  a pagar   ${brl(k.a_pagar)} (vencido ${brl(k.pagar_vencido)}) | proximos 30d ${brl(k.pagar_30d)}`)
  console.log(`  90d: entradas ${brl(k.entradas_90d)} saidas ${brl(k.saidas_90d)} | burn/dia ${brl(k.burn_diario)} | runway ${k.runway_dias ?? 'positivo'}`)
}

console.log('\n== fluxo de caixa, ultimos 6 meses (consolidado) ==')
const { rows: fc } = await query(
  `select to_char(dia,'YYYY-MM') mes,
          sum(entradas_realizadas) ent, sum(saidas_realizadas) sai, sum(liquido_realizado) liq
     from mart.cashflow_daily where tenant_id = $1 and dia >= current_date - 180
    group by 1 order by 1`, [t.id])
for (const r of fc) console.log(`  ${r.mes}  entrou ${brl(r.ent)}  saiu ${brl(r.sai)}  liquido ${brl(r.liq)}`)

console.log('\n== projetado, proximos 3 meses ==')
const { rows: pj } = await query(
  `select to_char(dia,'YYYY-MM') mes, sum(entradas_previstas) ent, sum(saidas_previstas) sai
     from mart.cashflow_daily where tenant_id = $1 and dia >= current_date group by 1 order by 1 limit 3`, [t.id])
for (const r of pj) console.log(`  ${r.mes}  a receber ${brl(r.ent)}  a pagar ${brl(r.sai)}`)

console.log('\n== DRE do mes corrente (consolidado) ==')
const { rows: dre } = await query(
  `select grupo_dre, kind, sum(total) total from mart.dre_monthly
    where tenant_id = $1 and competencia = to_char(current_date,'YYYY-MM')
    group by 1,2 order by 2, 3 desc`, [t.id])
for (const r of dre) console.log(`  ${r.kind === 'receivable' ? 'RECEITA' : 'DESPESA'}  ${r.grupo_dre}  ${brl(r.total)}`)

console.log('\n== aging de recebiveis ==')
const { rows: ag } = await query(
  `select faixa, sum(valor) valor, sum(titulos) titulos from mart.aging_snapshot
    where tenant_id = $1 and kind = 'receivable' group by 1
    order by array_position(array['a_vencer','d1_30','d31_60','d61_90','d90_mais'], faixa)`, [t.id])
for (const r of ag) console.log(`  ${r.faixa.padEnd(10)} ${brl(r.valor).padStart(16)}  ${r.titulos} titulos`)

console.log('\n== top 5 clientes ==')
const { rows: cli } = await query(
  `select cliente, sum(faturado) faturado, sum(vencido) vencido, avg(atraso_medio_dias) atraso
     from mart.customer_metrics where tenant_id = $1 group by 1 order by 2 desc limit 5`, [t.id])
for (const r of cli) console.log(`  ${r.cliente.padEnd(26)} ${brl(r.faturado).padStart(16)}  vencido ${brl(r.vencido).padStart(14)}  atraso ${Number(r.atraso ?? 0).toFixed(1)}d`)

console.log('\n== consistencia ==')
const { rows: [chk] } = await query(
  `select (select sum(pago) from core.installment where tenant_id = $1) as pago_parcelas,
          (select sum(valor) from core.settlement where tenant_id = $1) as valor_baixas`, [t.id])
console.log(`  pago nas parcelas ${brl(chk.pago_parcelas)} | soma das baixas ${brl(chk.valor_baixas)}`)
console.log(`  diferenca ${brl(Number(chk.pago_parcelas) - Number(chk.valor_baixas))} (baixa so existe se a data de pagamento ja passou)`)

await pool.end()
