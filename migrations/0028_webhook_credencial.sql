-- 0028 · Credencial de webhook por tenant
--
-- Requisito de produto, fixado em 14/09: o DriveAzul é vendido e nada pode
-- depender do João cadastrar coisa nenhuma. O segredo do webhook bancário do
-- TributoStream nasceu como env var global (BANK_WEBHOOK_SECRET), o que
-- funciona para um cliente e não escala para nenhum outro: env var global não
-- tem tenant, não rotaciona por cliente e exige deploy para mudar.
--
-- Esta tabela troca isso por credencial gerada na tela pelo próprio cliente.
-- O endpoint vira /api/webhooks/bank/<id_publico> e o segredo continua indo
-- no cabeçalho, nunca na URL: o id_publico só identifica, quem autentica é o
-- segredo. URL vaza em log de proxy e histórico; cabeçalho não.
--
-- O segredo fica cifrado com o mesmo AES-256-GCM dos tokens da Focus
-- (src/crypto.mjs). Cifrado e não hasheado porque a comparação do webhook é
-- em tempo constante contra o valor decifrado, e porque mostrar o segredo de
-- novo para o cliente que perdeu não é um recurso que queremos: perdeu,
-- revoga e gera outra. A tela mostra uma única vez, na criação.
--
-- A atribuição de tenant muda de dono: antes vinha do CNPJ do recebedor via
-- fiscal_emitente, que só existia se alguém rodasse script. Agora vem da
-- credencial, que o cliente criou sozinho. O CNPJ vira conferência, não
-- requisito.

create table core.webhook_credencial (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references core.tenant(id) on delete cascade,

  -- O que aparece na URL. Aleatório e sem significado, para não vazar nada
  -- sobre o tenant nem ser enumerável.
  id_publico     text not null unique,

  -- AES-256-GCM via src/crypto.mjs, nunca em claro.
  segredo_cifrado text not null,

  -- Para o cliente reconhecer a credencial na lista ('Banco Inter', 'Stone').
  rotulo         text not null default 'Conexão bancária',

  criado_em      timestamptz not null default now(),
  ultimo_uso_em  timestamptz,

  -- Revogar não apaga: a liquidação que entrou por ela continua apontando
  -- para uma credencial que existe, e a lista mostra o histórico.
  revogado_em    timestamptz
);

create index on core.webhook_credencial (tenant_id, criado_em desc);

alter table core.webhook_credencial enable row level security;
create policy tenant_read on core.webhook_credencial
  for select using (core.is_member(tenant_id));

comment on table core.webhook_credencial is
  'Credencial de webhook gerada pelo proprio cliente na tela de conexoes. '
  'id_publico identifica na URL, segredo autentica no cabecalho, cifrado '
  'com AES-256-GCM. Atribui o tenant da liquidacao sem depender de cadastro '
  'manual.';
