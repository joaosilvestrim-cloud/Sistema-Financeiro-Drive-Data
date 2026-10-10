// Auditoria de lógica: cada número que as telas mostram, recomputado do zero
// a partir das tabelas core (o espelho do Conta Azul) e comparado com a view
// ou consulta que a tela realmente usa.
//
// A diferença para o detalheteste: lá se confere que a linha bate com o
// detalhe que abre dela (consistência interna). Aqui se confere que os dois
// batem com o DADO DE ORIGEM sob uma recomputação independente, escrita de
// outro jeito de propósito. Um erro de lógica copiado para os dois lados
// passa no detalheteste e cai aqui.
//
// Roda para todo tenant com conexão. Até 10/10/2026 olhava só o primeiro, e a
// carga travada do TEste2 (metade das contas a pagar faltando, saldo de
// −690 mil no fluxo) passou sem ninguém ver.
//
// Uso: node --env-file=.env scripts/auditoria.mjs
import { pool, query } from '../src/db.mjs'

const TOL = 0.01
let falhas = 0

function linha(nome, a, b, nota = '') {
  const va = Number(a ?? 0), vb = Number(b ?? 0)
  const ok = Math.abs(va - vb) <= TOL
  if (!ok) falhas++
  const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  console.log(`  ${ok ? 'ok  ' : 'DIVERGE'} ${nome.padEnd(52)} tela ${brl(va).padStart(15)}  fonte ${brl(vb).padStart(15)} ${nota}`)
}
function conta(nome, a, b, nota = '') {
  const ok = Number(a) === Number(b)
  if (!ok) falhas++
  console.log(`  ${ok ? 'ok  ' : 'DIVERGE'} ${nome.padEnd(52)} tela ${String(a).padStart(8)}  fonte ${String(b).padStart(8)} ${nota}`)
}

const tenants = (await query(`
  select t.id, t.nome from core.tenant t
   where exists (select 1 from core.connection c where c.tenant_id = t.id)
   order by t.created_at`)).rows

