-- 0008 · Perguntas respondidas pela IA
--
-- Cada pergunta guarda a resposta e o dossiê de fatos que estava disponível na
-- hora. Duas razões:
--
-- 1. Auditoria. Se alguém tomar uma decisão com base numa resposta, dá para
--    reconstruir exatamente o que a IA tinha em mãos.
-- 2. Aprendizado. A lista do que as pessoas perguntam mostra qual indicador
--    falta na tela. Pergunta repetida é tela que deveria existir.

create table core.ai_question (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenant(id) on delete cascade,
  connection_id uuid references core.connection(id) on delete cascade,
  pergunta      text not null,
  resposta      text not null,
  fatos         jsonb not null,
  modelo        text not null,
  tokens        int,
  criado_por    uuid references auth.users(id),
  criado_em     timestamptz not null default now()
);

create index on core.ai_question (tenant_id, criado_em desc);

alter table core.ai_question enable row level security;
create policy tenant_read on core.ai_question for select using (core.is_member(tenant_id));
