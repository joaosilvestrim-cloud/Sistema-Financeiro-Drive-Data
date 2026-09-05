-- 0020 · Emissão de documento fiscal pelo DriveAzul
--
-- Pedido do Diogo na reunião de 04/09: emitir nota de dentro da plataforma, e
-- não em produto separado. "Meu cliente, se quiser emitir nota aqui, já manda
-- para o Conta Azul, já manda para a contabilidade."
--
-- O fornecedor é a Focus NFe, que é REST, tem ambiente de homologação, avisa
-- por webhook e cobre NFe, NFCe, NFSe, CTe, MDFe e NFCom com o mesmo token. O
-- oposto da Conta Azul, que não tem webhook nenhum e nos obrigou a varrer.
--
-- Três decisões que o desenho abaixo grava.
--
-- 1. O CERTIFICADO NÃO MORA AQUI. O arquivo A1 do cliente sobe pela tela, é
--    convertido em base64, vai para a Focus na mesma requisição e é descartado.
--    Nunca toca o disco nem esta tabela. O que fica é metadado: o CNPJ que o
--    certificado provou e a data em que ele vence. Um dump deste banco não dá a
--    ninguém o poder de assinar nota em nome de empresa nenhuma, e isso é
--    argumento de venda, não só higiene.
--
-- 2. A REFERÊNCIA É NOSSA. A Focus identifica cada documento por uma `ref` que
--    quem chama escolhe, e recusa duas emissões com a mesma. Isso é chave de
--    idempotência de graça: se a rede cair no meio, reenviar a mesma ref não
--    emite nota duplicada, devolve a que já existe. Gerar a ref aqui, com
--    unicidade garantida pelo banco, é o que faz o botão "emitir" ser seguro de
--    apertar duas vezes.
--
-- 3. O MDFe TEM CICLO DE VIDA, NÃO SÓ EMISSÃO. Ele precisa ser encerrado
--    quando a carga chega, por evento separado, e MDFe aberto e esquecido é
--    problema de fiscalização. Por isso existe `encerrado_em` e não só status:
--    dá para perguntar ao banco quais manifestos estão viajando há tempo demais.

-- --------------------------------------------------------------- tipos

create type core.fiscal_tipo as enum
  ('nfse', 'nfse_nacional', 'nfe', 'nfce', 'cte', 'mdfe');

create type core.fiscal_status as enum
  ('rascunho', 'processando', 'autorizado', 'cancelado', 'encerrado', 'erro');

