-- 0031 · Baixa de título excluído no ERP não conta mais
--
-- Até 10/10/2026 o sync nunca gravava deleted_at, então nenhuma view sentia
-- falta do filtro. A auditoria entre dois tenants da mesma empresa mostrou o
-- custo: título apagado no Conta Azul seguia vivo no espelho. Com o sync
-- marcando exclusão, três views que leem baixas precisam ignorar a baixa de um
-- título que deixou de existir. Para o ERP aquele dinheiro não passou pelo
-- caixa, e para nós também não pode passar.
--
-- mart.forecast_accuracy fica como está de propósito: ela mede o que estava
-- previsto em cada momento, e um título apagado depois estava, sim, previsto.

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
  and i.deleted_at is null
group by 1, 2, 3;

create or replace view mart.prazos_mensais with (security_invoker = true) as
select
  i.tenant_id,
  i.connection_id,
  i.kind,
  date_trunc('month', s.data_pagamento)::date as mes,
  sum(s.valor) as valor,
  round(sum(s.valor * (s.data_pagamento - coalesce(i.data_competencia, i.data_vencimento))::numeric)
        / nullif(sum(s.valor), 0), 1) as prazo_medio_dias,
  round(sum(s.valor * (s.data_pagamento - i.data_vencimento)::numeric)
        / nullif(sum(s.valor), 0), 1) as atraso_medio_dias
from core.settlement s
join core.installment i on i.id = s.installment_id
where s.data_pagamento is not null
  and coalesce(i.data_competencia, i.data_vencimento) is not null
  and i.deleted_at is null
group by 1, 2, 3, 4;

create or replace view mart.taxas_mensais with (security_invoker = true) as
select
  s.tenant_id,
  s.connection_id,
  date_trunc('month', s.data_pagamento)::date as mes,
  sum(coalesce(s.taxa, 0)) as taxa,
  sum(s.valor_bruto) as bruto,
  sum(s.valor) as liquido,
  count(*) filter (where coalesce(s.taxa, 0) > 0) as baixas_com_taxa
from core.settlement s
join core.installment i on i.id = s.installment_id
where s.data_pagamento is not null
  and i.deleted_at is null
group by 1, 2, 3;
