-- 0027 · TributoStream: conciliação de split payment
--
-- A Reforma Tributária muda o momento em que o imposto sai do caixa. Com o
-- split payment, a liquidação do Pix, do boleto ou do cartão já chega dividida:
-- a parcela do imposto vai ao Fisco na hora e só o líquido cai na conta. O
-- float acabou. E o banco decide QUANTO reter com base no que ele consegue
-- cruzar no instante da transação. Sem dado casado, ele aplica o split
-- simplificado, com alíquota de referência genérica, que quase sempre retém
-- mais do que a nota manda.
--
-- Este módulo existe para uma pergunta só: o valor retido na fonte bate com o
-- imposto calculado na NFe? Para responder, ele cruza três pontas que o
-- DriveAzul já tem ou passa a ter:
--
--   1. o título a receber          core.installment       (vem do Conta Azul)
--   2. a nota fiscal               core.fiscal_documento   (vem da Focus NFe)
--   3. a liquidação bancária       core.split_liquidacao   (nasce aqui)
--
-- A chave que amarra tudo é o idRepasse, o identificador transacional de
-- segregação que o arranjo de pagamento carrega de ponta a ponta.
--
-- Desenho em duas camadas, igual ao resto do sistema. A raw guarda o payload
-- como chegou, sem interpretação, porque webhook de banco não se pede de novo:
-- o que se perdeu na ingestão se perdeu de vez. A core guarda a leitura
-- normalizada, com FK para o título e para a nota. Se a normalização tiver um
-- bug, a raw permite reprocessar sem depender de reenvio de ninguém.

-- ------------------------------------------------------------- camada raw

-- Ingestão bruta. A rota do webhook só valida o segredo, calcula o hash e
-- grava aqui. Interpretação nenhuma acontece no caminho da requisição, porque
-- o banco tem timeout curto e reenvia o que falhou: a rota precisa ser burra
-- e rápida.
create table raw.split_webhook (
  id             bigserial primary key,

  -- Nulo é permitido de propósito. A atribuição de tenant é uma leitura do
  -- payload, e leitura pode falhar. Aviso órfão a gente investiga depois;
  -- aviso recusado por não ter dono some para sempre.
  tenant_id      uuid references core.tenant(id) on delete cascade,

  -- De onde veio: 'adquirente' (webhook) ou 'cnab' (retorno de arquivo).
  fonte          text not null,

  -- Extraído best-effort já na ingestão, só para facilitar busca. A verdade
  -- normalizada mora na core.
  id_repasse     text,

  -- Dedupe. Adquirente reenvia webhook que não recebeu 200, e reenvio não
  -- pode virar liquidação dupla.
  hash           text not null,

  payload        jsonb not null,
  recebido_em    timestamptz not null default now(),
  processado_em  timestamptz,
  erro           text
);

create unique index on raw.split_webhook (fonte, hash);
create index on raw.split_webhook (tenant_id, recebido_em desc);
create index on raw.split_webhook (processado_em) where processado_em is null;

-- Igual à raw.api_payload: RLS ligada e nenhuma policy. A camada raw é uso
-- interno do worker; o app não lê daqui.
alter table raw.split_webhook enable row level security;

-- ------------------------------------------------------------- camada core

