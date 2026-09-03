-- 0001 · Fundação do Sistema Financeiro DriveData
--
-- Três camadas:
--   raw   payload cru da API, imutável, permite reprocessar sem rebuscar
--   core  normalizado e versionado
--   mart  agregado para leitura (criado na fase 2)
--
-- Regra que vale para tudo: um tenant tem N conexões, uma conexão é uma empresa
-- autorizada no ERP. Os ids externos só são únicos dentro de uma conexão, então
-- a chave natural é sempre (connection_id, external_id).

create schema if not exists raw;
create schema if not exists core;
create schema if not exists mart;

-- ---------------------------------------------------------------- tenants

create table core.tenant (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

create type core.member_role as enum ('owner', 'financeiro', 'leitura', 'contador');

create table core.tenant_member (
  tenant_id  uuid not null references core.tenant(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       core.member_role not null default 'leitura',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- Usada nas policies. security definer para poder ler tenant_member sem recursão de RLS.
create or replace function core.is_member(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1 from core.tenant_member m
    where m.tenant_id = p_tenant and m.user_id = auth.uid()
  );
$$;

-- ------------------------------------------------------------ conexões

create type core.connection_status as enum ('connected', 'expired', 'revoked', 'error');

create table core.connection (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references core.tenant(id) on delete cascade,
  provider              text not null default 'contaazul',
  nome                  text not null,
  external_company_id   text,
  status                core.connection_status not null default 'connected',
  -- Tokens cifrados na aplicação com AES-256-GCM. A chave mora no ambiente do
  -- worker, nunca no banco. Ver src/crypto.mjs.
  access_token_enc      text,
  refresh_token_enc     text,
  token_expires_at      timestamptz,
  sync_interval_minutes int not null default 60,
  last_sync_at          timestamptz,
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, provider, external_company_id)
);

create index on core.connection (tenant_id);
create index on core.connection (status, last_sync_at);

-- ------------------------------------------------------- controle de sync

create table core.sync_run (
  id            bigserial primary key,
  connection_id uuid not null references core.connection(id) on delete cascade,
  kind          text not null check (kind in ('backfill', 'incremental', 'reconcile')),
  status        text not null default 'running' check (status in ('running', 'ok', 'error')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  requests      int not null default 0,
  items         int not null default 0,
  error         text,
  detail        jsonb not null default '{}'::jsonb
);

create index on core.sync_run (connection_id, started_at desc);

-- Marca até onde cada recurso já foi sincronizado. O incremental parte daqui.
create table core.sync_watermark (
  connection_id uuid not null references core.connection(id) on delete cascade,
  resource      text not null,
  value         timestamptz not null,
  updated_at    timestamptz not null default now(),
  primary key (connection_id, resource)
);

-- ------------------------------------------------------------- camada raw

create table raw.api_payload (
  id            bigserial primary key,
  tenant_id     uuid not null references core.tenant(id) on delete cascade,
  connection_id uuid not null references core.connection(id) on delete cascade,
  resource      text not null,
  external_id   text not null,
  hash          text not null,
  payload       jsonb not null,
  fetched_at    timestamptz not null default now()
);

create index on raw.api_payload (connection_id, resource, external_id, fetched_at desc);
-- Salvar um registro sem alterar nada gera entrada no histórico da Conta Azul.
-- O hash evita gravar versão nova quando o conteúdo é idêntico.
create unique index on raw.api_payload (connection_id, resource, external_id, hash);

-- ------------------------------------------------------------- dimensões

create table core.account (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenant(id) on delete cascade,
  connection_id uuid not null references core.connection(id) on delete cascade,
  external_id   text not null,
  nome          text,
  tipo          text,
  ativo         boolean,
  saldo_inicial numeric(18,2),
  updated_at    timestamptz not null default now(),
  unique (connection_id, external_id)
);

create table core.category (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references core.tenant(id) on delete cascade,
  connection_id       uuid not null references core.connection(id) on delete cascade,
  external_id         text not null,
  nome                text,
  tipo                text,
  parent_external_id  text,
  entrada_dre         text,
  considera_custo_dre boolean,
  updated_at          timestamptz not null default now(),
  unique (connection_id, external_id)
);

create table core.dre_category (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenant(id) on delete cascade,
  connection_id uuid not null references core.connection(id) on delete cascade,
  external_id   text not null,
  nome          text,
  ordem         int,
  updated_at    timestamptz not null default now(),
  unique (connection_id, external_id)
);

create table core.cost_center (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenant(id) on delete cascade,
  connection_id uuid not null references core.connection(id) on delete cascade,
  external_id   text not null,
  codigo        text,
  nome          text,
  ativo         boolean,
  updated_at    timestamptz not null default now(),
  unique (connection_id, external_id)
);

create table core.person (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenant(id) on delete cascade,
  connection_id uuid not null references core.connection(id) on delete cascade,
  external_id   text not null,
  nome          text,
  documento     text,
  tipo_pessoa   text,
  perfis        text[],
  email         text,
  updated_at    timestamptz not null default now(),
  unique (connection_id, external_id)
);

create index on core.person (tenant_id, documento);

-- Plano de contas canônico do tenant. É o que torna o consolidado de várias
-- empresas possível, já que cada empresa tem a sua própria árvore de categorias.
create table core.canonical_category (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references core.tenant(id) on delete cascade,
  nome        text not null,
  tipo        text not null check (tipo in ('RECEITA', 'DESPESA')),
  grupo_dre   text,
  ordem       int not null default 0,
  unique (tenant_id, nome)
);

create table core.category_map (
  category_id           uuid primary key references core.category(id) on delete cascade,
  canonical_category_id uuid not null references core.canonical_category(id) on delete cascade,
  tenant_id             uuid not null references core.tenant(id) on delete cascade,
  origem                text not null default 'manual' check (origem in ('manual', 'sugerido')),
  created_at            timestamptz not null default now()
);

-- --------------------------------------------------------------- movimento

create type core.event_kind as enum ('receivable', 'payable');

create table core.financial_event (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references core.tenant(id) on delete cascade,
  connection_id  uuid not null references core.connection(id) on delete cascade,
  external_id    text not null,
  kind           core.event_kind not null,
  data_alteracao timestamptz,
  last_seen_at   timestamptz not null default now(),
  unique (connection_id, external_id)
);

create table core.installment (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references core.tenant(id) on delete cascade,
  connection_id      uuid not null references core.connection(id) on delete cascade,
  external_id        text not null,
  event_external_id  text,
  kind               core.event_kind not null,
  descricao          text,
  data_vencimento    date,
  data_competencia   date,
  status             text,
  status_traduzido   text,
  total              numeric(18,2),
  pago               numeric(18,2),
  nao_pago           numeric(18,2),
  person_id          uuid references core.person(id),
  account_id         uuid references core.account(id),
  category_id        uuid references core.category(id),
  cost_center_id     uuid references core.cost_center(id),
  data_criacao       timestamptz,
  data_alteracao     timestamptz,
  hash               text not null,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (connection_id, external_id)
);

create index on core.installment (tenant_id, kind, data_vencimento);
create index on core.installment (tenant_id, kind, data_competencia);
create index on core.installment (connection_id, status);
create index on core.installment (tenant_id, person_id);
create index on core.installment (connection_id, event_external_id);

-- SCD tipo 2. É daqui que sai o diferencial do produto: comparar o que estava
-- previsto num momento passado com o que de fato aconteceu.
create table core.installment_version (
  id               bigserial primary key,
  installment_id   uuid not null references core.installment(id) on delete cascade,
  tenant_id        uuid not null references core.tenant(id) on delete cascade,
  connection_id    uuid not null references core.connection(id) on delete cascade,
  valid_from       timestamptz not null default now(),
  valid_to         timestamptz,
  data_vencimento  date,
  data_competencia date,
  status           text,
  total            numeric(18,2),
  pago             numeric(18,2),
  nao_pago         numeric(18,2),
  hash             text not null
);

create index on core.installment_version (installment_id, valid_from desc);
create unique index on core.installment_version (installment_id)
  where valid_to is null;

-- Baixa. É o regime de caixa de verdade.
create table core.settlement (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references core.tenant(id) on delete cascade,
  connection_id   uuid not null references core.connection(id) on delete cascade,
  external_id     text not null,
  installment_id  uuid references core.installment(id) on delete cascade,
  data_pagamento  date,
  valor           numeric(18,2),
  juros           numeric(18,2),
  desconto        numeric(18,2),
  account_id      uuid references core.account(id),
  hash            text not null,
  last_seen_at    timestamptz not null default now(),
  unique (connection_id, external_id)
);

create index on core.settlement (tenant_id, data_pagamento);
create index on core.settlement (installment_id);

create table core.transfer (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references core.tenant(id) on delete cascade,
  connection_id  uuid not null references core.connection(id) on delete cascade,
  external_id    text not null,
  data           date,
  valor          numeric(18,2),
  origem_id      uuid references core.account(id),
  destino_id     uuid references core.account(id),
  hash           text not null,
  unique (connection_id, external_id)
);

-- Foto diária do saldo. Serve de âncora para conferir o fluxo de caixa calculado.
create table core.account_balance_snapshot (
  tenant_id     uuid not null references core.tenant(id) on delete cascade,
  connection_id uuid not null references core.connection(id) on delete cascade,
  account_id    uuid not null references core.account(id) on delete cascade,
  snapshot_date date not null,
  saldo         numeric(18,2) not null,
  captured_at   timestamptz not null default now(),
  primary key (account_id, snapshot_date)
);

-- ------------------------------------------------------------------- RLS
-- O worker conecta como postgres e passa por cima da RLS. A RLS existe para o
-- acesso do app via PostgREST e chave anon.

do $$
declare t text;
begin
  foreach t in array array[
    'tenant_member', 'connection', 'account', 'category', 'dre_category',
    'cost_center', 'person', 'canonical_category', 'category_map',
    'financial_event', 'installment', 'installment_version', 'settlement',
    'transfer', 'account_balance_snapshot'
  ] loop
    execute format('alter table core.%I enable row level security', t);
    execute format(
      'create policy tenant_read on core.%I for select using (core.is_member(tenant_id))', t
    );
  end loop;
end $$;

alter table core.tenant enable row level security;
create policy tenant_read on core.tenant for select using (core.is_member(id));

alter table core.sync_run enable row level security;
create policy tenant_read on core.sync_run for select using (
  exists (select 1 from core.connection c
          where c.id = sync_run.connection_id and core.is_member(c.tenant_id))
);

alter table raw.api_payload enable row level security;
-- Camada raw é uso interno do worker. Nenhuma policy de leitura para o app.
