# O que o cliente pediu

Extraído da reunião de 04/09/2026 com Diogo (BDGAL), Tamires e João. O Diogo é
contador, opera BPO financeiro e tem carteira própria. Ele não é só um
prospecto: é o comprador-alvo descrevendo o produto que compraria. Vale mais que
qualquer suposição nossa.

Reuniões passam a ser recorrentes, quarta e sexta às 16h30, retomando depois do
dia 10.

---

## 1. A frase que vale mais que o resto

> "Conta azul não tem age de conciliação. Então, se a gente monta um relatório de
> age de conciliação, a gente ganha um cliente por aí."

O ERP não mostra o envelhecimento da conciliação bancária, e nenhum concorrente
anuncia isso. É a primeira coisa que um BPO abre o sistema para ver, porque
responde se dá para confiar no número antes de olhar o número.

Na base da DriveData: 261 baixas de 969 sem conciliar, R$ 648.916,80 parados.
O dado já vinha da API em `id_reconciliacao` e a gente não estava guardando.

**Status: feito.** Migration 0015, reprocessado a partir do `raw` sem gastar uma
chamada de API, e a tela mostra até que dia está conciliado, quanto está parado
e há quanto tempo.

---

## 2. A tela de entrada que ele desenhou

Ele descreveu o resumo executivo na ordem exata em que decide:

1. **Conciliação.** "quanto tempo o meu caixa é fiel", último dia conciliado,
   quantos reais parados.
2. **Aging dos dois lados.** A receber à esquerda, a pagar à direita, 30/60/90.
   A gente só tinha aging de recebível.
3. **Caixa desta semana e da próxima.** Foi enfático:
   > "ninguém vai olhar 2 meses para frente para tomar qualquer decisão. O gestor
   > vai olhar para essa semana e quer saber a próxima."
   E criticou o nosso gráfico atual: "tá vendo que ele está muito extenso?".
   Chamou o problema de **fuga de caixa**: não saber se semana que vem tem
   dinheiro para os fornecedores da fila.
4. **10 maiores clientes e 10 maiores fornecedores.** A gente só tinha clientes.
5. Uma leitura de IA dizendo se o caixa se mantém no ritmo atual.

Só depois disso vem o detalhe que já existe hoje.

**Status: feito.** Tela `/resumo`, primeira do menu. A Visão geral continua,
como ele sugeriu, em segundo lugar.

---

## 3. Design

> "eu sei que vocês gostam de preto, mas tenta uma cor mais [clara]"
> "não precisa ser aquele brancão, pode ser um fundinho meio acinzentado"

Tema claro por padrão, fundo levemente acinzentado, escuro como opção.

**Status: pendente.**

---

## 4. O que ele quer e ainda não existe

**Rentabilidade por produto e por serviço.** Cada produto com código único,
despesa direta contra despesa indireta, e a resposta para "qual produto dá
lucro, qual dá prejuízo, e qual vocês mantêm por causa do nome". A Tamires
admitiu que hoje só olham venda, mão de obra, imposto e administrativo.

**Rentabilidade por cliente.** "você sabe qual é o cliente que te dá mais lucro e
o cliente que te traz prejuízo?"

**Custo fixo contra custo variável, até o EBITDA.**

**Multiplicador de precificação.** A ideia mais original da reunião. Partindo da
rentabilidade real, dizer ao dono: o seu preço de venda tem que ser 3,5 vezes o
custo para dar lucro. Abaixo disso você vende no prejuízo. A Tamires reconheceu
na hora que o fator comercial que ela usa não inclui o custo dela.

E foi aqui que ele disse quanto vale:
> "eu pagaria R$ 100 a mais para ter uma análise já pronta do que eu vou precisar
> pegar dentro de um sistema e ter que fazer na mão."

**DRE gerencial com comparativo.** Mês, trimestre e ano, com variação.

**Orçado contra realizado**, e a pergunta que ele fez junto e que define o
desenho: de onde vem o orçado e de onde vem o realizado. Procedência visível.

