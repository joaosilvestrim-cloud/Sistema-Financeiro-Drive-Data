-- 0024 · O índice sazonal estava medindo crescimento
--
-- A gestora perguntou por que outubro aparece com mais gasto que receita, e por
-- que isso não bate com o Conta Azul. A resposta é este arquivo.
--
-- O índice era `média daquele mês do ano ÷ média geral dos 36 meses`. Sem
-- remover tendência. Numa empresa estável isso funciona. Nesta não:
--
--     mês   2025      2026      cresceu
--     jan   15.034    56.654    3,8x
--     abr   29.383    95.223    3,2x
--     jul   90.508   170.391    1,9x
--     ago   91.740   216.999    2,4x
--
-- A DriveData triplicou em doze meses. O índice então dizia que agosto vale
-- 2,21 e outubro vale 0,54, quando na verdade agosto foi observado com a
-- empresa grande e outubro só com a empresa pequena. Ele estava medindo *quando
-- a empresa era maior*, não *quando o negócio é forte*, e essas duas coisas só
-- coincidem por acidente.
--
-- O efeito na tela: a projeção esperava R$ 53 mil de receita para outubro,
-- contra os R$ 160 mil que setembro já tem lançado, e o mês virava prejuízo
-- projetado que o ERP não mostra.
--
-- A correção é a decomposição clássica: comparar cada mês com a vizinhança
-- dele, e não com a média de tudo. A razão contra uma média móvel centrada de
-- doze meses cancela a tendência, porque numerador e denominador crescem juntos.
--
-- E há uma segunda regra, que importa mais que a fórmula: **sem janela cheia
-- não há índice**. Uma média móvel centrada precisa de cinco meses antes e seis
-- depois. Com vinte meses de histórico, sobram poucos pontos, e vários meses do
-- ano ficam sem nenhuma observação limpa. Nesses casos o índice é 1,0, neutro,
-- e a projeção não finge saber de sazonalidade que os dados não sustentam.
--
-- Isso deixa o índice quase todo neutro nesta base hoje. É a resposta certa:
-- ainda não dá para separar sazonalidade de crescimento aqui. Com mais um ciclo
-- fechado, ele passa a valer sozinho.

-- Trocada e nao substituida: o create or replace do Postgres nao aceita mudar
-- nem a ordem nem o nome das colunas, e esta versao acrescenta `observacoes` e
-- `confiavel`. Nenhuma outra view depende desta, conferido antes de derrubar.
drop view if exists mart.indice_sazonal;

create view mart.indice_sazonal with (security_invoker = true) as
with mensal as (
  select tenant_id, connection_id, kind, mes, competencia
    from mart.monthly_series
   where mes < date_trunc('month', current_date)
     and mes >= date_trunc('month', current_date) - interval '48 months'
),
-- A tendência local. Doze meses centrados no próprio mês, para o nível da
-- empresa naquela época entrar dos dois lados da divisão e sair da conta.
tendencia as (
  select
    m.*,
    avg(m.competencia) over (
      partition by m.tenant_id, m.connection_id, m.kind
      order by m.mes
      rows between 5 preceding and 6 following
    ) as media_movel,
    count(*) over (
      partition by m.tenant_id, m.connection_id, m.kind
      order by m.mes
      rows between 5 preceding and 6 following
    ) as pontos
  from mensal m
),
razoes as (
  select
    tenant_id, connection_id, kind, mes,
    extract(month from mes)::int          as mes_do_ano,
    competencia,
    competencia / media_movel             as razao
  from tendencia
  -- Só onde a janela está cheia dos dois lados. Na ponta da série a média móvel
  -- é de meia janela e puxa o índice para o lado que tiver mais dado, que é
  -- exatamente o viés que este arquivo existe para tirar.
  where pontos = 12
    and media_movel > 0
    and competencia > 0
),
-- Quantas observações limpas cada mês do ano tem. Uma só não distingue
-- sazonalidade de um mês atípico, então ela não vira índice.
por_mes as (
  select
    tenant_id, connection_id, kind, mes_do_ano,
    count(*)          as observacoes,
    avg(razao)        as razao_media,
    avg(competencia)  as media_do_mes
  from razoes
  group by 1, 2, 3, 4
),
-- Normaliza para os índices do ano girarem em torno de 1. Sem isso, um ano com
-- poucos meses observados deslocaria o nível inteiro da projeção.
escala as (
  select tenant_id, connection_id, kind, avg(razao_media) as centro
    from por_mes where observacoes >= 2 group by 1, 2, 3
),
-- A média por mês do ano, para a tela poder mostrar quanto aquele mês costuma
-- render em reais. Vale mesmo quando não há índice confiável.
bruta as (
  select
    tenant_id, connection_id, kind,
    extract(month from mes)::int as mes_do_ano,
    count(*)                     as anos,
    avg(competencia)             as media_do_mes
  from mensal group by 1, 2, 3, 4
)
select
  b.tenant_id, b.connection_id, b.kind, b.mes_do_ano,
  b.anos,
  b.media_do_mes,
  coalesce(p.observacoes, 0)                         as observacoes,
  -- O índice, ou 1,0 quando os dados não o sustentam. Nunca nulo: quem consome
  -- multiplica por ele, e nulo viraria projeção zerada em silêncio.
  case
    when p.observacoes >= 2 and e.centro > 0
      then round((p.razao_media / e.centro)::numeric, 3)
    else 1.0
  end                                                as indice,
  (p.observacoes >= 2 and e.centro > 0)              as confiavel
from bruta b
left join por_mes p
  on p.tenant_id = b.tenant_id and p.connection_id is not distinct from b.connection_id
 and p.kind = b.kind and p.mes_do_ano = b.mes_do_ano
left join escala e
  on e.tenant_id = b.tenant_id and e.connection_id is not distinct from b.connection_id
 and e.kind = b.kind;

comment on view mart.indice_sazonal is
  'Indice sazonal com a tendencia removida, pela razao contra media movel '
  'centrada de 12 meses. Sem janela cheia e sem pelo menos duas observacoes '
  'limpas o indice e 1,0 e a coluna confiavel e falsa: nessa situacao nao da '
  'para separar sazonalidade de crescimento, e fingir que da produz projecao '
  'errada com cara de precisa.';
