-- 0006 · Dados auxiliares e novos indicadores
--
-- Metade dos indicadores que um financeiro quer não cabe no ERP: meta do ano,
-- número de pessoas no mês, horas faturáveis, pipeline comercial, IPCA. São
-- números que vivem numa planilha e nunca encontram o resultado.
--
-- Em vez de uma tabela por conceito, um repositório de séries. Cada série tem
-- uma chave, uma unidade e um tipo, e os valores são por competência, com uma
-- dimensão opcional para quando o número for por centro de custo, por grupo ou
-- por cliente. Assim entra qualquer indicador novo sem migration.

create table core.aux_dataset (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenant(id) on delete cascade,
  chave         text not null,
  nome          text not null,
  -- Muda como o número é exibido e como pode ser combinado com o financeiro.
  unidade       text not null default 'numero'
                check (unidade in ('BRL', 'numero', 'pessoas', 'horas', 'percentual', 'indice')),
  -- O tipo liga a série a um indicador pronto. 'livre' é só para acompanhar.
  tipo          text not null default 'livre'
                check (tipo in ('livre', 'meta_receita', 'meta_despesa', 'meta_resultado',
                                'headcount', 'horas_faturaveis', 'horas_disponiveis',
                                'pipeline', 'indice_economico')),
  descricao     text,
  created_at    timestamptz not null default now(),
  unique (tenant_id, chave)
);

create table core.aux_value (
  dataset_id  uuid not null references core.aux_dataset(id) on delete cascade,
  tenant_id   uuid not null references core.tenant(id) on delete cascade,
  -- Sempre o primeiro dia do mês. Guardar texto 'YYYY-MM' impediria juntar com
  -- as séries financeiras sem conversão em toda consulta.
  competencia date not null,
  -- Vazio quando o número é da empresa inteira. Preenchido quando é por centro
  -- de custo, grupo de DRE ou cliente.
  dimensao    text not null default '',
  valor       numeric(18,4) not null,
  origem      text not null default 'manual' check (origem in ('manual', 'csv', 'api')),
  atualizado_em timestamptz not null default now(),
  primary key (dataset_id, competencia, dimensao)
);

create index on core.aux_value (tenant_id, competencia);

alter table core.aux_dataset enable row level security;
alter table core.aux_value enable row level security;
create policy tenant_read on core.aux_dataset for select using (core.is_member(tenant_id));
create policy tenant_read on core.aux_value for select using (core.is_member(tenant_id));

-- Série auxiliar já agregada por mês, para juntar com o financeiro sem repetir
-- a soma das dimensões em cada consulta.
create or replace view mart.aux_mensal with (security_invoker = true) as
select
  d.tenant_id,
  d.id            as dataset_id,
  d.chave,
  d.nome,
  d.tipo,
  d.unidade,
  v.competencia,
  sum(v.valor)    as valor
from core.aux_dataset d
join core.aux_value v on v.dataset_id = d.id
group by 1, 2, 3, 4, 5, 6, 7;

-- ------------------------------------------------ indicadores novos

-- Receita, despesa, resultado e margem por mês, com a variação contra o mês
-- anterior e contra o mesmo mês do ano passado.
--
-- A comparação contra o ano anterior é a que vale num negócio sazonal: agosto
-- contra julho engana quando agosto é sempre forte.
create or replace view mart.resultado_mensal with (security_invoker = true) as
with base as (
  select
    tenant_id, connection_id, mes,
    sum(competencia) filter (where kind = 'receivable') as receita,
    sum(competencia) filter (where kind = 'payable')    as despesa
  from mart.monthly_series
  group by 1, 2, 3
)
select
  tenant_id, connection_id, mes, receita, despesa,
  receita - despesa as resultado,
  case when receita > 0 then round(((receita - despesa) / receita)::numeric, 4) end as margem,
  lag(receita) over (partition by tenant_id, connection_id order by mes) as receita_mes_anterior,
  lag(receita, 12) over (partition by tenant_id, connection_id order by mes) as receita_ano_anterior,
  case when lag(receita) over (partition by tenant_id, connection_id order by mes) > 0
       then round((receita / lag(receita) over (partition by tenant_id, connection_id order by mes) - 1)::numeric, 4) end as var_mes,
  case when lag(receita, 12) over (partition by tenant_id, connection_id order by mes) > 0
       then round((receita / lag(receita, 12) over (partition by tenant_id, connection_id order by mes) - 1)::numeric, 4) end as var_ano
from base;

-- Movimento de clientes: quem é novo, quem voltou e quem parou.
--
-- Cliente perdido é o que faturou nos 3 meses anteriores à janela e não faturou
-- nos 3 últimos. É o indicador que o ERP nunca dá e que costuma explicar queda
-- de receita antes de ela aparecer no caixa.
create or replace view mart.clientes_mensais with (security_invoker = true) as
with fatura as (
  select distinct
    i.tenant_id, i.connection_id, i.person_id,
    date_trunc('month', coalesce(i.data_competencia, i.data_vencimento))::date as mes
  from core.installment i
  where i.kind = 'receivable' and i.deleted_at is null and i.person_id is not null
),
primeiro as (
  select tenant_id, connection_id, person_id, min(mes) as primeiro_mes
    from fatura group by 1, 2, 3
)
select
  f.tenant_id, f.connection_id, f.mes,
  count(*)::int                                                     as ativos,
  count(*) filter (where p.primeiro_mes = f.mes)::int               as novos,
  count(*) filter (where p.primeiro_mes < f.mes)::int               as recorrentes
from fatura f
join primeiro p
  on p.tenant_id = f.tenant_id and p.connection_id = f.connection_id and p.person_id = f.person_id
group by 1, 2, 3;

-- Quantos meses de despesa o caixa de hoje cobre.
--
-- Mais honesto que o runway calculado sobre o líquido: aqui não se conta com a
-- receita futura entrando. É a pergunta "se parar tudo, quanto tempo eu ando".
create or replace view mart.cobertura_caixa with (security_invoker = true) as
with despesa as (
  select tenant_id, connection_id, avg(saidas) as media_mensal
    from (
      select tenant_id, connection_id, date_trunc('month', dia) as mes, sum(saidas) as saidas
        from mart.cashflow_realized_daily
       where dia >= date_trunc('month', current_date) - interval '6 months'
         and dia < date_trunc('month', current_date)
       group by 1, 2, 3
    ) m
   group by 1, 2
),
saldo as (
  select b.tenant_id, b.connection_id, sum(b.saldo) as saldo
    from core.account_balance_snapshot b
   where b.snapshot_date = (select max(snapshot_date) from core.account_balance_snapshot)
   group by 1, 2
)
select
  s.tenant_id, s.connection_id, s.saldo, d.media_mensal as despesa_mensal,
  case when d.media_mensal > 0 then round((s.saldo / d.media_mensal)::numeric, 1) end as meses_de_cobertura
from saldo s
left join despesa d on d.tenant_id = s.tenant_id and d.connection_id = s.connection_id;
