-- 0022 · Documentos recebidos, e a exclusão entre NFS-e municipal e nacional
--
-- Duas coisas que apareceram lendo o esquema de criação de empresa da Focus e
-- que valem antes de qualquer emissão acontecer.
--
-- A primeira é a que mais muda o produto. `habilita_manifestacao` e
-- `habilita_manifestacao_cte` ligam a busca de NFe e CT-e emitidas **contra** o
-- CNPJ do cliente. É a despesa dele chegando da Receita, sem depender de
-- ninguém lançar nada no ERP, com cursor incremental próprio. Hoje o DriveAzul
-- só sabe de despesa que alguém digitou no Conta Azul; com isso ele passa a
-- saber da que existe. É a flag mais barata de ligar e a mais valiosa de todas,
-- e por isso ela entra agora, no cadastro, e não depois.
--
-- A segunda é uma armadilha da reforma tributária, dita numa linha na
-- documentação: `habilita_nfse` e `habilita_nfsen_producao` **não podem estar
-- ligados ao mesmo tempo em produção**. Municipal e nacional são o mesmo
-- imposto por dois caminhos, e os municípios estão migrando um a um. Ligar os
-- dois é o tipo de erro que a Focus recusa e que ninguém entende sem ler esta
-- frase, então ela vira restrição de banco.

alter table core.fiscal_emitente
  add column habilita_nfse_nacional boolean not null default false,
  -- Recebidos. Separados por documento porque uma transportadora quer CT-e e um
  -- prestador de serviço não.
  add column habilita_recebidas_nfe boolean not null default false,
  add column habilita_recebidas_cte boolean not null default false,
  -- Até onde já lemos os recebidos. O cursor da Focus é um número por CNPJ que
  -- cresce a cada alteração do documento, então guardar um inteiro basta para
  -- nunca reprocessar nada. É o CDC que a Conta Azul não tem.
  add column cursor_recebidas_nfe   bigint,
  add column cursor_recebidas_cte   bigint;

alter table core.fiscal_emitente
  add constraint nfse_municipal_ou_nacional
  check (not (habilita_nfse and habilita_nfse_nacional));

comment on constraint nfse_municipal_ou_nacional on core.fiscal_emitente is
  'A Focus recusa NFS-e municipal e nacional ligadas ao mesmo tempo em '
  'producao. Sao o mesmo imposto por dois caminhos, e os municipios estao '
  'migrando um a um durante a reforma tributaria.';
