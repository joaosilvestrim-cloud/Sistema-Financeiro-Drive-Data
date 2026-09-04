-- 0010 · Chave única que enxerga o nulo
--
-- As tabelas de IA têm `connection_id` nulo quando o escopo é o consolidado do
-- tenant, que é o caso mais comum. E no Postgres, por padrão, dois nulos são
-- considerados distintos numa chave única: a restrição simplesmente não dispara,
-- o ON CONFLICT nunca casa e cada geração insere uma linha nova em vez de
-- atualizar a anterior.
--
-- O efeito é silencioso: o cache continua funcionando, porque a leitura usa
-- `is not distinct from`, mas a tabela cresce sem limite e duas gerações
-- simultâneas deixam duas verdades para o mesmo indicador.
--
-- NULLS NOT DISTINCT resolve, e é exatamente o que se quer aqui: consolidado é
-- um escopo só, não infinitos escopos iguais.

alter table core.ai_insight  drop constraint if exists ai_insight_tenant_id_connection_id_referencia_key;
alter table core.ai_analysis drop constraint if exists ai_analysis_tenant_id_connection_id_tipo_competencia_key;

-- Limpa duplicata que possa ter entrado antes da correção, mantendo a mais nova.
delete from core.ai_insight a using core.ai_insight b
 where a.tenant_id = b.tenant_id
   and a.connection_id is not distinct from b.connection_id
   and a.referencia = b.referencia
   and a.criado_em < b.criado_em;

delete from core.ai_analysis a using core.ai_analysis b
 where a.tenant_id = b.tenant_id
   and a.connection_id is not distinct from b.connection_id
   and a.tipo = b.tipo and a.competencia = b.competencia
   and a.criado_em < b.criado_em;

alter table core.ai_insight
  add constraint ai_insight_escopo_unico
  unique nulls not distinct (tenant_id, connection_id, referencia);

alter table core.ai_analysis
  add constraint ai_analysis_escopo_unico
  unique nulls not distinct (tenant_id, connection_id, tipo, competencia);
