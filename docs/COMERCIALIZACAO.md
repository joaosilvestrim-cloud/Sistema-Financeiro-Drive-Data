# DriveAzul como produto de prateleira

Plano para vender o DriveAzul na Loja de aplicativos da Conta Azul e, depois,
para clientes de Omie e Nibo. Complementa o `docs/PLANO.md`, que trata da
arquitetura, e o `docs/DEPLOY.md`, que trata do ambiente.

Escrito em 04/09/2026. O que está marcado como **a confirmar** depende de
resposta da Conta Azul e não deve virar promessa comercial antes disso.

---

## 1. O que estamos vendendo

O ERP registra. O DriveAzul explica. Essa frase separa o produto do que o
cliente já tem.

A Conta Azul mostra saldo, contas a pagar e contas a receber. Ela não mostra
fôlego de caixa, projeção de saldo, qualidade da previsão, concentração de
cliente, anomalia de categoria nem prazo médio real. E não guarda histórico de
versão da parcela, então ninguém consegue perguntar ao ERP o que estava previsto
para setembro quando julho fechou. O DriveAzul guarda. Esse é o diferencial que
não se copia com um dashboard bonito.

O comprador não é o contador. É o dono da empresa de serviço com faturamento
entre R$ 500 mil e R$ 20 milhões por ano, que já paga um ERP e ainda decide
olhando planilha.

---

## 2. A loja da Conta Azul é canal de distribuição, não de cobrança

Esse é o ponto que mais muda o plano, e é bom entender antes de escrever
qualquer linha de código.

A Conta Azul tem uma Loja de aplicativos dentro do produto, onde o cliente
escolhe a integração e segue o passo a passo. O portal do desenvolvedor deixa
escolher entre integração **pública**, **privada** ou **de uso interno**. A
pública é a que aparece para todo mundo.

O que a documentação pública **não** descreve em lugar nenhum: checkout dentro
da loja, repasse de assinatura, revenue share ou qualquer forma de a Conta Azul
cobrar pelo nosso produto. O canal oficial de parceria é o e-mail
`integracoes@contaazul.com`, e o de dúvida técnica é `api@contaazul.com`.

A leitura prática é essa: **a loja traz o cliente até a porta, a cobrança é
nossa.** Isso é bom. Significa preço definido por nós, cobrança em Pix e cartão,
margem inteira, sem depender do calendário de repasse de ninguém. E significa
que precisamos de meio de pagamento próprio antes de listar, porque o botão da
loja vai jogar o cliente num cadastro nosso.

**A confirmar com a Conta Azul:** se a listagem pública é automática ao marcar a
integração como pública ou se passa por curadoria; que material a vitrine exige;
se existe qualquer contrapartida financeira.

### O que a Conta Azul cobra de nós sem estar escrito no contrato

Quatro restrições da API viram restrição de negócio.

**O refresh token vale duas semanas.** Se a conexão de um cliente ficar parada
mais que isso, ela morre e ele precisa reconectar na mão. Num produto de
prateleira isso é churn silencioso. A renovação tem que ser um batimento
próprio, independente de o cliente abrir a tela ou não.

**A API pode bloquear requisição de fora do Brasil.** As funções da Vercel já
rodam em `gru1`, São Paulo. O worker ainda não existe em produção, e quando
existir não pode nascer no GitHub Actions, que roda nos Estados Unidos. Precisa
de host no Brasil.

**Não existe ambiente de teste.** A conta de desenvolvedor dura 3 dias e é
estendida por e-mail. Toda a homologação acontece contra conta real. O teste de
onboarding de cliente novo vai exigir uma conta Conta Azul Pro nossa, separada
da DriveData, só para isso.

**Só cliente do plano Pro pode integrar.** O Conta Azul Mais não tem API. Isso
define o mercado endereçável e precisa estar escrito na vitrine, senão a gente
compra suporte de gente que nunca vai conseguir conectar.

---

## 3. Os três ERPs lado a lado

