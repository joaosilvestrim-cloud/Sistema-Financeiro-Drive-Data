-- 0011 · Importação de fatura de cartão
--
-- Guarda o que já foi enviado ao ERP, com a impressão digital de cada linha da
-- fatura. Duas razões, e a segunda é a que importa:
--
-- 1. A API de contas a pagar responde 202 com um protocolo, não com o
--    lançamento pronto. O status real vem depois, consultando o protocolo.
--
-- 2. Não existe endpoint para apagar um evento financeiro. Uma linha enviada
--    duas vezes vira despesa duplicada no ERP, e o conserto é manual, na mão,
--    dentro do Conta Azul. A impressão digital impede reenviar a mesma linha,
--    mesmo que a pessoa suba o mesmo arquivo de novo.

create table core.card_import (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenant(id) on delete cascade,
  connection_id uuid not null references core.connection(id) on delete cascade,
  -- Data, descrição e valor da linha, normalizados. É o que identifica a compra
  -- de forma estável entre um arquivo e outro.
  impressao     text not null,
  data_compra   date not null,
  descricao     text not null,
  valor         numeric(18,2) not null,
  categoria_id  uuid references core.category(id),
  protocolo     text,
  status        text not null default 'enviado'
                check (status in ('enviado', 'confirmado', 'erro')),
  erro          text,
  criado_em     timestamptz not null default now(),
  criado_por    uuid references auth.users(id),
  unique (connection_id, impressao)
);

create index on core.card_import (tenant_id, criado_em desc);

alter table core.card_import enable row level security;
create policy tenant_read on core.card_import for select using (core.is_member(tenant_id));
