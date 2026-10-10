-- 0033 · core.hoje(): o dia de Brasília, independente da sessão
--
-- A 0032 colocou o banco no fuso de Brasília, mas o pooler da Supabase
-- (porta 6543, que é o que a produção usa) reaproveita conexões abertas antes
-- e ignora o parâmetro de fuso enviado pelo cliente. Conferido em 10/10/2026:
-- pelo pooler, current_setting('TimeZone') continuava 'UTC'. Depender do fuso
-- da sessão é depender de qual conexão física pegou a consulta.
--
-- core.hoje() não depende de sessão nenhuma. Toda view que usava current_date
-- passa a usar a função; o código da aplicação também (lib/ e src/).

create or replace function core.hoje() returns date
  language sql stable parallel safe
  as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

grant execute on function core.hoje() to public;

-- Recria cada view que lê current_date com a mesma definição, trocando só
-- isso, e preservando as opções (security_invoker). Feito por catálogo para
-- não copiar à mão sete definições longas e arriscar mudar outra coisa.
do $$
declare
  v record;
  def text;
begin
  for v in
    select c.oid, format('%I.%I', n.nspname, c.relname) as nome, c.reloptions
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'v' and n.nspname in ('mart', 'core')
       and pg_get_viewdef(c.oid) ilike '%current_date%'
  loop
    def := replace(pg_get_viewdef(v.oid), 'CURRENT_DATE', 'core.hoje()');
    execute format('create or replace view %s %s as %s',
      v.nome,
      case when v.reloptions is null then '' else format('with (%s)', array_to_string(v.reloptions, ', ')) end,
      def);
  end loop;
end $$;
