-- 0003 · Inteligência
--
-- Indicadores, sazonalidade, probabilidade de recebimento, anomalia e a base da
-- projeção. Tudo em cima do que já está em core, sem chamada nova na API.
--
-- Onde a conta envolve escolha de método, a escolha está escrita no comentário.
-- Indicador financeiro sem definição explícita vira discussão sem fim.

-- ------------------------------------------------------ série mensal

-- Uma linha por mês, tipo e conexão. Competência para resultado, caixa para
-- fluxo. É a base de tendência, sazonalidade e anomalia.
create or replace view mart.monthly_series with (security_invoker = true) as
with competencia as (
  select
    tenant_id, connection_id, kind,
    date_trunc('month', coalesce(data_competencia, data_vencimento))::date as mes,
    sum(coalesce(total, 0))    as competencia,
    count(*)                   as titulos
  from core.installment
  where deleted_at is null
    and coalesce(data_competencia, data_vencimento) is not null
  group by 1, 2, 3, 4
),
caixa as (
  select
    i.tenant_id, i.connection_id, i.kind,
    date_trunc('month', s.data_pagamento)::date as mes,
    sum(s.valor) as caixa
  from core.settlement s
  join core.installment i on i.id = s.installment_id
  where s.data_pagamento is not null
  group by 1, 2, 3, 4
)
select
  coalesce(c.tenant_id, x.tenant_id)         as tenant_id,
  coalesce(c.connection_id, x.connection_id) as connection_id,
  coalesce(c.kind, x.kind)                   as kind,
  coalesce(c.mes, x.mes)                     as mes,
  coalesce(c.competencia, 0)                 as competencia,
  coalesce(x.caixa, 0)                       as caixa,
  coalesce(c.titulos, 0)                     as titulos
from competencia c
full join caixa x
  on x.tenant_id = c.tenant_id and x.connection_id = c.connection_id
 and x.kind = c.kind and x.mes = c.mes;

-- ---------------------------------------------------------- prazos

-- Prazo médio de recebimento e de pagamento, ponderados por valor.
--
-- Medimos da competência até a data de pagamento, não do vencimento. O prazo
-- que importa para o caixa é o tempo total entre o fato gerador e o dinheiro
-- na conta, e é ele que entra no ciclo financeiro.
create or replace view mart.prazos_mensais with (security_invoker = true) as
select
  i.tenant_id,
  i.connection_id,
  i.kind,
  date_trunc('month', s.data_pagamento)::date as mes,
  sum(s.valor)                                as valor,
  round(
    sum(s.valor * (s.data_pagamento - coalesce(i.data_competencia, i.data_vencimento)))
    / nullif(sum(s.valor), 0)
  , 1)                                        as prazo_medio_dias,
  round(
    sum(s.valor * (s.data_pagamento - i.data_vencimento))
    / nullif(sum(s.valor), 0)
  , 1)                                        as atraso_medio_dias
from core.settlement s
join core.installment i on i.id = s.installment_id
where s.data_pagamento is not null
  and coalesce(i.data_competencia, i.data_vencimento) is not null
group by 1, 2, 3, 4;

-- --------------------------------------------- probabilidade de receber

-- Quanto de fato entra, por faixa de atraso, olhando o histórico da própria
-- empresa. Um título com 90 dias de atraso não vale o mesmo que um a vencer, e
-- a projeção só é honesta se aplicar esse desconto.
--
-- Considera apenas títulos vencidos há pelo menos 60 dias, para não contar como
-- perdido o que ainda está no prazo normal de cobrança.
create or replace view mart.taxa_recuperacao with (security_invoker = true) as
with base as (
  select
    tenant_id,
    connection_id,
    case
      when data_vencimento >= current_date - 30 then 'd0_30'
      when data_vencimento >= current_date - 60 then 'd31_60'
      when data_vencimento >= current_date - 90 then 'd61_90'
      else 'd90_mais'
    end as faixa,
    coalesce(total, 0) as total,
    coalesce(pago, 0)  as pago
  from core.installment
  where deleted_at is null
    and kind = 'receivable'
    and data_vencimento < current_date - 60
    and data_vencimento > current_date - interval '24 months'
)
select
  tenant_id, connection_id, faixa,
  sum(total) as total,
  sum(pago)  as recebido,
  round(sum(pago) / nullif(sum(total), 0), 4) as taxa
from base
group by 1, 2, 3;

-- ------------------------------------------------------- sazonalidade

-- Índice sazonal por mês do ano: quanto aquele mês costuma render em relação à
-- média geral. Acima de 1 é mês forte. Precisa de pelo menos dois anos de
-- histórico para significar alguma coisa, e a coluna anos avisa quando não tem.
create or replace view mart.indice_sazonal with (security_invoker = true) as
with mensal as (
  select tenant_id, connection_id, kind, mes, competencia
    from mart.monthly_series
   where mes < date_trunc('month', current_date)
     and mes >= date_trunc('month', current_date) - interval '36 months'
),
media as (
  select tenant_id, connection_id, kind, avg(competencia) as media_geral
    from mensal group by 1, 2, 3
)
select
  m.tenant_id, m.connection_id, m.kind,
  extract(month from m.mes)::int              as mes_do_ano,
  count(*)                                    as anos,
  avg(m.competencia)                          as media_do_mes,
  round((avg(m.competencia) / nullif(g.media_geral, 0))::numeric, 3) as indice
