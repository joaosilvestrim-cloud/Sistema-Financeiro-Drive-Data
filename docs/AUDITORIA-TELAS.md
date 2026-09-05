# Auditoria das telas

Feita em 05/09/2026, olhando cada tela contra o que os dados já permitem
responder. Só entra aqui o que é sustentado pela base que existe hoje, não o que
seria bom ter com dados que não temos.

---

## 1. O que já está no banco e não aparece em tela nenhuma

Cinco marts existem, são alimentadas a cada sincronização e nenhuma tela as lê.
É o retorno mais barato que existe: o cálculo está pronto e falta a tela.

### `forecast_accuracy` — o diferencial que ninguém vê

É a razão de guardarmos versão de cada parcela. Responde o que o próprio ERP
previa para dezembro quando setembro fechou, contra o que dezembro virou. Nenhum
concorrente anuncia isso, e não dá para recuperar histórico que nunca foi
gravado.

**Está invisível no produto.** A view existe, está sendo alimentada, e não há
uma linha de tela lendo ela.

Uma ressalva honesta: hoje só existe um ponto de observação, setembro, porque
foi quando começamos a gravar. A comparação só passa a dizer alguma coisa a
partir de outubro. Construir a tela agora é o certo justamente por isso: ela
começa a valer no mês que vem, e cada mês parado é um mês de memória perdida.

### `taxa_recuperacao` — quanto do vencido volta

Na base da DriveData: do que vence entre 91 e 180 dias, **93% acaba entrando**.
Entre 181 e 360, 99%.

Isso muda decisão. Um vencido de 120 dias que historicamente volta em 93% dos
casos não é o mesmo problema que um que volta em 40%, e hoje as duas coisas
aparecem iguais na tela de recebíveis.

### `clientes_mensais` — quem parou de comprar

Permite responder qual cliente faturava e parou. É o indicador de perda de
cliente, que nenhuma tela mostra hoje. Para uma empresa de serviço com carteira
concentrada, perder um cliente é o evento mais caro que existe.

### `taxa_no_prazo` — 92,5% recebido no prazo

Um número só, direto, que hoje não aparece em lugar nenhum.

### `taxas_mensais` — o custo que o ERP não lança

A auditoria já aponta R$ 317,98 em taxas de meio de pagamento em 135 baixas.
É custo real que não vira lançamento de despesa no Conta Azul, então some do
DRE. Aparece hoje em uma tela só, de passagem.

---

## 2. Indicadores que os dados permitem e não existem

**Ponto de equilíbrio em reais.** A estrutura de custo da tela de Preço já tem
tudo: fixo dividido por um menos o percentual variável dá o faturamento mínimo
para não dar prejuízo. É o par natural do multiplicador, e responde a pergunta
que vem logo depois dele: quanto eu preciso vender por mês.

**EBITDA.** O Diogo pediu. A classificação de categoria já separa o que é
operacional do que não é, então falta a linha, não o dado.

**Concentração de fornecedor.** Temos HHI de cliente. O mesmo cálculo do outro
lado diz se a empresa depende demais de um prestador, o que para a DriveData,
que terceiriza, é risco real.

**Sazonalidade de despesa.** Existe de receita. O mesmo índice do lado da
despesa mostra o mês que sempre pesa, e é o que permite reservar caixa antes.

**Prazo médio por cliente.** Existe o consolidado. Por cliente, ele vira
ferramenta de negociação: este paga em 45 dias, aquele em 12.

**Fôlego em meses.** Hoje é em dias. Para quem decide contratação, meses é a
unidade que se usa numa conversa.

---

## 3. O que falta em quase toda tela

**Exportar.** Nenhuma tela exporta nada. Um BPO vive de mandar planilha para o
cliente, e o Diogo disse que o que faz o cliente pagar é o relatório, não o
boleto. É a falta mais grave da lista e vale para todas as tabelas.

