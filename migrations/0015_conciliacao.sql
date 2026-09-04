-- 0015 · Conciliação bancária
--
-- O payload da baixa traz `id_reconciliacao`. Preenchido quer dizer que aquele
-- pagamento já foi casado com o extrato do banco. Nulo quer dizer que o dinheiro
-- foi lançado no ERP e ninguém conferiu contra o banco ainda.
--
-- Isso não estava sendo guardado, e é a informação que um BPO olha primeiro. Ele
-- não abre o sistema para ver saldo, abre para saber se o número dá para
-- confiar: "quanto tempo o meu caixa é fiel". Enquanto há baixa sem conciliar, o
-- saldo do painel é uma promessa, não um fato.
--
-- O próprio Conta Azul não mostra o envelhecimento disso. Guardar aqui é o que
-- permite responder até que dia está conciliado e quanto em reais está parado.

alter table core.settlement
  add column reconciliacao_external_id text;

-- Só o que interessa: o que falta conciliar.
create index on core.settlement (connection_id, data_pagamento)
  where reconciliacao_external_id is null;
