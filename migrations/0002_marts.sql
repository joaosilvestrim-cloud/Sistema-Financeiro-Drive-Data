-- 0002 · Camada de leitura
--
-- Views comuns, não materializadas, com security_invoker ligado para que a RLS
-- das tabelas de core continue valendo para quem consulta. O volume de um
-- financeiro de PME cabe folgado nisso. Se alguma tela ficar lenta, a promoção
-- para materialized view por tenant é local e não muda o contrato das telas.
--
-- Regra que atravessa tudo: existem três eixos de data e eles nunca se misturam.
--   competência  data_competencia  ->  DRE
--   vencimento   data_vencimento   ->  projeção e aging
--   caixa        data_pagamento    ->  fluxo realizado

create or replace view core.date_dim as
select
  d::date                                          as dia,
  extract(year from d)::int                        as ano,
  extract(month from d)::int                       as mes,
  extract(quarter from d)::int                     as trimestre,
  date_trunc('month', d)::date                     as primeiro_dia_mes,
  to_char(d, 'YYYY-MM')                            as competencia,
  extract(isodow from d)::int                      as dia_semana,
  extract(isodow from d) < 6                       as dia_util
from generate_series('2015-01-01'::date, '2035-12-31'::date, interval '1 day') d;

-- ------------------------------------------------------- fluxo de caixa

-- Realizado. Vem da baixa, que é o único lugar onde existe data de pagamento.
create or replace view mart.cashflow_realized_daily with (security_invoker = true) as
select
  i.tenant_id,
  i.connection_id,
  s.data_pagamento                                                          as dia,
  sum(case when i.kind = 'receivable' then s.valor else 0 end)              as entradas,
  sum(case when i.kind = 'payable'    then s.valor else 0 end)              as saidas,
  sum(case when i.kind = 'receivable' then s.valor else -s.valor end)       as liquido,
  count(*)                                                                  as lancamentos
from core.settlement s
join core.installment i on i.id = s.installment_id
where s.data_pagamento is not null
group by 1, 2, 3;

-- Projetado. O que ainda não foi pago, na data de vencimento.
create or replace view mart.cashflow_projected_daily with (security_invoker = true) as
select
  tenant_id,
  connection_id,
  data_vencimento                                                            as dia,
  sum(case when kind = 'receivable' then coalesce(nao_pago, 0) else 0 end)   as entradas,
  sum(case when kind = 'payable'    then coalesce(nao_pago, 0) else 0 end)   as saidas,
  sum(case when kind = 'receivable' then coalesce(nao_pago, 0)
           else -coalesce(nao_pago, 0) end)                                  as liquido,
  count(*)                                                                   as lancamentos
from core.installment
where deleted_at is null
  and coalesce(nao_pago, 0) > 0
  and data_vencimento is not null
group by 1, 2, 3;

-- As duas visões lado a lado, um dia por linha.
create or replace view mart.cashflow_daily with (security_invoker = true) as
with base as (
  select tenant_id, connection_id, dia, entradas, saidas, liquido, 'realizado' as origem
    from mart.cashflow_realized_daily
  union all
  select tenant_id, connection_id, dia, entradas, saidas, liquido, 'previsto'
    from mart.cashflow_projected_daily
)
select
  tenant_id,
  connection_id,
  dia,
  sum(entradas) filter (where origem = 'realizado') as entradas_realizadas,
  sum(saidas)   filter (where origem = 'realizado') as saidas_realizadas,
  sum(liquido)  filter (where origem = 'realizado') as liquido_realizado,
  sum(entradas) filter (where origem = 'previsto')  as entradas_previstas,
  sum(saidas)   filter (where origem = 'previsto')  as saidas_previstas,
  sum(liquido)  filter (where origem = 'previsto')  as liquido_previsto
from base
group by 1, 2, 3;

-- ------------------------------------------------------------------ DRE

-- Regime de competência. Cai para o vencimento quando a parcela não tem
-- competência preenchida, que é comum em lançamento feito às pressas no ERP.
create or replace view mart.dre_monthly with (security_invoker = true) as
select
  i.tenant_id,
  i.connection_id,
  to_char(coalesce(i.data_competencia, i.data_vencimento), 'YYYY-MM')        as competencia,
  date_trunc('month', coalesce(i.data_competencia, i.data_vencimento))::date as mes,
  i.kind,
  c.id                                                                       as category_id,
  coalesce(c.nome, 'Sem categoria')                                          as categoria,
  c.entrada_dre                                                              as grupo_dre,
  cc.nome                                                                    as categoria_canonica,
  sum(coalesce(i.total, 0))                                                  as total,
  sum(coalesce(i.pago, 0))                                                   as pago,
  sum(coalesce(i.nao_pago, 0))                                               as em_aberto,
  count(*)                                                                   as lancamentos
from core.installment i
left join core.category c            on c.id = i.category_id
left join core.category_map cm       on cm.category_id = c.id
left join core.canonical_category cc on cc.id = cm.canonical_category_id
where i.deleted_at is null
  and coalesce(i.data_competencia, i.data_vencimento) is not null
group by 1, 2, 3, 4, 5, 6, 7, 8, 9;

-- ---------------------------------------------------------------- aging

create or replace view mart.aging_snapshot with (security_invoker = true) as
select
  i.tenant_id,
  i.connection_id,
  i.kind,
  case
    when i.data_vencimento >= current_date then 'a_vencer'
    when current_date - i.data_vencimento <= 30 then 'd1_30'
    when current_date - i.data_vencimento <= 60 then 'd31_60'
    when current_date - i.data_vencimento <= 90 then 'd61_90'
    else 'd90_mais'
  end                                                    as faixa,
  sum(coalesce(i.nao_pago, 0))                           as valor,
  count(*)                                               as titulos,
  min(i.data_vencimento)                                 as vencimento_mais_antigo