for (const tenant of tenants) {
const T = tenant.id
console.log(`\n\n######## ${tenant.nome} ########`)

console.log('\n== CARGA E COBERTURA · o espelho está completo? ==')
{
  // Carga não concluída quer dizer espelho pela metade, e toda tela abaixo
  // estaria certa sobre um dado errado.
  const j = (await query(`
    select c.nome, j.status, j.etapa, j.janela, j.janelas_total
      from core.connection c left join core.onboarding_job j on j.connection_id = c.id
     where c.tenant_id = $1`, [T])).rows
  for (const x of j) {
    // Conexão carregada pela CLI não tem linha de carga, e está completa.
    const ok = !x.status || x.status === 'concluido'
    if (!ok) falhas++
    console.log(`  ${ok ? 'ok  ' : 'DIVERGE'} carga inicial ${x.nome}: ${x.status ?? 'feita pela CLI'}`
      + (ok ? '' : ` (parada em ${x.etapa} ${x.janela}/${x.janelas_total})`))
  }
  const c = (await query(`
    select count(*) filter (where coalesce(nao_pago, 0) > 0.009 and account_id is null)::int as abertos_sem_conta,
           count(*) filter (where event_external_id is null)::int as so_da_busca
      from core.installment where tenant_id = $1 and deleted_at is null`, [T])).rows[0]
  console.log(`  info  ${c.abertos_sem_conta} em aberto sem conta planejada no ERP, ${c.so_da_busca} ainda sem detalhe`)
}

console.log('\n== VISÃO GERAL · mart.kpi_overview ==')
{
  const k = (await query(`
    select sum(saldo_atual) saldo, sum(a_receber) rec, sum(a_pagar) pag,
           sum(receber_vencido) rv, sum(pagar_vencido) pv,
           sum(receber_30d) r30, sum(pagar_30d) p30
      from mart.kpi_overview where tenant_id = $1`, [T])).rows[0]

  const f = (await query(`
    with foto as (
      select b.account_id, b.saldo, a.tipo,
             row_number() over (partition by b.account_id order by b.snapshot_date desc) rn
        from core.account_balance_snapshot b
        join core.account a on a.id = b.account_id
       where b.tenant_id = $1
    )
    select coalesce(sum(saldo) filter (where tipo is distinct from 'CARTAO_CREDITO'), 0) saldo
      from foto where rn = 1`, [T])).rows[0]
  linha('saldo (última foto por conta, sem cartão)', k.saldo, f.saldo)

  const i = (await query(`
    select coalesce(sum(nao_pago) filter (where kind='receivable'),0) rec,
           coalesce(sum(nao_pago) filter (where kind='payable'),0) pag,
           coalesce(sum(nao_pago) filter (where kind='receivable' and data_vencimento<current_date),0) rv,
           coalesce(sum(nao_pago) filter (where kind='payable' and data_vencimento<current_date),0) pv,
           coalesce(sum(nao_pago) filter (where kind='receivable' and data_vencimento between current_date and current_date+30),0) r30,
           coalesce(sum(nao_pago) filter (where kind='payable' and data_vencimento between current_date and current_date+30),0) p30
      from core.installment where tenant_id=$1 and deleted_at is null`, [T])).rows[0]
  linha('a receber em aberto', k.rec, i.rec)
  linha('a pagar em aberto', k.pag, i.pag)
  linha('receber vencido', k.rv, i.rv)
  linha('pagar vencido', k.pv, i.pv)
  linha('receber 30 dias', k.r30, i.r30)
  linha('pagar 30 dias', k.p30, i.p30)
}

console.log('\n== INTEGRIDADE DO ESPELHO · installment ==')
{
  // O contrato do dado, com as exceções que o próprio ERP pratica, todas
  // descobertas olhando payload bruto:
  //   1. PERDIDO zera pago e em aberto e mantém o total (a diferença É a perda).
  //   2. Em parte dos títulos, `pago` é o BRUTO da quitação (líquido + taxa
  //      + juros − desconto) e excede o total pela taxa.
  //   3. Em outra parte (QUITADO vindos do sync de 10/2026), `pago` é o valor
  //      de FACE e a taxa sai do líquido da baixa. As duas convenções
  //      coexistem na mesma base.
  // O título fecha se QUALQUER uma das duas leituras explica o trio.
  const r = (await query(`
    select count(*) fora, coalesce(sum(least(abs(d_face), abs(d_bruto))),0) desvio from (
      select i.id,
             coalesce(i.total,0)-coalesce(i.pago,0)-coalesce(i.nao_pago,0) as d_face,
             coalesce(i.total,0)-coalesce(i.pago,0)-coalesce(i.nao_pago,0)
               + coalesce(sum(s.taxa),0) + coalesce(sum(s.juros),0) - coalesce(sum(s.desconto),0) as d_bruto
        from core.installment i
        left join core.settlement s on s.installment_id = i.id
       where i.tenant_id=$1 and i.deleted_at is null and i.status_traduzido <> 'PERDIDO'
       group by i.id
    ) x where least(abs(d_face), abs(d_bruto)) > 0.011`, [T])).rows[0]
  conta('títulos fora do contrato total = pago + aberto', r.fora, 0,
    r.fora > 0 ? `(desvio ${Number(r.desvio).toFixed(2)})` : '(perdidos e as duas convenções de taxa cobertos)')

  // Espelho parado é a falha mais silenciosa que existe: o sync responde ok,
  // zero alterações, e a base apodrece. Foi um mês assim em 09/2026 por causa
  // do fuso do CDC. Mais de 26 horas sem UM payload novo numa empresa ativa é
  // alarme, não coincidência.
  const fresco = (await query(`
    select extract(epoch from (now() - max(fetched_at)))/3600 as horas
      from raw.api_payload where tenant_id=$1`, [T])).rows[0]
  conta('espelho atualizado nas últimas 26h', Number(fresco.horas) <= 26 ? 1 : 0, 1,
    `(último payload há ${Number(fresco.horas).toFixed(1)}h)`)

  const perdas = (await query(`
    select count(*) n, coalesce(sum(total),0) v from core.installment
     where tenant_id=$1 and deleted_at is null and status_traduzido='PERDIDO'`, [T])).rows[0]
  console.log(`  info  perdas reconhecidas pelo ERP: ${perdas.n} título(s), R$ ${Number(perdas.v).toFixed(2)} (fora do contrato acima de propósito)`)

  // Baixas versus pago: nas duas convenções, o pago tem que ser explicável
  // pelas baixas, ou como bruto (líquido+taxa+juros−desconto) ou como face
  // (líquido+taxa quando a taxa saiu do caixa).
  const b = (await query(`
    select count(*) fora from (
      select i.id
        from core.installment i join core.settlement s on s.installment_id=i.id
       where i.tenant_id=$1 and i.deleted_at is null
       group by i.id, i.pago
      having least(
        abs(coalesce(i.pago,0)
          - (coalesce(sum(s.valor),0)+coalesce(sum(s.taxa),0)+coalesce(sum(s.juros),0)-coalesce(sum(s.desconto),0))),
        abs(coalesce(i.pago,0) - coalesce(sum(s.valor),0))
      ) > 0.05
    ) x`, [T])).rows[0]
  conta('títulos onde as baixas não explicam o pago', b.fora, 0)

  const nulos = (await query(`
    select count(*) filter (where data_vencimento is null and coalesce(nao_pago,0)>0.009) sem_venc
      from core.installment where tenant_id=$1 and deleted_at is null`, [T])).rows[0]
  conta('títulos em aberto sem data de vencimento', nulos.sem_venc, 0,
    '(se >0, aging e agenda os deixam de fora e o KPI não)')
}

console.log('\n== RECEBÍVEIS · mart.aging_snapshot ==')
{
  // Partição completa: todo título em aberto com vencimento cai em exatamente
  // uma faixa, e a soma das faixas devolve o total em aberto.
  for (const kind of ['receivable', 'payable']) {
    const a = (await query(`select coalesce(sum(valor),0) v, coalesce(sum(titulos),0) n
      from mart.aging_snapshot where tenant_id=$1 and kind=$2`, [T, kind])).rows[0]
    const f = (await query(`select coalesce(sum(nao_pago),0) v, count(*) filter (where coalesce(nao_pago,0)>0.009) n
      from core.installment where tenant_id=$1 and kind=$2 and deleted_at is null
        and coalesce(nao_pago,0)>0.009 and data_vencimento is not null`, [T, kind])).rows[0]
    linha(`aging ${kind}: soma das faixas`, a.v, f.v)
    conta(`aging ${kind}: contagem de títulos`, a.n, f.n)
  }
}

console.log('\n== FLUXO DE CAIXA (real) · mart.cashflow_realized_daily ==')
{
  // Entradas e saídas realizadas devem ser as baixas por data de pagamento.
  // Transferência entre contas próprias não é entrada nem saída de caixa.
  const v = (await query(`
    select coalesce(sum(entradas),0) e, coalesce(sum(saidas),0) s
      from mart.cashflow_realized_daily where tenant_id=$1`, [T])).rows[0]
  const f = (await query(`
    select coalesce(sum(s.valor) filter (where i.kind='receivable'),0) e,
           coalesce(sum(s.valor) filter (where i.kind='payable'),0) s
      from core.settlement s join core.installment i on i.id=s.installment_id
     where s.tenant_id=$1 and i.deleted_at is null and s.data_pagamento is not null`, [T])).rows[0]
  linha('entradas realizadas (todas as datas)', v.e, f.e)
  linha('saídas realizadas (todas as datas)', v.s, f.s)

  const tr = (await query(`select count(*) n from core.transfer where tenant_id=$1`, [T])).rows[0]
  console.log(`  info  transferências registradas: ${tr.n} (não podem estar no realizado)`)
}

console.log('\n== DRE · mart.dre_monthly vs competência dos títulos ==')
{
  // Receita e despesa por competência: a view contra a recomputação com o
  // mesmo critério declarado (competência, senão vencimento).
  const v = (await query(`
    select coalesce(sum(total) filter (where kind='receivable'),0) rec,
           coalesce(sum(total) filter (where kind='payable'),0) desp
      from mart.dre_monthly where tenant_id=$1`, [T])).rows[0]
  const f = (await query(`
    select coalesce(sum(total) filter (where kind='receivable'),0) rec,
           coalesce(sum(total) filter (where kind='payable'),0) desp
      from core.installment
     where tenant_id=$1 and deleted_at is null
       and coalesce(data_competencia, data_vencimento) is not null`, [T])).rows[0]
  linha('DRE receita total (todas as competências)', v.rec, f.rec)
  linha('DRE despesa total', v.desp, f.desp)
}

console.log('\n== CLIENTES · mart.customer_metrics ==')
{
  const v = (await query(`
    select coalesce(sum(faturado),0) f, coalesce(sum(recebido),0) r, coalesce(sum(em_aberto),0) a
      from mart.customer_metrics where tenant_id=$1`, [T])).rows[0]
  const f = (await query(`
    select coalesce(sum(total),0) f, coalesce(sum(pago),0) r, coalesce(sum(nao_pago),0) a
      from core.installment where tenant_id=$1 and kind='receivable' and deleted_at is null`, [T])).rows[0]
  linha('faturado (soma dos clientes)', v.f, f.f)
  linha('recebido', v.r, f.r)
  linha('em aberto', v.a, f.a)
}

console.log('\n== MENSAL · mart.monthly_series (base da projeção) ==')
{
  const v = (await query(`
    select coalesce(sum(competencia) filter (where kind='receivable'),0) rec,
           coalesce(sum(competencia) filter (where kind='payable'),0) desp
      from mart.monthly_series where tenant_id=$1`, [T])).rows[0]
  const f = (await query(`
    select coalesce(sum(total) filter (where kind='receivable'),0) rec,
           coalesce(sum(total) filter (where kind='payable'),0) desp
      from core.installment where tenant_id=$1 and deleted_at is null
       and coalesce(data_competencia, data_vencimento) is not null`, [T])).rows[0]
  linha('série mensal receita', v.rec, f.rec)
  linha('série mensal despesa', v.desp, f.desp)
}

console.log('\n== AMOSTRA CONTRA O RAW · o espelho reflete o payload? ==')
{
  // Cinco parcelas recentes: o total do core contra o total do último payload
  // bruto que a Conta Azul mandou para aquela parcela.
  const amostra = (await query(`
    select i.external_id, i.total, i.kind
      from core.installment i
     where i.tenant_id=$1 and i.deleted_at is null and i.total is not null
     order by i.data_vencimento desc nulls last limit 5`, [T])).rows
  for (const a of amostra) {
    const raw = (await query(`
      select payload from raw.api_payload
       where tenant_id=$1 and external_id=$2 and resource in ('receivable','payable','installment')
       order by fetched_at desc limit 1`, [T, a.external_id])).rows[0]
    if (!raw) { console.log(`  info  ${a.external_id.slice(0, 8)}… sem payload bruto guardado`); continue }
    const p = raw.payload
    // O total do espelho é o BRUTO. No detalhe ele mora em
    // valor_composicao.valor_bruto. Na busca o `total` vem líquido da taxa e o
    // bruto é pago mais o que falta (ver daBusca no provider).
    const totalRaw = p.valor_composicao?.valor_bruto
      ?? (p.total !== undefined
        ? Math.max(Number(p.total), Math.round((Number(p.pago ?? 0) + Number(p.nao_pago ?? 0)) * 100) / 100)
        : p.evento?.rateio?.reduce((a, x) => a + Number(x.valor ?? 0), 0)) ?? null
    if (totalRaw === null) { console.log(`  info  ${a.external_id.slice(0, 8)}… payload sem campo de total reconhecido`); continue }
    linha(`parcela ${a.external_id.slice(0, 8)}… total`, a.total, totalRaw)
  }
}

}

console.log('')
if (falhas === 0) console.log('Toda a lógica confere com a origem.')
else console.log(`${falhas} divergência(s). Cada uma acima diz a tela e a recomputação.`)
await pool.end()
process.exit(falhas ? 1 : 0)
