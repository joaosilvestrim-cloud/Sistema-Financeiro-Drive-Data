-- 0021 · O token da Focus é da empresa, não da conta
--
-- A 0020 assumiu que existia um token por conta, como na Conta Azul. Está
-- errado, e a documentação de autenticação deles é explícita:
--
--   "o token da empresa é enviado como usuário do Basic Auth"
--   "token alfanumérico gerado no cadastro da empresa"
--
-- Cada empresa emitente tem o seu par de tokens, um de homologação e um de
-- produção, devolvidos no momento em que ela é criada. Emitir nota de uma
-- empresa com o token de outra não é uma questão de permissão, é uma chamada
-- para a empresa errada.
--
-- E tem uma segunda consequência, que a página de Empresas diz em uma linha e
-- que muda o código: a API de cadastro de empresas **só existe em produção**.
-- Não há homologação para ela. O jeito de testar é `dry_run=1`, que valida tudo
-- e não grava nada. Ou seja, mesmo enquanto a emissão está em homologação, o
-- cadastro fala com o servidor de produção.
--
-- Por isso o token que sobra em `fiscal_conta` muda de significado. Ele deixa
-- de ser "o token da conta" e passa a ser o token administrativo: o da empresa
-- principal, que é com quem se conversa para criar as outras. É a mesma coluna
-- com outro nome no comentário, e por isso não precisa migrar dado nenhum.

comment on table core.fiscal_conta is
  'Token administrativo da Focus: o da empresa principal, usado para criar e '
  'listar empresas. Esta API só existe em produção. Não serve para emitir: '
  'emissão usa o token da própria empresa, em core.fiscal_emitente.';

alter table core.fiscal_emitente
  -- Cifrados com AES-256-GCM, como todo token do sistema. A chave está no
  -- ambiente, nunca no banco.
  add column token_homologacao_enc text,
  add column token_producao_enc    text,
  -- Os gatilhos também são por token, e portanto por empresa. Sem registrar
  -- isso, cada cadastro repetido criaria gatilhos duplicados e a mesma nota
  -- chegaria duas vezes na nossa rota.
  add column gatilhos_em           timestamptz,
  -- O id da empresa lá, para poder alterar depois sem procurar por CNPJ.
  add column externo_id            text;

-- Emitente ativo sem token não emite, e o erro que isso produz na hora do
-- clique não parece falta de token. Melhor a tela saber antes.
create index on core.fiscal_emitente (tenant_id)
  where status = 'ativo' and token_homologacao_enc is null and token_producao_enc is null;