from core.installment i
where i.deleted_at is null
  and coalesce(i.nao_pago, 0) > 0
  and i.data_vencimento is not null
group by 1, 2, 3, 4;

-- --------------------------------------------------------- por cliente

-- A baixa entra por uma agregação prévia. Juntar settlement direto na parcela
-- multiplicaria a linha quando existe pagamento parcial, e todo somatório de
-- faturamento sairia inflado.
create or replace view mart.customer_metrics with (security_invoker = true) as
with baixa_por_parcela as (
  select installment_id, max(data_pagamento) as ultimo_pagamento
    from core.settlement
   group by 1
)
select
  i.tenant_id,
  i.connection_id,
  p.id                                                                       as person_id,
  coalesce(p.nome, 'Sem cadastro')                                           as cliente,
  p.documento,
  sum(coalesce(i.total, 0))                                                  as faturado,
  sum(coalesce(i.pago, 0))                                                   as recebido,
  sum(coalesce(i.nao_pago, 0))                                               as em_aberto,
  sum(coalesce(i.nao_pago, 0)) filter (where i.data_vencimento < current_date) as vencido,
  count(*)                                                                   as titulos,
  avg(coalesce(i.total, 0))                                                  as ticket_medio,
  min(i.data_vencimento)                                                     as primeiro_titulo,
  max(i.data_vencimento)                                                     as ultimo_titulo,
  -- Atraso médio dos títulos já pagos. Base do DSO.
  avg(b.ultimo_pagamento - i.data_vencimento)                                as atraso_medio_dias
from core.installment i
left join core.person p          on p.id = i.person_id
left join baixa_por_parcela b    on b.installment_id = i.id
where i.deleted_at is null
  and i.kind = 'receivable'
group by 1, 2, 3, 4, 5;

-- ------------------------------------------------------------ indicadores

create or replace view mart.kpi_overview with (security_invoker = true) as
with ultimo_snapshot as (
  select connection_id, max(snapshot_date) as snapshot_date
    from core.account_balance_snapshot
   group by 1
),
saldo as (
  -- Soma das contas na foto mais recente de cada conexão.
  select b.tenant_id, b.connection_id, u.snapshot_date, sum(b.saldo) as saldo
    from core.account_balance_snapshot b
    join ultimo_snapshot u
      on u.connection_id = b.connection_id and u.snapshot_date = b.snapshot_date
   group by 1, 2, 3
),
titulos as (
  select
    tenant_id,
    connection_id,
    sum(coalesce(nao_pago, 0)) filter (where kind = 'receivable')                                        as a_receber,
    sum(coalesce(nao_pago, 0)) filter (where kind = 'payable')                                           as a_pagar,
    sum(coalesce(nao_pago, 0)) filter (where kind = 'receivable' and data_vencimento < current_date)     as receber_vencido,
    sum(coalesce(nao_pago, 0)) filter (where kind = 'payable'    and data_vencimento < current_date)     as pagar_vencido,
    sum(coalesce(nao_pago, 0)) filter (where kind = 'receivable'
        and data_vencimento between current_date and current_date + 30)                                  as receber_30d,
    sum(coalesce(nao_pago, 0)) filter (where kind = 'payable'
        and data_vencimento between current_date and current_date + 30)                                  as pagar_30d
  from core.installment
  where deleted_at is null
  group by 1, 2
),
caixa_90 as (
  select tenant_id, connection_id,
         sum(entradas) as entradas_90d,
         sum(saidas)   as saidas_90d
    from mart.cashflow_realized_daily
   where dia >= current_date - 90
   group by 1, 2
)
select
  t.tenant_id,
  t.connection_id,
  coalesce(s.saldo, 0)                                       as saldo_atual,
  s.snapshot_date                                            as saldo_em,
  t.a_receber, t.a_pagar, t.receber_vencido, t.pagar_vencido,
  t.receber_30d, t.pagar_30d,
  coalesce(c.entradas_90d, 0)                                as entradas_90d,
  coalesce(c.saidas_90d, 0)                                  as saidas_90d,
  -- Queima média por dia nos últimos 90 dias. Negativa quer dizer que entra
  -- mais do que sai.
  round((coalesce(c.saidas_90d, 0) - coalesce(c.entradas_90d, 0)) / 90.0, 2) as burn_diario,
  case
    when coalesce(c.saidas_90d, 0) - coalesce(c.entradas_90d, 0) <= 0 then null
    else floor(coalesce(s.saldo, 0) /
         ((coalesce(c.saidas_90d, 0) - coalesce(c.entradas_90d, 0)) / 90.0))
  end                                                        as runway_dias
from titulos t
left join saldo   s on s.connection_id = t.connection_id
left join caixa_90 c on c.connection_id = t.connection_id;

-- ------------------------------------------- qualidade da previsão (SCD2)

-- O diferencial do produto. Compara o que estava previsto para um mês num
-- momento passado com o que a mesma parcela virou depois. Só é possível porque
-- guardamos versão de cada parcela, coisa que o ERP não faz.
create or replace view mart.forecast_accuracy with (security_invoker = true) as
select
  v.tenant_id,
  v.connection_id,
  i.kind,
  date_trunc('month', v.data_vencimento)::date as mes_previsto,
  date_trunc('month', v.valid_from)::date      as visto_em,
  sum(v.total)                                 as previsto,
  count(*)                                     as titulos
from core.installment_version v
join core.installment i on i.id = v.installment_id
where v.data_vencimento is not null
group by 1, 2, 3, 4, 5;
