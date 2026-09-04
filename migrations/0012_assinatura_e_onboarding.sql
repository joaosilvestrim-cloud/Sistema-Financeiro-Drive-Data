-- 0012 · Assinatura e primeira carga
--
-- Duas coisas que faltavam para alguém de fora conseguir comprar sozinho.
--
-- 1. O tenant precisa saber em que situação comercial está. Sem isso não existe
--    teste grátis, não existe fim de teste e não existe bloqueio por falta de
--    pagamento.
--
-- 2. A carga inicial precisa ser retomável. São 36 meses de janela, vezes dois
--    tipos de parcela, e isso não cabe numa função serverless que morre em
--    alguns minutos. Guardando a posição, cada chamada avança um pedaço e a
--    tela mostra progresso de verdade em vez de uma ampulheta.

alter table core.tenant
  add column plano          text not null default 'trial'
                            check (plano in ('trial', 'essencial', 'profissional', 'escritorio')),
  -- Fim do teste. Nulo quer dizer que não está em teste, seja porque já assina
  -- ou porque é conta interna.
  add column trial_ate      timestamptz,
  add column status         text not null default 'ativo'
                            check (status in ('ativo', 'expirado', 'inadimplente', 'cancelado')),
  add column limite_empresas int not null default 1,
  -- Quem criou a conta e de onde veio. Serve para saber se a loja da Conta Azul
  -- traz cliente de verdade ou só visita.
  add column origem         text;

-- As contas que já existiam são internas e não devem virar teste vencido.
update core.tenant set plano = 'profissional', limite_empresas = 5, trial_ate = null;

-- ------------------------------------------------------------ primeira carga

create table core.onboarding_job (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenant(id) on delete cascade,
  connection_id uuid not null references core.connection(id) on delete cascade,
  status        text not null default 'pendente'
                check (status in ('pendente', 'rodando', 'concluido', 'erro')),
  -- Etapa atual. A ordem importa: sem as dimensões carregadas, a parcela não
  -- tem em que se ligar.
  etapa         text not null default 'dimensoes'
                check (etapa in ('dimensoes', 'receivable', 'payable', 'saldos', 'fim')),
  -- Índice da janela mensal dentro da etapa. É o que torna a carga retomável.
  janela        int not null default 0,
  janelas_total int not null default 0,
  itens         int not null default 0,
  erro          text,
  -- Trava de execução. Duas abas abertas na tela de progresso disparariam duas
  -- cargas ao mesmo tempo, e o mesmo mês entraria duas vezes na fila de rede.
  lease_ate     timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (connection_id)
);

create index on core.onboarding_job (tenant_id, criado_em desc);

alter table core.onboarding_job enable row level security;
create policy tenant_read on core.onboarding_job
  for select using (core.is_member(tenant_id));
