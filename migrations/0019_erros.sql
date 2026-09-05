-- 0019 · Erros de produção
--
-- Em produção o Next esconde a mensagem do erro e devolve só um digest. É o
-- comportamento certo para o usuário e cega quem conserta: o painel inteiro caiu
-- e a única pista era o número 1129746059.
--
-- O hook onRequestError do Next recebe o erro inteiro, no servidor, antes de
-- qualquer sanitização. Guardar aqui transforma "quebrou" em "quebrou nesta
-- linha, deste arquivo, nesta rota".
--
-- Sem tenant_id de propósito: o erro pode acontecer antes de haver sessão, e um
-- registro de erro que exige sessão não serve para o caso em que a sessão é o
-- problema.

create table core.app_error (
  id         bigserial primary key,
  rota       text,
  digest     text,
  mensagem   text,
  stack      text,
  contexto   jsonb,
  criado_em  timestamptz not null default now()
);

create index on core.app_error (criado_em desc);
