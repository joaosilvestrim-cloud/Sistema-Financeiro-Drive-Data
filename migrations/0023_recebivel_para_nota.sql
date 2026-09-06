-- 0023 · "Somente as que realmente não têm nota"
--
-- Pedido da Tamires, olhando a tela: a lista mostrava 381 títulos e
-- R$ 1,7 milhão, começando em outubro de 2024, e oferecia o botão de emitir em
-- todos. Ela viu na hora o que eu não vi: quase tudo ali já tinha nota.
--
-- Era pior que uma lista suja. O botão oferecia emitir uma segunda nota para
-- venda já faturada, e nota duplicada é imposto duplicado e retificação na
-- prefeitura. A lista errada era o defeito; o botão era o risco.
--
-- A causa é que a view antiga só sabia de nota emitida por nós, comparando com
-- core.fiscal_documento. Como começamos ontem, tudo que existe desde 2024
-- parecia pendente.
--
-- O sinal que faltava estava na frente o tempo todo: o Conta Azul carimba o
-- número na própria descrição do título quando a nota sai por lá.
--
--     Venda 298 / NFS-e:333 - RPS:360
--
-- São 277 dos 381. Ler isso não custa nada, é auto-corrigível (quem emitir a
-- nota no ERP some da lista na sincronização seguinte) e não depende de mais
-- nenhuma integração.
--
-- A view deixa de filtrar e passa a explicar. Ela devolve todo recebível com um
-- motivo, e quem decide o que mostrar é a tela. Assim o número que sobra é
-- defensável: dá para dizer quantos ficaram de fora e por quê, em vez de
-- entregar uma lista menor sem justificativa, que é como se perde confiança.

drop view if exists mart.recebivel_sem_nota;

create or replace view mart.recebivel_para_nota with (security_invoker = true) as
select
  i.tenant_id,
  i.connection_id,
  i.id                                as installment_id,
  i.descricao,
  i.data_vencimento,
  i.data_competencia,
  i.total,
  i.nao_pago,
  coalesce(p.nome, 'Sem cadastro')    as pessoa,
  p.id                                as person_id,
  p.documento                         as pessoa_documento,

  -- O número da nota que o próprio ERP escreveu na descrição. Padrão estrito,
  -- exigindo o número depois dos dois pontos: alguém que escreva "NFS-e" solto
  -- numa observação não pode sumir da lista por causa disso.
  substring(i.descricao from 'NFS-?e\s*:\s*([0-9]+)')  as nota_no_erp,

  -- A nota que nós emitimos, quando existe.
  d.numero                            as nota_nossa,
  d.status                            as status_nossa,

  -- Por que este título pode ou não virar nota daqui. Um motivo só, na ordem em
  -- que eles importam, porque mostrar três razões para a mesma linha não ajuda
  -- ninguém a decidir.
  case
    when d.id is not null                                          then 'nota_nossa'
    when i.descricao ~ 'NFS-?e\s*:\s*[0-9]+'                       then 'nota_no_erp'
    when coalesce(i.total, 0) <= 0                                 then 'sem_valor'
    when coalesce(regexp_replace(p.documento, '[^0-9]', '', 'g'), '') !~ '^([0-9]{11}|[0-9]{14})$'
                                                                   then 'sem_documento'
    else 'pendente'
  end                                 as motivo

from core.installment i
left join core.person p on p.id = i.person_id
left join core.fiscal_documento d
  on d.installment_id = i.id and d.status in ('processando', 'autorizado')
where i.deleted_at is null
  and i.kind = 'receivable'
  and i.data_competencia is not null;

comment on view mart.recebivel_para_nota is
  'Todo recebivel com o motivo de poder ou nao virar nota daqui. Filtrar por '
  'motivo = ''pendente'' para a lista de emissao; os demais motivos existem '
  'para a tela poder dizer quantos ficaram de fora e por que.';
