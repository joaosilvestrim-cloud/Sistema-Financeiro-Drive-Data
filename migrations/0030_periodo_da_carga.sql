-- 0030 · Período da carga inicial escolhido pelo cliente
--
-- Pedido do João em 09/10: a carga inicial demorava e ninguém sabia quanto
-- histórico ela trazia (a tela dizia 36 meses, a configuração fazia 12). Agora
-- a pessoa escolhe antes de começar, vendo quanto tempo cada opção leva e o
-- que cada uma libera no painel.
--
-- O período mora na própria carga, e não mais numa variável de ambiente. A
-- posição da carga (janela N de M) só faz sentido contra a lista de janelas
-- que a gerou; com a lista vindo do ambiente, rodar a mesma carga num lugar
-- com configuração diferente embaralhava a posição. Aconteceu em 09/10.
--
-- meses_atras nulo quer dizer "esperando a escolha": a carga não anda até lá.
-- As cargas que já existiam ficam com o período que de fato estavam usando
-- (12 para trás, 6 para frente), para a posição delas continuar valendo.

alter table core.onboarding_job
  add column meses_atras  int check (meses_atras  between 1 and 60),
  add column meses_frente int check (meses_frente between 0 and 60);

update core.onboarding_job
   set meses_atras = 12, meses_frente = 6
 where meses_atras is null;
