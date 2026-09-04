-- 0014 · Desligar a IA por cliente
--
-- A política de privacidade diz que o cliente pode desligar as análises de
-- inteligência artificial e que, desligadas, nada é enviado para fora do país.
-- Sem esta coluna aquela frase seria mentira.
--
-- Ligada por padrão porque é o que faz o produto valer o preço. Quem tem
-- política interna contra processamento no exterior desliga e continua com
-- todos os números, sem a leitura em linguagem natural.

alter table core.tenant
  add column ia_habilitada boolean not null default true;
