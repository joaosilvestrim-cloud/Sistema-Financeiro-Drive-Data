-- 0016 · Estrutura de custo e multiplicador de preço
--
-- O Diogo descreveu isso na reunião de 04/09 e é a ideia mais original que saiu
-- dela: partindo do custo real, dizer ao dono por quanto ele precisa vender.
--
--   "o seu produto tem que ser vendido a 3,5 vezes o preço de custo para você
--    ter lucro. Se vender menos disso, você não tem lucro."
--
-- Para calcular isso é preciso separar três coisas que o ERP mistura:
--
--   direto     anda junto com a venda e é o custo do que foi entregue
--   variavel   é percentual da receita, como imposto e comissão
--   fixo       existe mesmo sem vender nada
--
-- O `entrada_dre` da Conta Azul já sugere quase tudo, e é o padrão usado quando
-- não há classificação própria. Mas ele erra: na base da DriveData há mais de
-- R$ 250 mil em doze meses em categorias sem `entrada_dre` nenhum. Por isso a
-- classificação precisa ser editável, e por isso o que não foi classificado
-- aparece na tela em vez de ser jogado num balde qualquer.

create table core.category_classe (
  tenant_id     uuid not null references core.tenant(id) on delete cascade,
  category_id   uuid not null references core.category(id) on delete cascade,
  classe        text not null
                check (classe in ('receita', 'direto', 'variavel', 'fixo', 'fora')),
  -- 'fora' é o que não entra na conta operacional: investimento, empréstimo e
  -- movimento não operacional. Precisa de nome próprio, senão vira custo fixo e
  -- infla o multiplicador.
  definido_por  uuid references auth.users(id),
  atualizado_em timestamptz not null default now(),
  primary key (tenant_id, category_id)
);

alter table core.category_classe enable row level security;
create policy tenant_read on core.category_classe
  for select using (core.is_member(tenant_id));

-- O palpite a partir do que o próprio ERP já diz. Fica em função e não em dado
-- copiado: se a Conta Azul reclassificar uma categoria, o palpite acompanha, e
-- só o que a pessoa decidiu na mão continua valendo por cima.
create or replace function core.classe_sugerida(p_tipo text, p_entrada_dre text)
returns text
language sql
immutable
as $$
  select case
    when p_tipo = 'RECEITA' then
      case when coalesce(p_entrada_dre, '') like 'RECEITA%' then 'receita' else 'fora' end
    when p_entrada_dre in ('CUSTO_SERVICOS_PRESTADOS', 'CUSTO_MERCADORIA_VENDIDA') then 'direto'
    when p_entrada_dre in ('IMPOSTOS_SOBRE_VENDAS', 'COMISSOES_SOBRE_VENDAS',
                           'DESCONTOS_INCONDICIONAIS', 'RECEITA_FRETES_ENTREGAS') then 'variavel'
    when p_entrada_dre in ('DESPESAS_ADMINISTRATIVAS', 'DESPESAS_COMERCIAIS',
                           'DESPESAS_OPERACIONAIS_NIVEL_2', 'DESPESSAS_FINANCEIRAS') then 'fixo'
    when p_entrada_dre in ('INVESTIMENTOS_IMOBILIZADO', 'EMPRESTIMOS_DIVIDAS',
                           'OUTRAS_DESPESAS_NAO_OPERACIONAIS',
                           'OUTRAS_RECEITAS_NAO_OPERACIONAIS',
                           'RECEITAS_RENDIMENTOS_FINANCEIROS') then 'fora'
    -- Sem entrada_dre não dá para adivinhar, e adivinhar aqui estragaria o
    -- multiplicador em silêncio. Fica nulo e a tela cobra a decisão.
    else null
  end
$$;
