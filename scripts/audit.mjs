// Auditoria dos números que aparecem nas telas.
//
//   npm run audit
//
// Cada verificação recalcula o valor por um caminho diferente do que a tela usa
// e compara os dois. Uma view que soma errado passa despercebida para sempre se
// a única fonte de verdade for ela mesma.
//
// Também lista as lacunas do dado de origem, que não são defeito nosso mas
// mudam a leitura de quem olha o painel.

import { pool, query } from '../src/db.mjs'

let falhas = 0
const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const um = async (sql, p = []) => (await query(sql, p)).rows[0]

function confere(nome, a, b, tolerancia = 0.02) {
  const diff = Math.abs(Number(a ?? 0) - Number(b ?? 0))
  const ok = diff <= tolerancia
  if (!ok) falhas++
  console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${nome.padEnd(46)} ${brl(a).padStart(16)} vs ${brl(b).padStart(16)}${ok ? '' : `  diferenca ${brl(diff)}`}`)
}
function afirma(nome, condicao, detalhe = '') {
  if (!condicao) falhas++
  console.log(`  ${condicao ? 'ok   ' : 'FALHA'} ${nome}${detalhe ? '  ' + detalhe : ''}`)
}
const nota = (t, d = '') => console.log(`  nota  ${t}${d ? '  ' + d : ''}`)

const t = await um(`select id, nome from core.tenant order by slug limit 1`)
if (!t) { console.error('nenhum tenant'); await pool.end(); process.exit(1) }
console.log(`\n### Auditoria de ${t.nome}\n`)

// ---------------------------------------------------------------- saldo
console.log('SALDO E KPIs (tela Visao geral)')
{
  const k = await um(`select sum(saldo_atual) s, sum(a_receber) r, sum(a_pagar) p,
    sum(receber_vencido) rv, sum(pagar_vencido) pv from mart.kpi_overview where tenant_id=$1`, [t.id])
  const snap = await um(`select sum(saldo) s from core.account_balance_snapshot where tenant_id=$1
    and snapshot_date = (select max(snapshot_date) from core.account_balance_snapshot)`, [t.id])
  confere('saldo = soma das contas na ultima foto', k.s, snap.s)

  const ab = await um(`select
    sum(nao_pago) filter (where kind='receivable') r,
    sum(nao_pago) filter (where kind='payable') p,
    sum(nao_pago) filter (where kind='receivable' and data_vencimento < current_date) rv,
    sum(nao_pago) filter (where kind='payable' and data_vencimento < current_date) pv
    from core.installment where tenant_id=$1 and deleted_at is null`, [t.id])
  confere('a receber = soma do nao pago', k.r, ab.r)
  confere('a pagar = soma do nao pago', k.p, ab.p)
  confere('a receber vencido', k.rv, ab.rv)
  confere('a pagar vencido', k.pv, ab.pv)
}

// ----------------------------------------------------------------- aging
console.log('\nAGING (telas Visao geral e Recebiveis)')
for (const kind of ['receivable', 'payable']) {
  const a = await um(`select sum(valor) v, sum(titulos)::int n from mart.aging_snapshot
    where tenant_id=$1 and kind=$2`, [t.id, kind])
  const b = await um(`select sum(nao_pago) v, count(*)::int n from core.installment
    where tenant_id=$1 and kind=$2 and coalesce(nao_pago,0) > 0 and data_vencimento is not null
    and deleted_at is null`, [t.id, kind])
  confere(`aging ${kind} bate com o em aberto`, a.v, b.v)
  afirma(`aging ${kind} conta os mesmos titulos`, Number(a.n) === Number(b.n), `${a.n} vs ${b.n}`)
}

// --------------------------------------------------------------- caixa
console.log('\nFLUXO DE CAIXA REALIZADO (telas Visao geral e Fluxo)')
{
  const v = await um(`select sum(entradas) e, sum(saidas) s from mart.cashflow_realized_daily where tenant_id=$1`, [t.id])
  const d = await um(`select
    sum(s.valor) filter (where i.kind='receivable') e,
    sum(s.valor) filter (where i.kind='payable') s
    from core.settlement s join core.installment i on i.id = s.installment_id
    where s.tenant_id=$1 and s.data_pagamento is not null`, [t.id])
  confere('entradas realizadas', v.e, d.e)
  confere('saidas realizadas', v.s, d.s)

  const semValor = await um(`select count(*)::int n from core.settlement where tenant_id=$1 and valor is null`, [t.id])
  afirma('toda baixa tem valor', Number(semValor.n) === 0, `${semValor.n} sem valor`)
  const semData = await um(`select count(*)::int n from core.settlement where tenant_id=$1 and data_pagamento is null`, [t.id])
  afirma('toda baixa tem data de pagamento', Number(semData.n) === 0, `${semData.n} sem data`)

  // O pago da parcela quita o bruto, nao o liquido. A diferenca e a taxa.
  const div = await um(`select count(*)::int n, sum(abs(dif)) total from (
      select i.id, coalesce(i.pago,0) - coalesce(sum(s.valor_bruto),0) dif
        from core.installment i left join core.settlement s on s.installment_id = i.id
       where i.tenant_id=$1 group by i.id
    ) x where abs(dif) > 0.02`, [t.id])
  afirma('pago da parcela = soma das baixas (bruto)', Number(div.n) === 0,
    `${div.n} parcela(s) divergindo, ${brl(div.total)} no total`)

  const tx = await um(`select sum(taxa) t, count(*) filter (where coalesce(taxa,0) > 0)::int n
    from core.settlement where tenant_id=$1`, [t.id])
  if (Number(tx.t) > 0) {
    nota(`${brl(tx.t)} de taxas em ${tx.n} baixas`,
      'custo real que nao vira lancamento de despesa no ERP')
  }
}

// ------------------------------------------------------------------ DRE
console.log('\nDRE (tela DRE gerencial)')
{
  const v = await um(`select sum(total) t from mart.dre_monthly where tenant_id=$1`, [t.id])
  const d = await um(`select sum(total) t from core.installment
    where tenant_id=$1 and deleted_at is null and coalesce(data_competencia, data_vencimento) is not null`, [t.id])
  confere('DRE soma o mesmo que as parcelas', v.t, d.t)

  const semGrupo = await um(`select count(*)::int n, sum(total) v from mart.dre_monthly
    where tenant_id=$1 and grupo_dre is null`, [t.id])
  if (Number(semGrupo.n) > 0) {
    nota(`${semGrupo.n} linha(s) de DRE sem grupo, ${brl(semGrupo.v)}`,
      'categoria sem entrada_dre no ERP: aparece como Sem classificacao')
  }
}

// -------------------------------------------------------------- clientes
console.log('\nCLIENTES (telas Clientes e Visao geral)')
{
  const v = await um(`select sum(faturado) f, sum(em_aberto) a from mart.customer_metrics where tenant_id=$1`, [t.id])
  const d = await um(`select sum(total) f, sum(nao_pago) a from core.installment
    where tenant_id=$1 and kind='receivable' and deleted_at is null`, [t.id])
  confere('faturado por cliente = total a receber', v.f, d.f)
  confere('em aberto por cliente', v.a, d.a)

  const soma = await um(`select round(sum(participacao)::numeric, 3) s from mart.concentracao_clientes where tenant_id=$1`, [t.id])
  afirma('participacoes somam 100%', Math.abs(Number(soma.s) - 1) < 0.01, `soma ${soma.s}`)
}

// ----------------------------------------------------------- integridade
console.log('\nINTEGRIDADE DO VINCULO')
{
  const x = await um(`select
    count(*)::int total,
    count(*) filter (where person_id is null)::int sem_cliente,
    count(*) filter (where category_id is null)::int sem_categoria,
    count(*) filter (where cost_center_id is null)::int sem_centro,
    count(*) filter (where event_external_id is null)::int sem_evento,
    count(*) filter (where data_competencia is null)::int sem_competencia,
    count(*) filter (where category_id is null and coalesce(total,0) <> 0)::int sem_categoria_com_valor
    from core.installment where tenant_id=$1`, [t.id])
  // Parcela sem categoria e com valor zero nao distorce numero nenhum. O caso
  // real e o "Saldo Inicial" da conta bancaria: o ERP classifica num codigo de
  // sistema que /v1/categorias nao devolve, entao essa categoria nunca vai
  // existir na nossa dimensao. Falhar por causa dela seria alarme falso
  // permanente, e alarme que sempre toca deixa de ser lido.
  afirma('toda parcela com valor tem categoria',
    Number(x.sem_categoria_com_valor) === 0, `${x.sem_categoria_com_valor} sem`)
  if (Number(x.sem_categoria) > Number(x.sem_categoria_com_valor)) {
    nota(`${Number(x.sem_categoria) - Number(x.sem_categoria_com_valor)} parcela(s) de valor zero sem categoria`,
      'saldo inicial e afins, categoria de sistema que a API nao lista')
  }
  afirma('toda parcela tem competencia', Number(x.sem_competencia) === 0, `${x.sem_competencia} sem`)
  nota(`${x.sem_cliente} de ${x.total} parcelas sem cliente`,
    'a API devolve cliente nulo em lancamento avulso, fora de venda')
  nota(`${x.sem_centro} de ${x.total} sem centro de custo`, 'nao classificadas no proprio ERP')

  const v = await um(`select count(*)::int abertas, count(distinct installment_id)::int parcelas
    from core.installment_version where tenant_id=$1 and valid_to is null`, [t.id])
  afirma('uma versao aberta por parcela', Number(v.abertas) === Number(v.parcelas),
    `${v.abertas} versoes abertas para ${v.parcelas} parcelas`)
}

// -------------------------------------------------------------- historico
console.log('\nCOBERTURA DO HISTORICO (afeta Indicadores e Previsao)')
{
  const h = await um(`select min(data_vencimento) de, max(data_vencimento) ate,
    count(distinct date_trunc('month', data_vencimento))::int meses
    from core.installment where tenant_id=$1`, [t.id])
  console.log(`  nota  de ${h.de.toISOString().slice(0, 10)} a ${h.ate.toISOString().slice(0, 10)}, ${h.meses} meses distintos`)

  const passados = await um(`select count(distinct date_trunc('month', mes))::int m
    from mart.monthly_series where tenant_id=$1 and mes < date_trunc('month', current_date)`, [t.id])
  afirma('historico suficiente para media de 12 meses', Number(passados.m) >= 12, `${passados.m} meses fechados`)
  if (Number(passados.m) < 24) {
    nota(`sazonalidade precisa de 24 meses fechados, ha ${passados.m}`,
      'a tela de Indicadores mostra o aviso e omite o indice')
  }
}

await pool.end()
console.log(falhas
  ? `\n${falhas} verificacao(oes) falhou(aram).\n`
  : '\nTodas as verificacoes passaram.\n')
process.exit(falhas ? 1 : 0)
