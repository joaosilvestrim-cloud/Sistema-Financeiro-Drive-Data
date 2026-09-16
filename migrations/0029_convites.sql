-- 0029 · Convite de usuários pela tela
--
-- Última peça do autosserviço de entrada. O vínculo de usuário a tenant era
-- criado pelo script invite, rodado na nossa máquina, o que quebra a regra
-- de 14/09: nada pode depender de cadastro manual nosso.
--
-- O desenho respeita a restrição de segurança mais antiga do projeto: a
-- SUPABASE_SERVICE_ROLE_KEY não vai para a Vercel, então o app em produção
-- não pode criar usuário pela API administrativa. O convite contorna isso
-- sem enfraquecer nada: o dono registra o e-mail e o papel aqui, o convidado
-- cria a própria conta pelo caminho normal (chave pública + confirmação de
-- e-mail), e no primeiro login o vínculo se faz sozinho, casando por token
-- ou pelo e-mail confirmado. Quem nunca foi convidado segue o fluxo de
-- sempre e ganha tenant próprio.
--
-- O token na URL do convite é aceitável porque convite é portador por
-- definição (o e-mail que o carrega já é o fator), expira em 14 dias e vira
-- inútil depois de aceito ou revogado. O que nunca vai em URL é segredo de
-- autenticação, e o convite não autentica: só liga uma conta nova, já
-- autenticada pelo Supabase, ao tenant certo.

create table core.tenant_convite (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenant(id) on delete cascade,

  -- Sempre minúsculo, gravado assim pela lib. O casamento no primeiro login
  -- compara com o e-mail confirmado pelo Supabase, então caixa alta no
  -- convite não pode impedir o vínculo.
  email         text not null,

  papel         core.member_role not null default 'leitura',
  token         text not null unique,

  convidado_por uuid references auth.users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  expira_em     timestamptz not null default now() + interval '14 days',

  aceito_em     timestamptz,
  aceito_por    uuid references auth.users(id) on delete set null,
  revogado_em   timestamptz,

  -- Dono não entra por convite. Dono nasce criando a conta, e transferir a
  -- propriedade é outra conversa, com outra tela e outra cerimônia.
  constraint convite_sem_dono check (papel <> 'owner')
);

-- Um convite vivo por e-mail por tenant. Reenviar é revogar e criar outro,
-- e o índice garante que dois cliques não viram dois convites.
create unique index tenant_convite_vivo
  on core.tenant_convite (tenant_id, email)
  where aceito_em is null and revogado_em is null;

create index on core.tenant_convite (email) where aceito_em is null and revogado_em is null;

alter table core.tenant_convite enable row level security;
create policy tenant_read on core.tenant_convite
  for select using (core.is_member(tenant_id));

comment on table core.tenant_convite is
  'Convite de usuario para um tenant, criado pelo dono na tela de conexoes. '
  'O convidado cria a conta pelo fluxo publico e o vinculo acontece no '
  'primeiro login, por token ou por e-mail confirmado. Sem service role.';
