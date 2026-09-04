-- 0017 · Cursor da sincronização incremental
--
-- A auditoria pegou isto: uma rodada incremental da DriveData levou 213
-- segundos. A função da Vercel morre em 60. O resultado seria a pior falha
-- possível, a silenciosa: toda rodada começaria, seria morta no meio, o
-- watermark nunca avançaria, e a próxima rodada refaria exatamente o mesmo
-- trabalho. A conexão nunca mais sincronizaria e o log só mostraria rodadas
-- interrompidas.
--
-- O endpoint /alteracoes devolve apenas o id do evento, sem a data da alteração.
-- Sem data não dá para avançar o watermark pela metade da lista. Então a lista
-- que falta processar fica guardada aqui, e o watermark só anda quando ela
-- esvazia.
--
-- É o mesmo desenho da carga inicial, pelo mesmo motivo: trabalho que não cabe
-- numa função serverless precisa saber onde parou.

create table core.sync_cursor (
  connection_id uuid primary key references core.connection(id) on delete cascade,
  -- A janela que estava sendo processada. Guardada porque o watermark só avança
  -- no fim: sem ela, retomar exigiria perguntar de novo à API o que mudou, e a
  -- resposta viria diferente.
  janela_inicio timestamptz not null,
  janela_fim    timestamptz not null,
  pendentes     text[] not null,
  processados   int not null default 0,
  atualizado_em timestamptz not null default now()
);

create index on core.sync_cursor (atualizado_em);