**Filtro de período.** Quase toda tela tem janela fixa no código. Só o DRE e a
provisão de imposto deixam escolher. Quem fecha mês precisa olhar mês específico.

**Abrir o número.** Clicar num R$ 35.853 vencido e ver os títulos por trás. Hoje
o aging mostra o total e a lista está em outra tela, sem filtro que ligue as
duas. É o clique que todo mundo tenta dar.

**Buscar dentro da tabela.** Clientes tem 37 linhas, recebíveis tem 60. Sem
campo de busca, achar um cliente é rolar.

**Relatório com a marca.** O Diogo quer PDF com a marca do escritório dele, e
disse que é por isso que 500 escritórios pagam o concorrente.

---

## 4. Tela a tela

**Resumo executivo.** A melhor tela do sistema. Falta abrir as faixas de aging e
mostrar a taxa de recuperação ao lado do vencido.

**Visão geral.** Sobrepõe bastante o Resumo. Vale virar a tela do mês fechado,
com o comparativo contra o mês anterior, em vez de repetir os mesmos quatro
indicadores.

**Fluxo de caixa.** Completa. Falta o custo de taxa como linha própria.

**Projeção de saldo.** Boa. Falta cenário: o que acontece se 10% não entrar.

**Recebíveis.** Falta busca, filtro por faixa e a taxa de recuperação.

**DRE gerencial.** Falta EBITDA e exportar.

**Preço e custo.** Falta ponto de equilíbrio. E a classificação de categoria é
onde a tela ganha ou perde: hoje 21,5% da despesa está sem classe, então o
multiplicador ainda é estimativa.

**Impostos.** Nova e completa para o que foi pedido. Falta histórico: provisão
contra pago, mês a mês.

**Indicadores.** É onde caberia a qualidade da previsão.

**Clientes.** Falta quem parou de comprar e o prazo médio por cliente.

**Produtividade e Metas.** Dependem de dado auxiliar que ninguém preencheu
ainda. As telas estão prontas e vazias, o que é pior que não existir: parece
defeito. Vale mostrar o que a tela mostraria, com um exemplo, e o caminho para
preencher.

**Dados auxiliares.** É a porta para as duas telas acima e está escondida no fim
do menu.

**Fatura de cartão.** Funciona. Falta memória: quanto o cartão pesa por mês.

**Conexões.** Boa. Falta o botão de sincronizar agora.

---

## 5. O bloqueio de venda, que não é de tela

O cadastro público depende do serviço de e-mail embutido do Supabase, que é
limitado a poucos envios por hora e documentado como não sendo para produção.
Testando o funil, o próprio Supabase recusou com `over_email_send_rate_limit`.

E a confirmação de e-mail está ligada, então todo cadastro dispara um e-mail e
ninguém entra sem clicar no link.

Somados, os dois quer dizer que **quem comprar não consegue se cadastrar**, e o
erro vai aparecer para o cliente como uma falha genérica.

Duas saídas, e as duas valem:

1. **Desligar a confirmação de e-mail.** O cadastro passa a devolver a sessão na
   hora e a pessoa cai direto em conectar. Some o e-mail do caminho crítico e a
   promessa de "dados em minutos" passa a ser verdade.
2. **Configurar um SMTP de verdade** no Supabase. Vai ser preciso de qualquer
   forma, porque recuperar senha depende de e-mail.

---

## 6. Ordem que eu seguiria

1. **O e-mail.** É o único item que impede vender. Nada mais importa antes disso.
2. **Exportar tabela.** Uma função, todas as telas, e é o que o comprador usa
   todo dia.
3. **Qualidade da previsão.** O diferencial está pronto no banco e invisível na
   tela. Construir agora é o que faz ele valer em outubro.
4. **Ponto de equilíbrio e EBITDA.** Fecham a tela de Preço e custo, que é a que
   o Diogo disse que pagaria mais para ter.
5. **Taxa de recuperação no Resumo.** Barato e muda decisão de cobrança.
6. **Abrir o número.** O clique que todo mundo tenta dar.
