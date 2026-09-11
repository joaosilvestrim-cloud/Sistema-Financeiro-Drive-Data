-- 0025 · Limite de cartão não é saldo, e o "a vencer" de longo prazo sai do resumo
--
-- Dois achados da reunião de 11/09, os dois de quem olha número todo dia.
--
-- O primeiro é da Tamires: "quero ver o que eu tenho de dinheiro, dinheiro
-- meu". O Conta Azul devolve o cartão de crédito como uma conta com saldo, e a
-- soma tratava esse valor como dinheiro disponível. Não é: é limite, dinheiro
-- do banco que ainda vai virar fatura. Na base de hoje eram R$ 9.619 do Cartão
-- Drive Data inflando o caixa em todas as telas ao mesmo tempo, porque tudo
-- parte desta view.
--
-- A conta continua aparecendo nas listas, marcada como o que é. Só não soma.
--
-- O segundo é do Diogo: o "a vencer" do aging misturava a semana que vem com
-- 2027. Como eles lançam venda projetada com vencimento longe, o número
-- parecia dizer que há R$ 600 mil chegando, quando a maior parte é projeção de
-- contrato. "Pensa numa pessoa fazendo o budget dela." A faixa se divide:
-- a_vencer é o que vence em até 90 dias, a_vencer_longe é o resto. O resumo
-- executivo mostra a primeira; as telas de detalhe mostram as duas.
--
-- A expressão da faixa é a mesma usada em titulosPorFaixa (lib/executivo.js),
-- copiada verbatim, e o detalheteste confere as duas ao centavo. Se uma mudar
-- sem a outra, o teste quebra antes do cliente perceber.

create or replace view mart.kpi_overview with (security_invoker = true) as
with ultimo_snapshot as (
  select connection_id, max(snapshot_date) as snapshot_date
    from core.account_balance_snapshot
   group by 1
),
saldo as (
  -- Soma das contas na foto mais recente de cada conexão. Cartão de crédito
  -- fica fora: o "saldo" dele é limite, não dinheiro.
  select b.tenant_id, b.connection_id, u.snapshot_date,
         sum(b.saldo) filter (where a.tipo is distinct from 'CARTAO_CREDITO') as saldo
    from core.account_balance_snapshot b
    join core.account a on a.id = b.account_id
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
  round((coalesce(c.saidas_90d, 0) - coalesce(c.entradas_90d, 0)) / 90.0, 2) as burn_diario,
  case
    when coalesce(c.saidas_90d, 0) - coalesce(c.entradas_90d, 0) <= 0 then null
    else floor(coalesce(s.saldo, 0) /
         ((coalesce(c.saidas_90d, 0) - coalesce(c.entradas_90d, 0)) / 90.0))
  end                                                        as runway_dias
from titulos t
left join saldo   s on s.connection_id = t.connection_id
left join caixa_90 c on c.connection_id = t.connection_id;

-- ------------------------------------------------------------------ aging

create or replace view mart.aging_snapshot with (security_invoker = true) as
select
  i.tenant_id,
  i.connection_id,
  i.kind,
  case
    when i.data_vencimento > current_date + 90 then 'a_vencer_longe'
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