from mensal m
join media g
  on g.tenant_id = m.tenant_id and g.connection_id = m.connection_id and g.kind = m.kind
group by 1, 2, 3, 4, g.media_geral;

-- ---------------------------------------------------------- anomalia

-- Gasto fora do padrão da própria categoria.
--
-- Usa mediana e desvio absoluto mediano dos 12 meses anteriores, não média e
-- desvio padrão. Financeiro de PME tem outlier demais, e a média se deixa levar
-- justamente pelo caso que queremos detectar. Escore robusto acima de 3,5 é o
-- corte usual.
create or replace view mart.anomalias with (security_invoker = true) as
with serie as (
  select
    i.tenant_id, i.connection_id, i.kind,
    coalesce(c.nome, 'Sem categoria')                                      as categoria,
    date_trunc('month', coalesce(i.data_competencia, i.data_vencimento))::date as mes,
    sum(coalesce(i.total, 0))                                              as valor
  from core.installment i
  left join core.category c on c.id = i.category_id
  where i.deleted_at is null
    and coalesce(i.data_competencia, i.data_vencimento) is not null
  group by 1, 2, 3, 4, 5
),
com_mediana as (
  select
    s.tenant_id, s.connection_id, s.kind, s.categoria, s.mes, s.valor,
    h.mediana, h.meses
  from serie s
  cross join lateral (
    select
      percentile_cont(0.5) within group (order by p.valor) as mediana,
      count(*)                                             as meses
    from serie p
    where p.tenant_id = s.tenant_id
      and p.connection_id = s.connection_id
      and p.categoria = s.categoria
      and p.mes < s.mes
      and p.mes >= s.mes - interval '12 months'
  ) h
)
select
  c.tenant_id, c.connection_id, c.kind, c.categoria, c.mes, c.valor,
  c.mediana,
  m.mad,
  c.meses as meses_de_historico,
  case
    when m.mad is null or m.mad = 0 or c.meses < 6 then null
    else round((0.6745 * (c.valor - c.mediana) / m.mad)::numeric, 2)
  end as escore
from com_mediana c
cross join lateral (
  select percentile_cont(0.5) within group (order by abs(p.valor - c.mediana)) as mad
  from serie p
  where p.tenant_id = c.tenant_id
    and p.connection_id = c.connection_id
    and p.categoria = c.categoria
    and p.mes < c.mes
    and p.mes >= c.mes - interval '12 months'
) m;

-- ------------------------------------------------------- concentração

-- Participação de cada cliente e acumulado, para leitura de Pareto. O HHI é a
-- soma dos quadrados das participações, de 0 a 1. Acima de 0,25 é carteira
-- concentrada pelo critério clássico de antitruste, e no contexto de uma PME
-- quer dizer dependência de poucos clientes.
create or replace view mart.concentracao_clientes with (security_invoker = true) as
with base as (
  select
    tenant_id, connection_id, cliente,
    sum(faturado) as faturado
  from mart.customer_metrics
  where faturado > 0
  group by 1, 2, 3
),
total as (
  select tenant_id, connection_id, sum(faturado) as total from base group by 1, 2
)
select
  b.tenant_id, b.connection_id, b.cliente, b.faturado,
  round((b.faturado / nullif(t.total, 0))::numeric, 4) as participacao,
  round((sum(b.faturado) over (
    partition by b.tenant_id, b.connection_id order by b.faturado desc
    rows between unbounded preceding and current row
  ) / nullif(t.total, 0))::numeric, 4)                 as acumulado,
  row_number() over (
    partition by b.tenant_id, b.connection_id order by b.faturado desc
  )                                                    as posicao
from base b
join total t on t.tenant_id = b.tenant_id and t.connection_id = b.connection_id;

create or replace view mart.hhi with (security_invoker = true) as
select
  tenant_id, connection_id,
  round(sum(participacao * participacao)::numeric, 4) as hhi,
  count(*)                                            as clientes
from mart.concentracao_clientes
group by 1, 2;

-- ------------------------------------------------------------ metas

create table if not exists core.budget (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references core.tenant(id) on delete cascade,
  -- null quer dizer meta do tenant inteiro, valendo para o consolidado
  connection_id  uuid references core.connection(id) on delete cascade,
  kind           core.event_kind not null,
  grupo_dre      text not null,
  competencia    text not null,
  valor          numeric(18,2) not null,
  criado_em      timestamptz not null default now(),
  unique (tenant_id, connection_id, kind, grupo_dre, competencia)
);

alter table core.budget enable row level security;
drop policy if exists tenant_read on core.budget;
create policy tenant_read on core.budget for select using (core.is_member(tenant_id));