O produto é o mesmo. O que muda é a porta de entrada e o jeito de descobrir o
que mudou desde a última sincronização.

| | Conta Azul | Omie | Nibo |
|---|---|---|---|
| Como o cliente conecta | OAuth2, botão | cola app_key e app_secret | cola ApiToken |
| Onde ele pega | autoriza na hora | painel do app dele no Omie | Configurações > API |
| Token expira | acesso 1h, refresh 2 semanas | não expira | validade que ele escolher |
| Descobrir mudança | endpoint de alterações | webhook e filtro por data | OData com filtro de data |
| Webhook | não tem | tem | não documentado |
| Limite | 600/min e 10/s, medidos por nós | 240/min, 4 simultâneas/s, 300 mil/dia | não documentado |
| Punição por erro | 429 comum | 30 min de bloqueio na 10ª requisição errada, HTTP 425 | não documentado |
| Escrita | assíncrona, sem apagar | exige documento de origem antes do financeiro | direta |

Três observações valem mais que a tabela.

**Omie e Nibo são mais fáceis de conectar que a Conta Azul.** Não tem dança de
OAuth, não tem 2FA, não tem token que morre em duas semanas. O cliente cola duas
linhas e acabou. A Omie inclusive **exige** que o parceiro ofereça uma tela de
credenciais com máscara no campo do secret. O formulário que vamos construir não
é gambiarra, é o padrão que eles pedem.

**A Omie tem webhook e a Conta Azul não.** Onde a Conta Azul obriga a varrer, a
Omie avisa. O adaptador da Omie vai ser mais barato de operar por cliente, e
isso muda a conta de custo quando a base crescer.

**A Omie pune requisição repetida.** Requisição idêntica só é liberada a cada 60
segundos, e dez requisições incorretas no mesmo IP mais app_key mais método dão
30 minutos de bloqueio. Um worker ingênuo, que tenta de novo na hora quando dá
erro, se autobloqueia. O nosso já faz backoff, mas o retry vai precisar
diferenciar 425 de 429.

---

## 4. O que trava a venda hoje

Vale ser direto: o produto funciona, o negócio não. Hoje só a DriveData usa, e
foi conectada por mim, no terminal, com script. Nada disso escala para um
desconhecido que clicou num botão da loja.

**Não existe onboarding sem terminal.** Conectar uma empresa hoje é
`npm run connect`. Para vender, precisa ser cadastro, botão, carga automática e
dashboard, sem ninguém do nosso lado no meio.

**O worker não está no ar.** A sincronização é manual. Com um cliente dá para
viver assim. Com dez, o dado envelhece e o refresh token morre.

**Não existe cobrança.** Nem assinatura, nem teste grátis, nem bloqueio por
falta de pagamento.

**A IA manda nome de cliente para fora.** O dossiê que alimenta os bullets
inclui razão social dos maiores clientes e nome das contas bancárias, e isso vai
para a Groq, que é subprocessador nos Estados Unidos. Para a DriveData, que
escolheu isso, tudo bem. Para um cliente pagante é objeção de venda e é assunto
de LGPD. Ou a gente anonimiza antes de enviar, ou a IA vira opcional por
cliente. O certo é fazer os dois.

**Não existe nada jurídico.** Sem termos de uso, sem política de privacidade,
sem lista de subprocessadores, sem prazo de retenção, sem botão de excluir a
conta. A Conta Azul provavelmente vai pedir política de privacidade para listar,
e o cliente vai pedir de qualquer jeito.

**Não existe observabilidade por cliente.** Quando a conexão de alguém quebrar
de madrugada, hoje ninguém fica sabendo. Num produto pago, quem descobre
primeiro tem que ser a gente.

---

## 5. Como a conexão vai funcionar

Uma tela só, `/conectar`, com um cartão por ERP. Cada cartão sabe a sua forma.

**Conta Azul.** Botão único. Leva ao OAuth e volta no callback que já existe e
funciona em produção.

**Omie.** Dois campos, app_key e app_secret, o segundo com máscara, do jeito que
a Omie exige. Um link explicando onde achar, com print.