-- ------------------------------------------------------- conta no emissor
--
-- Uma conta é um token da Focus. Duas origens possíveis, de propósito.
--
-- Com tenant_id nulo, é a conta da plataforma: o plano com CNPJ ilimitado que a
-- DriveData contrata uma vez e sob o qual todo cliente vira uma empresa. É o
-- modelo que o Diogo desenhou, e é o que faz o produto ter margem.
--
-- Com tenant_id preenchido, é a conta do próprio cliente, para quem já paga a
-- Focus e não quer intermediário. Custa uma coluna suportar os dois, e não
-- suportar custaria perder o cliente que já tem contrato.
create table core.fiscal_conta (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references core.tenant(id) on delete cascade,
  provider      text not null default 'focusnfe',
  ambiente      text not null default 'homologacao'
                check (ambiente in ('homologacao', 'producao')),
  -- Cifrado com AES-256-GCM pela aplicação, igual aos tokens da Conta Azul. A
  -- chave está no ambiente, nunca no banco. Ver src/crypto.mjs.
  token_enc     text not null,
  rotulo        text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Uma conta de plataforma por ambiente, e uma conta própria por tenant e
-- ambiente. O índice parcial existe porque `unique` trata nulos como
-- distintos, e sem ele daria para cadastrar duas contas de plataforma.
create unique index on core.fiscal_conta (provider, ambiente) where tenant_id is null;
create unique index on core.fiscal_conta (tenant_id, provider, ambiente) where tenant_id is not null;

-- -------------------------------------------------------------- emitente

create table core.fiscal_emitente (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references core.tenant(id) on delete cascade,
  conta_id            uuid not null references core.fiscal_conta(id) on delete restrict,
  -- A empresa correspondente no ERP, quando existe. É o que permite emitir a
  -- nota a partir do título a receber sem ninguém digitar CNPJ de novo.
  connection_id       uuid references core.connection(id) on delete set null,

  cnpj                text not null check (cnpj ~ '^[0-9]{14}$'),
  razao_social        text not null,
  nome_fantasia       text,
  inscricao_municipal text,
  inscricao_estadual  text,
  regime_tributario   text,
  municipio           text,
  uf                  text check (uf is null or uf ~ '^[A-Z]{2}$'),
  -- Código IBGE de 7 dígitos. A prefeitura que recebe a nota é identificada por
  -- ele, não pelo nome da cidade, e quase toda recusa de NFS-e de primeira
  -- viagem é este campo errado.
  codigo_municipio    text check (codigo_municipio is null or codigo_municipio ~ '^[0-9]{7}$'),

  -- Padrões do serviço prestado. A NFS-e exige item da lista, alíquota de ISS e
  -- discriminação em toda emissão, e para uma empresa de serviço eles são
  -- sempre os mesmos. Guardados aqui, a emissão a partir de um título a receber
  -- não precisa de mais nenhuma digitação: é um botão, e é isso que o Diogo
  -- pediu. Quem precisar variar, varia na hora.
  item_lista_servico  text,
  codigo_cnae         text,
  codigo_tributario   text,
  aliquota_iss        numeric(6,4),
  iss_retido_padrao   boolean not null default false,
  optante_simples     boolean not null default true,
  natureza_operacao   text not null default '1',
  discriminacao_padrao text,

  habilita_nfse       boolean not null default false,
  habilita_nfe        boolean not null default false,
  habilita_nfce       boolean not null default false,
  habilita_cte        boolean not null default false,
  habilita_mdfe       boolean not null default false,

  -- Metadado do certificado, nunca o certificado. `certificado_cnpj` é o CNPJ
  -- que veio dentro do arquivo, que a Focus confere contra o da empresa: se os
  -- dois divergem, o cadastro é recusado lá e nunca chega aqui.
  certificado_cnpj    text,
  certificado_vence   date,
  certificado_enviado timestamptz,

  status              text not null default 'pendente'
                      check (status in ('pendente', 'ativo', 'erro')),
  ultimo_erro         text,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  unique (tenant_id, cnpj)
);

create index on core.fiscal_emitente (tenant_id);
create index on core.fiscal_emitente (connection_id);
-- Certificado A1 vale um ano e vencer sem avisar derruba a emissão da empresa
-- inteira, num dia qualquer, sem erro que pareça erro. Este índice é o que
-- permite avisar com antecedência.
create index on core.fiscal_emitente (certificado_vence) where status = 'ativo';

-- ------------------------------------------------------------- documento

create table core.fiscal_documento (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references core.tenant(id) on delete cascade,
  emitente_id    uuid not null references core.fiscal_emitente(id) on delete cascade,
  connection_id  uuid references core.connection(id) on delete set null,

  tipo           core.fiscal_tipo not null,
  ref            text not null,
  status         core.fiscal_status not null default 'rascunho',

  -- O título do ERP que originou a nota. É o elo que fecha o ciclo: o Conta
  -- Azul diz o que há a receber, nós emitimos, e a tela passa a saber quais
  -- recebíveis ainda estão sem nota.
  installment_id uuid references core.installment(id) on delete set null,
  person_id      uuid references core.person(id) on delete set null,

  numero         text,
  serie          text,
  chave          text,
  protocolo      text,
  data_emissao   timestamptz,
  valor          numeric(18,2),
  tomador_nome   text,
  tomador_doc    text,
  descricao      text,

  url_xml        text,
  url_pdf        text,

  -- MDFe: quando a carga chegou. Nulo com status autorizado significa manifesto
  -- em viagem, e é exatamente essa a pergunta que a tela faz ao banco.
  encerrado_em   timestamptz,
  cancelado_em   timestamptz,

  mensagem       text,
  -- O que mandamos e o que voltou, crus. Quando a prefeitura recusa por uma
  -- regra que só ela tem, a resposta inteira é a única coisa que explica.
  enviado        jsonb not null default '{}'::jsonb,
  retorno        jsonb not null default '{}'::jsonb,

  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  -- A referência é única por tenant porque é ela que impede emissão duplicada.
  unique (tenant_id, ref)
);

create index on core.fiscal_documento (tenant_id, criado_em desc);
create index on core.fiscal_documento (emitente_id, status);
create index on core.fiscal_documento (installment_id);
-- Manifestos em viagem. O `where` deixa o índice do tamanho da pergunta, e não
-- do tamanho da tabela.
create index on core.fiscal_documento (tenant_id, data_emissao)
  where tipo = 'mdfe' and status = 'autorizado' and encerrado_em is null;

-- ---------------------------------------------------------------- evento
--
-- Cada aviso que a Focus manda. Guardado antes de mexer no documento, e por
-- isso sobrevive a erro nosso: se o processamento falhar, o aviso continua no
-- banco e dá para reprocessar sem pedir reenvio.
create table core.fiscal_evento (
  id           bigserial primary key,
  tenant_id    uuid references core.tenant(id) on delete cascade,
  documento_id uuid references core.fiscal_documento(id) on delete cascade,
  ref          text,
  status       text,
  recebido_em  timestamptz not null default now(),
  processado   boolean not null default false,
  corpo        jsonb not null default '{}'::jsonb
);

create index on core.fiscal_evento (documento_id, recebido_em desc);
create index on core.fiscal_evento (processado, recebido_em) where not processado;

-- ------------------------------------------------------------------ RLS
--
-- Leitura pelo membro do tenant, como todo o resto do schema. A escrita nunca
-- vem do navegador: quem grava é o servidor, com a conexão de serviço, depois
-- de conferir a sessão. Por isso não existe policy de insert nem de update.
alter table core.fiscal_conta     enable row level security;
alter table core.fiscal_emitente  enable row level security;
alter table core.fiscal_documento enable row level security;
alter table core.fiscal_evento    enable row level security;

create policy tenant_read on core.fiscal_emitente
  for select using (core.is_member(tenant_id));
create policy tenant_read on core.fiscal_documento
  for select using (core.is_member(tenant_id));
create policy tenant_read on core.fiscal_evento
  for select using (core.is_member(tenant_id));
-- A conta da plataforma não pertence a tenant nenhum e não deve ser legível por
-- ninguém: ela guarda o token que emite nota para todos os clientes.
create policy tenant_read on core.fiscal_conta
  for select using (tenant_id is not null and core.is_member(tenant_id));

-- --------------------------------------------------------------- consulta
--
-- Recebível sem nota. A pergunta que a Tamires faz todo dia primeiro do mês:
-- "o que não tem nota fiscal, já envia a cobrança". Aqui ela vira uma linha.
create or replace view mart.recebivel_sem_nota with (security_invoker = true) as
select
  i.tenant_id,
  i.connection_id,
  i.id                                as installment_id,
  i.descricao,
  i.data_vencimento,
  i.data_competencia,
  i.total,
  i.nao_pago,
  coalesce(p.nome, 'Sem cadastro')    as pessoa,
  p.id                                as person_id,
  p.documento                         as pessoa_documento
from core.installment i
left join core.person p on p.id = i.person_id
where i.deleted_at is null
  and i.kind = 'receivable'
  and i.data_competencia is not null
  and not exists (
    select 1
      from core.fiscal_documento d
     where d.installment_id = i.id
       and d.status in ('processando', 'autorizado')
  );
