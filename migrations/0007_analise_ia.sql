-- 0007 · Análise gerada por IA
--
-- A análise é guardada junto com o dossiê de fatos que a gerou, e com o modelo
-- que a escreveu. Sem isso não há como responder à única pergunta que importa
-- quando alguém discorda do texto: "de onde saiu isso?".
--
-- Guardar também evita gerar de novo a cada carregamento de tela, o que
-- custaria dinheiro e, pior, daria um texto diferente a cada visita para o
-- mesmo mês fechado.

create table core.ai_analysis (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenant(id) on delete cascade,
  connection_id uuid references core.connection(id) on delete cascade,
  -- 'mensal' fecha o mês, 'situacao' olha o momento atual.
  tipo          text not null check (tipo in ('mensal', 'situacao')),
  competencia   text not null,
  texto         text not null,
  -- O dossiê exato que foi enviado ao modelo.
  fatos         jsonb not null,
  modelo        text not null,
  tokens        int,
  criado_em     timestamptz not null default now(),
  criado_por    uuid references auth.users(id),
  unique (tenant_id, connection_id, tipo, competencia)
);

create index on core.ai_analysis (tenant_id, criado_em desc);

alter table core.ai_analysis enable row level security;
create policy tenant_read on core.ai_analysis for select using (core.is_member(tenant_id));