**Nibo.** Um campo, ApiToken, com o caminho `Configurações > API` escrito na
tela e um aviso de que ele deve escolher validade longa, senão a conexão cai
sozinha no dia do vencimento.

Depois disso o fluxo é igual para os três, e é aqui que o produto ganha ou perde
o cliente.

1. **Validação imediata.** Uma chamada barata que devolve o nome da empresa. A
   tela mostra "Conectado a DriveData Consultoria". Se o dado estiver errado, o
   erro é específico. Nunca "falha ao conectar".
2. **Carga inicial em segundo plano, com progresso.** Contas, categorias,
   centros de custo, pessoas, e depois 36 meses de parcelas e baixas. A tela diz
   o que está fazendo e libera a aba. Na DriveData isso trouxe 1233 parcelas e
   969 baixas.
3. **Primeiro número na tela em minutos, não em dias.** É o momento que decide a
   venda. O cliente precisa ver o próprio saldo, o próprio vencido e o próprio
   fôlego de caixa antes de fechar a aba.
4. **Estado da conexão sempre visível.** Conectada, sincronizando, expirando,
   quebrada. Com data da última sincronização e botão de reconectar.

E um detalhe que só existe por causa do prazo de duas semanas da Conta Azul: um
aviso por e-mail antes do refresh token vencer, com link direto para reconectar.
Perder cliente por token expirado seria o churn mais burro possível.

---

## 6. O que muda na arquitetura

Pouco, porque o desenho já previu isso. Só o `src/providers/contaazul.mjs`
conhece nome de campo de ERP. Ingestão, marts e telas falam o formato interno.
Um ERP novo é um arquivo irmão.

O contrato hoje tem onze métodos: `listAccounts`, `listCategories`,
`listDreCategories`, `listCostCenters`, `listPeople`, `listInstallments`,
`listChangedEventIds`, `listInstallmentsByEvent`, `getInstallment`,
`listSettlements` e `getBalance`.

Duas mudanças são necessárias, e as duas são pequenas.

**O provider precisa declarar o que sabe fazer.** Hoje o sync assume o jeito da
Conta Azul de descobrir mudança. Com Omie e Nibo entrando, ele precisa
perguntar:

```js
capacidades: {
  cdc: 'alteracoes' | 'webhook' | 'data_alteracao',
  webhook: true,
  escrita: true,
  saldoAtual: true,
}
```

O sync passa a escolher a estratégia pela capacidade, e não pelo nome do
provider. Sem isso, cada ERP novo vira um `if` no meio do sync, e com três ERPs
o sync fica ilegível.

**O onboarding precisa de um método a mais.** Algo como `identificarEmpresa()`,
que devolve nome e documento da empresa conectada. É o que faz a tela dizer
"Conectado a DriveData Consultoria" em vez de "ok". Barato de implementar e é o
que dá confiança no momento em que ela mais falta.

O resto da pilha não muda. Camadas raw, core e mart continuam iguais. O
versionamento SCD2 da parcela continua igual. As telas não sabem qual ERP está
por trás, e é assim que tem que ficar.

---

## 7. Preço

Ancorado no que o cliente já paga de ERP, sabendo que o custo marginal por
cliente é de poucos reais por mês entre banco, hospedagem e IA.

| Plano | Preço | O que leva |
|---|---|---|
| Essencial | R$ 149/mês | 1 empresa, visão geral, fluxo de caixa, recebíveis, alertas |
| Profissional | R$ 349/mês | até 3 empresas, IA em cada KPI, previsão, DRE gerencial, importador de fatura, dados auxiliares, metas |
| Escritório | R$ 99 por empresa/mês, a partir de 5 | tudo do Profissional, mais painel consolidado entre empresas |

Teste de 14 dias sem cartão. Dá para fazer isso porque o valor aparece em
minutos, não em semanas. Quem conectou e viu o próprio fôlego de caixa já
entendeu o produto.

Anual com dois meses de desconto, para segurar caixa e reduzir churn.

