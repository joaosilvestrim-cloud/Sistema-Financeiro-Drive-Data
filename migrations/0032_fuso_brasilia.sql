-- 0032 · O banco passa a contar o dia no fuso de Brasília
--
-- Rodava em UTC. Toda consulta que usa current_date (vencido, a vencer, aging,
-- o mês corrente do fluxo) virava o dia às 21h de Brasília. Das 21h à
-- meia-noite, título que vence hoje aparecia vencido, e no último dia do mês o
-- fluxo já tratava o mês como encerrado. Achado na conferência do grupo Caixa
-- em 10/10/2026.
--
-- Vale para toda conexão nova, inclusive as que passam pelo pooler. As
-- datas de vencimento são do tipo date e não mudam; timestamptz continua
-- guardando o instante certo, só a leitura em texto e os casts para date
-- passam a ser de Brasília. O lado JavaScript usa a mesma régua (lib/hoje.js).
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'America/Sao_Paulo');
end $$;
