-- 0005 · Bruto e taxa na baixa
--
-- A baixa tem dois valores que não são o mesmo número, e confundi-los produz
-- relatório que não fecha:
--
--   valor_bruto    quanto da parcela foi quitado
--   valor_liquido  quanto de fato entrou ou saiu da conta financeira
--
-- A diferença é a taxa da maquininha ou do meio de pagamento. Para o fluxo de
-- caixa vale o líquido, porque a taxa nunca passou pela conta. Para conferir
-- se o título foi quitado vale o bruto, porque é ele que abate o que o cliente
-- devia. Guardar só um dos dois faz o `pago` da parcela nunca bater com a soma
-- das baixas, e a conferência acusa uma divergência que não existe.

alter table core.settlement
  add column if not exists valor_bruto numeric(18,2),
  add column if not exists taxa        numeric(18,2);

comment on column core.settlement.valor is
  'Liquido: o que entrou ou saiu da conta financeira. Base do fluxo de caixa.';
comment on column core.settlement.valor_bruto is
  'Bruto: quanto da parcela foi quitado. Bate com o campo pago da parcela.';
comment on column core.settlement.taxa is
  'Taxa retida pelo meio de pagamento. Bruto menos liquido.';

-- A despesa financeira das taxas é um custo real e some do DRE se ninguém
-- olhar, porque ela não vira lançamento de despesa no ERP.
create or replace view mart.taxas_mensais with (security_invoker = true) as
select
  s.tenant_id,
  s.connection_id,
  date_trunc('month', s.data_pagamento)::date as mes,
  sum(coalesce(s.taxa, 0))                    as taxa,
  sum(s.valor_bruto)                          as bruto,
  sum(s.valor)                                as liquido,
  count(*) filter (where coalesce(s.taxa, 0) > 0) as baixas_com_taxa
from core.settlement s
where s.data_pagamento is not null
group by 1, 2, 3;