**Pipeline quente, morno e frio, com horizonte em meses**, refletido nos
lançamentos futuros.
> "se um dia algum investidor quiser entrar, é com esse pipeline que você vai
> justificar sua projeção futura."

**Consolidação entre CNPJs, com intercompany.** Ele quer ver três empresas no
mesmo lugar e consolidar. A gente já consolida por tenant; falta a eliminação
intercompany.

**White label.** Quer a marca dele, não a nossa, e aceita pagar à parte por isso.

---

## 5. Preço, com números reais do mercado

O que ele levantou na própria pesquisa:

| Referência | Preço |
|---|---|
| Concorrente que ele cotou | R$ 280 por CNPJ, com pacote para 10 e 12 |
| O mais barato que achou | R$ 99,90 por empresa, e "o mais feio" |
| Outro | R$ 250 a R$ 299 |
| Data4Company, cotação dele | R$ 440/mês para 4 clientes, mais R$ 250 de implementação |

**O que ele pagaria:** R$ 450 a R$ 500 por mês num pacote de 3 CNPJs
consolidados. Não quer preço por CNPJ, quer pacote.

Isso valida o nosso Profissional a R$ 449 com 3 empresas, que foi definido antes
desta reunião. E o CNPJ adicional a R$ 89 fica abaixo dos R$ 99,90 do mais
barato e bem abaixo dos R$ 150 da Data4Company.

O alerta dele: "se a gente subir muito a régua de um produto de prateleira, a
gente não vai conseguir vender". Ele sugere ancorar perto de R$ 150 para o
produto de entrada. O nosso Essencial está em R$ 197.

Unidade econômica que ele estimou: cerca de 200 clientes para se pagar, 500 para
rentabilizar.

E o mais importante: **ele confirmou que a carteira dele compraria.**

---

## 6. Processo, que muda a integração com o CRM

Fecha o assunto que a Tamires levantou na call da manhã sobre duplicidade entre
o CRM e o Conta Azul.

O que o BPO precisa da DriveData é **venda**, e só:
> "O que eu preciso de vocês é venda, porque eu não estou no dia a dia de vocês."

Venda fechada entra no Conta Azul no ato, com recebível e a pagar. Emissão de
nota, conciliação e cobrança são do BPO, todo dia 1.

E apareceu um caminho para o apontamento de horas que não é a API: o Conta Azul
tem **importação por planilha**, com layout próprio. O João confirmou que
consegue exportar o CRM naquele molde. Isso evita escrever no ERP por API e
mantém o ERP como fonte única, que era a preocupação da Tamires.

Detalhe operacional que vale como funcionalidade: durante a própria reunião eles
acharam um **lançamento duplicado** no Conta Azul, dois iguais no mesmo dia. Um
detector de duplicidade na tela pagaria por si.

E a cobrança por e-mail do Conta Azul não funciona:
> "a galera recebe e-mail do conta azul e não clica no link. O que funciona é o
> apontamento de horas."

O que faz o cliente pagar é o relatório de fechamento com as horas trabalhadas,
não o boleto.

---

## 7. Fora do escopo do DriveAzul

Ele propôs um segundo produto: revender emissor de nota fiscal em white label,
usando um fornecedor que cobra R$ 548/mês com CNPJ ilimitado e 4000 notas, para
revender a R$ 89,90. A dor é real e cresce com a reforma tributária, e a própria
Conta Azul vai passar a vender emissão separada.

É decisão de negócio, não de sistema, e não pertence ao DriveAzul. Fica
registrado para não se perder.

---

## 8. O pano de fundo

O Diogo insistiu num ponto que explica a urgência do produto: a DriveData não
tem receita recorrente, o último projeto termina em janeiro, e a empresa depende
inteiramente da Tamires, que entra em licença em cerca de dois meses.

O DriveAzul é a resposta para isso. Não é um projeto paralelo.