-- Uma linha por evento de liquidação, já normalizada. É aqui que as três
-- pontas se encontram: installment_id (título), fiscal_documento_id (nota) e
-- id_repasse (a chave do arranjo de pagamento).
create table core.split_liquidacao (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references core.tenant(id) on delete cascade,
  connection_id        uuid references core.connection(id) on delete set null,

  -- De onde esta leitura saiu. set null e não cascade: apagar o bruto não
  -- pode apagar a liquidação, que é fato contábil.
  raw_id               bigint references raw.split_webhook(id) on delete set null,

  -- A chave transacional de segregação. Única por tenant: o mesmo repasse
  -- reprocessado atualiza a linha, não cria outra.
  id_repasse           text not null,

  -- As outras duas pontas. Nulas até a conciliação casar, porque a liquidação
  -- chega primeiro e o casamento é assíncrono.
  installment_id       uuid references core.installment(id) on delete set null,
  fiscal_documento_id  uuid references core.fiscal_documento(id) on delete set null,

  meio_pagamento       text,
  adquirente           text,

  -- O dinheiro. bruto = liquido + retido, e o banco confere isso na entrada
  -- para pegar payload mal formado antes de ele virar análise errada.
  valor_bruto          numeric(18,2) not null,
  valor_liquido        numeric(18,2) not null,
  valor_retido         numeric(18,2) not null,
  constraint split_soma_fecha check (valor_bruto = valor_liquido + valor_retido),

  -- O que o banco aplicou. 'simplificado' é o sinal de alerta do módulo:
  -- significa que o cruzamento em tempo real falhou e a alíquota de
  -- referência provavelmente reteve a mais.
  tipo_split           text not null default 'desconhecido'
                       check (tipo_split in ('inteligente', 'simplificado', 'desconhecido')),
  aliquota_aplicada    numeric(9,6),

  -- O imposto que a NFe manda reter. Preenchido pela conciliação, quando a
  -- nota é encontrada. A divergência é valor_retido menos isto.
  imposto_nfe          numeric(18,2),

  -- Vida da linha: recebido -> conciliado | divergente, ou orfao quando não
  -- se achou título nem nota para casar.
  situacao             text not null default 'recebido'
                       check (situacao in ('recebido', 'conciliado', 'divergente', 'orfao')),

  liquidado_em         timestamptz not null,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),

  unique (tenant_id, id_repasse)
);

create index on core.split_liquidacao (tenant_id, situacao);
create index on core.split_liquidacao (tenant_id, liquidado_em desc);
create index on core.split_liquidacao (installment_id);
create index on core.split_liquidacao (fiscal_documento_id);

-- Anomalia detectada e a vida dela. Separada da liquidação porque uma
-- liquidação pode ter mais de um problema ao mesmo tempo (retenção maior E
-- alíquota de referência), e porque anomalia tem ciclo próprio: alguém abre,
-- investiga e resolve, sem mexer no fato.
create table core.split_divergencia (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references core.tenant(id) on delete cascade,
  liquidacao_id   uuid not null references core.split_liquidacao(id) on delete cascade,

  tipo            text not null check (tipo in (
                    'retencao_maior',       -- banco reteve mais que a NFe manda
                    'retencao_menor',       -- reteve menos: passivo escondido
                    'split_simplificado',   -- caiu na alíquota de referência
                    'sem_nota',             -- liquidou sem NFe correspondente
                    'sem_titulo'            -- liquidou sem título no ERP
                  )),

  valor_esperado  numeric(18,2),
  valor_retido    numeric(18,2),
  diferenca       numeric(18,2),

  detectado_em    timestamptz not null default now(),
  resolvido_em    timestamptz,
  resolucao       text
);

-- Uma anomalia aberta de cada tipo por liquidação. O reprocessamento roda
-- quantas vezes precisar sem duplicar o alerta.
create unique index split_divergencia_aberta
  on core.split_divergencia (liquidacao_id, tipo)
  where resolvido_em is null;

create index on core.split_divergencia (tenant_id, detectado_em desc)
  where resolvido_em is null;

-- ------------------------------------------------------------------- RLS
-- Mesmo contrato do resto da core: o app conecta com role própria via pooler
-- e passa por cima da RLS; as policies existem para qualquer acesso futuro
-- via PostgREST e para o segurancateste provar que anon e authenticated não
-- leem nada daqui.

alter table core.split_liquidacao enable row level security;
create policy tenant_read on core.split_liquidacao
  for select using (core.is_member(tenant_id));

alter table core.split_divergencia enable row level security;
create policy tenant_read on core.split_divergencia
  for select using (core.is_member(tenant_id));

comment on table raw.split_webhook is
  'Ingestao bruta dos avisos de liquidacao (webhook de adquirente ou retorno '
  'CNAB). A rota grava aqui sem interpretar; o processamento vem depois.';
comment on table core.split_liquidacao is
  'Evento de liquidacao com split payment, normalizado. Une o titulo do ERP, '
  'a NFe da Focus e o idRepasse do arranjo de pagamento, e guarda o retido '
  'contra o imposto da nota.';
comment on table core.split_divergencia is
  'Anomalia entre o retido na fonte e o imposto da NFe, com ciclo de vida '
  'proprio (detectada, investigada, resolvida).';
