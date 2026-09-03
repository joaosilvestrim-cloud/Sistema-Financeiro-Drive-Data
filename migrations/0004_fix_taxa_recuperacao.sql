-- 0004 · Correção da taxa de recuperação
--
-- A versão anterior definia faixas de 0 a 30 e de 31 a 60 dias que o próprio
-- filtro da consulta excluía, já que só entram títulos vencidos há mais de 60
-- dias. Sobravam duas faixas vazias e nenhuma leitura do começo da curva.
--
-- Agora as faixas cobrem a janela que realmente existe, e a taxa "no prazo"
-- sai de uma view própria, medindo quanto dos títulos foi recebido até 30 dias
-- depois do vencimento. É essa taxa que a projeção aplica sobre o que ainda
-- está a vencer.

create or replace view mart.taxa_recuperacao with (security_invoker = true) as
with base as (
  select
    tenant_id,
    connection_id,
    case
      when data_vencimento >= current_date - 90  then 'd61_90'
      when data_vencimento >= current_date - 180 then 'd91_180'
      when data_vencimento >= current_date - 360 then 'd181_360'
      else 'd360_mais'
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

-- Quanto de um título costuma entrar até 30 dias depois do vencimento. É a
-- taxa aplicada ao que ainda está a vencer, e o piso da projeção honesta.
create or replace view mart.taxa_no_prazo with (security_invoker = true) as
with base as (
  select
    i.tenant_id,
    i.connection_id,
    coalesce(i.total, 0) as total,
    coalesce((
      select sum(s.valor) from core.settlement s
       where s.installment_id = i.id
         and s.data_pagamento <= i.data_vencimento + 30
    ), 0) as recebido_no_prazo
  from core.installment i
  where i.deleted_at is null
    and i.kind = 'receivable'
    and i.data_vencimento between current_date - interval '18 months' and current_date - 45
)
select
  tenant_id, connection_id,
  sum(total)             as total,
  sum(recebido_no_prazo) as recebido,
  round(sum(recebido_no_prazo) / nullif(sum(total), 0), 4) as taxa
from base
group by 1, 2;
