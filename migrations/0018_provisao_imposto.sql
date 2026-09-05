-- 0018 · Provisão de imposto sobre o faturamento
--
-- Pedido da Tamires em 05/09: provisionar o imposto do mês com base no contas a
-- receber do mês anterior, a 12% pelo Anexo III, podendo marcar clientes do
-- Anexo V a 15%. Hoje só a PepsiCo e a Unilever são Anexo V.
--
-- Duas coisas ficam configuráveis de propósito.
--
-- A alíquota, porque o Simples Nacional é progressivo sobre a receita dos
-- últimos 12 meses. Os 12% e 15% são a alíquota efetiva de hoje, não uma
-- constante da lei, e vão mudar quando o faturamento mudar de faixa. Number
-- cravado no código viraria erro silencioso no dia que a empresa subir de
-- faixa.
--
-- E o anexo por cliente, porque o que decide não é a empresa, é a atividade
-- prestada e o fator R de cada contrato. A classificação é uma decisão de quem
-- entende do assunto, então ela é dado, não regra.

alter table core.tenant
  add column aliquota_anexo_iii numeric(6,3) not null default 12,
  add column aliquota_anexo_v   numeric(6,3) not null default 15,
  -- O anexo de quem não foi classificado. A maioria cai aqui, e por isso o
  -- padrão existe: obrigar a classificar 37 clientes para ver o primeiro número
  -- faria ninguém usar a tela.
  add column anexo_padrao       text not null default 'III'
                                check (anexo_padrao in ('III', 'V'));

create table core.cliente_regime (
  tenant_id     uuid not null references core.tenant(id) on delete cascade,
  person_id     uuid not null references core.person(id) on delete cascade,
  anexo         text not null check (anexo in ('III', 'V')),
  observacao    text,
  definido_por  uuid references auth.users(id),
  atualizado_em timestamptz not null default now(),
  primary key (tenant_id, person_id)
);

alter table core.cliente_regime enable row level security;
create policy tenant_read on core.cliente_regime
  for select using (core.is_member(tenant_id));
