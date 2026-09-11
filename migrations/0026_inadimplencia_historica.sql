-- 0026 · Inadimplência histórica por cliente
--
-- Pedido da reunião de 11/09. O Conta Azul zera o atraso quando o título é
-- pago: um cliente que paga tudo com quarenta dias de atraso aparece lá igual
-- a um que paga em dia, porque nos dois casos não há nada vencido agora. O
-- histórico de comportamento se perde no momento em que ele mais informa.
--
-- A base para não perder já existia aqui: atraso_medio_dias compara a data da
-- baixa com o vencimento, e baixa não se apaga. O que faltava era a frequência
-- junto da intensidade. Um atraso médio de 5 dias pode ser um cliente que
-- sempre derrapa uma semana, ou um pontualíssimo que atrasou uma vez dois
-- meses. As colunas novas separam esses dois:
--
--   titulos_pagos       quantos títulos do cliente já foram liquidados
--   pagos_com_atraso    quantos desses foram pagos depois do vencimento
--   atraso_maximo_dias  o pior caso, para o "atrasou uma vez dois meses"
--
-- Colunas acrescentadas no fim da lista de propósito: o create or replace de
-- view só aceita acrescentar no fim, sem tocar nas existentes.

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
  avg(b.ultimo_pagamento - i.data_vencimento)                                as atraso_medio_dias,
  count(*) filter (where b.ultimo_pagamento is not null)                     as titulos_pagos,
  count(*) filter (where b.ultimo_pagamento > i.data_vencimento)             as pagos_com_atraso,
  max(b.ultimo_pagamento - i.data_vencimento)                                as atraso_maximo_dias
from core.installment i
left join core.person p          on p.id = i.person_id
left join baixa_por_parcela b    on b.installment_id = i.id
where i.deleted_at is null
  and i.kind = 'receivable'
group by 1, 2, 3, 4, 5;
