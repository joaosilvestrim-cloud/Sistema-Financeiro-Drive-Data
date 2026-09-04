-- 0013 · Cobrança, sem o gateway
--
-- O gateway entra depois. O que fica pronto aqui é tudo o que não depende de
-- qual empresa vai processar o cartão: onde guardar o vínculo, como registrar o
-- que o gateway avisou, e como não aplicar o mesmo aviso duas vezes.
--
-- Gateway nenhum promete entregar o evento uma vez só. Todos reenviam quando
-- não recebem confirmação, e reenviam de novo depois. Sem uma chave única por
-- evento, um "pagamento aprovado" repetido viraria dois meses de plano, e um
-- "assinatura cancelada" atrasado desligaria um cliente que já voltou. Por isso
-- o log de evento nasce junto com os campos, e não depois.

alter table core.tenant
  add column gateway              text,
  add column gateway_customer_id  text,
  add column gateway_assinatura_id text,
  -- Até quando o acesso está pago. Fica separado de trial_ate porque um cliente
  -- pode cancelar e continuar com direito de uso até o fim do ciclo já pago.
  add column acesso_ate           timestamptz,
  -- Plano que a pessoa escolheu na tela mas ainda não pagou. Enquanto não
  -- existe gateway, é isto que registra a intenção de compra.
  add column plano_desejado       text
                                  check (plano_desejado in ('essencial', 'profissional', 'escritorio')),
  add column plano_desejado_em    timestamptz;

create index on core.tenant (gateway_assinatura_id) where gateway_assinatura_id is not null;

-- Tudo o que o gateway mandou, na ordem em que chegou, com o corpo cru.
--
-- O corpo cru fica porque quando a cobrança de alguém der errado, a pergunta vai
-- ser "o que exatamente eles nos disseram", e a resposta não pode depender de
-- ter acertado o mapeamento na primeira tentativa.
create table core.billing_event (
  id            uuid primary key default gen_random_uuid(),
  gateway       text not null,
  -- Id do evento no gateway. É a trava contra reenvio.
  evento_id     text not null,
  tipo          text not null,
  tenant_id     uuid references core.tenant(id) on delete set null,
  payload       jsonb not null,
  aplicado      boolean not null default false,
  erro          text,
  recebido_em   timestamptz not null default now(),
  unique (gateway, evento_id)
);

create index on core.billing_event (tenant_id, recebido_em desc);

alter table core.billing_event enable row level security;
-- Sem policy de leitura de propósito. Evento de cobrança é do operador, não do
-- cliente, e a tela do cliente não tem por que mostrar payload de gateway.
