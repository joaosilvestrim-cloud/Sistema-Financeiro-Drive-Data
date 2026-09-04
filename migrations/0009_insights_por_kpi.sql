-- 0009 · Leitura da IA por indicador
--
-- Uma linha guarda todos os bullets de uma vez, num jsonb com uma chave por
-- indicador. Não é economia de tabela: é economia de chamada.
--
-- Um bullet por indicador com uma chamada por indicador seriam mais de dez
-- chamadas por carregamento de tela. O plano da Groq permite cerca de duas por
-- minuto, e cada uma custa. Uma chamada só produz todos os bullets, com a
-- vantagem de que eles saem coerentes entre si: o modelo vê o conjunto e não
-- diz que o caixa está confortável num bullet e apertado no outro.
--
-- A tela de perguntas em linguagem natural foi removida a pedido, então a
-- tabela dela sai junto. O código está no histórico do git se voltar a fazer
-- sentido.

drop table if exists core.ai_question;

create table core.ai_insight (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenant(id) on delete cascade,
  connection_id uuid references core.connection(id) on delete cascade,
  -- Referência do dado que gerou os bullets. Enquanto ela não muda, o texto
  -- guardado continua valendo e nenhuma chamada nova é feita.
  referencia    text not null,
  bullets       jsonb not null,
  fatos         jsonb not null,
  modelo        text not null,
  tokens        int,
  criado_em     timestamptz not null default now(),
  unique (tenant_id, connection_id, referencia)
);

create index on core.ai_insight (tenant_id, criado_em desc);

alter table core.ai_insight enable row level security;
create policy tenant_read on core.ai_insight for select using (core.is_member(tenant_id));