O plano Escritório é o mais interessante e não é para o mesmo comprador. Um
contador com 40 clientes vale mais que 40 vendas avulsas, e o esforço de venda é
o mesmo. Esse é o motivo comercial de fazer o Nibo, que é forte em escritório de
contabilidade, e não só o motivo técnico.

---

## 8. Canais, em ordem de esforço

**Loja da Conta Azul.** É o pedido original e é o de maior alavanca, porque o
cliente já está dentro do ERP procurando o que plugar. Depende de listar como
integração pública e de material de vitrine.

**Venda direta.** Site, demonstração com dado real da DriveData anonimizado, e o
argumento de que quem construiu usa. Não depende de aprovação de ninguém e pode
começar antes da loja.

**Contador com carteira, via Nibo.** Venda consultiva, ticket maior, ciclo mais
longo. Entra na fase 5.

**Loja da Omie.** A Omie tem programa de parceiro e app_key por aplicação, mas a
documentação pública não descreve vitrine igual à da Conta Azul. Precisa de
contato direto com eles. **A confirmar.**

---

## 9. Fases

Cada fase tem um critério de pronto que não é opinião.

### Fase 1. Deixar de depender de mim
Worker no ar, em host no Brasil, com sincronização automática e renovação de
token independente. Onboarding de ponta a ponta sem terminal. Estado da conexão
visível e e-mail de aviso antes do token vencer.

*Pronto quando:* eu conecto uma segunda empresa pelo navegador, sem abrir o
terminal, e o dado dela continua atualizado uma semana depois sem eu tocar em
nada.

### Fase 2. Poder cobrar
Assinatura com Pix e cartão, teste de 14 dias, bloqueio suave por falta de
pagamento. Termos de uso, política de privacidade, lista de subprocessadores,
exclusão de conta. IA sem nome próprio no que sai para a Groq, e com chave para
desligar por cliente.

*Pronto quando:* alguém de fora assina, paga, usa e cancela sozinho.

### Fase 3. Loja da Conta Azul
Integração marcada como pública, contato com `integracoes@contaazul.com`,
material de vitrine, escopos mínimos, homologação contra conta real.

*Pronto quando:* o app aparece na Loja de aplicativos e um cliente que não
conhecemos conecta sozinho.

### Fase 4. Omie
Adaptador novo com webhook e respeito ao bloqueio de 425. Tela de credenciais
com máscara, do jeito que eles exigem.

*Pronto quando:* uma empresa Omie de verdade roda no DriveAzul com os mesmos
números do ERP dela, conferidos ao centavo, como fizemos na auditoria da
DriveData.

### Fase 5. Nibo e o canal contábil
Adaptador com OData. Painel consolidado do plano Escritório.

*Pronto quando:* um escritório com pelo menos dez empresas usa em produção.

---

## 10. Riscos

**A Conta Azul pode não querer nos listar, ou pode construir o mesmo.** É o
risco de plataforma, e a resposta é não depender dela. Por isso a venda direta
vem antes da loja e o segundo ERP vem logo em seguida.

**O token de duas semanas é o maior risco operacional do produto.** Uma falha de
alguns dias no worker derruba conexão de cliente pagante, e a recuperação exige
ação dele, não nossa. Merece alarme próprio, e não só um log.

**A IA é subprocessador estrangeiro.** Vai aparecer em due diligence de cliente
maior. Resolver antes de vender é barato. Resolver depois é caro.

**Homologar sem ambiente de teste.** Toda a validação acontece em produção,
contra conta real. Precisa de conta Conta Azul Pro separada, só para isso, e de
disciplina para nunca testar escrita no ERP de cliente. A API não tem como
apagar lançamento financeiro, o que já nos obrigou a proteger o importador de
fatura com impressão digital.

**Suporte.** Produto financeiro gera dúvida sobre número. Um cliente perguntando
por que o saldo dele difere em R$ 300 consome uma tarde. A auditoria e o
relatório de conferência que já existem nos scripts precisam virar tela, senão o
suporte come a margem.
