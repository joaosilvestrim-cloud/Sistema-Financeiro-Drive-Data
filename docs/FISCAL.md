# Emissão fiscal pelo DriveAzul

## Por que existe

Pedido do Diogo na reunião de 04/09, e ele pediu duas vezes de formas
diferentes. A primeira foi como produto separado, um emissor white label para
vender a escritório de contabilidade. A segunda, mais cedo na conversa e mais
importante, foi dentro daqui:

> "eu queria colocar dentro desse sistema todo aqui o meu cara de notas, porque
> o meu cliente se quiser emitir nota aqui já manda para o Conta Azul, já manda
> para a contabilidade"

O João decidiu pelo segundo caminho: tudo pelo DriveAzul. É o que este código
faz.

O contexto do mercado é a reforma tributária somada ao aperto das prefeituras.
O Diogo citou Goiânia cobrando R$ 80 por mês por CNPJ para deixar emitir, e o
Conta Azul e a SIEG correndo para lançar emissor avulso. A dor é real e é agora.

## O que muda no produto

Até aqui o DriveAzul lia o ERP e explicava. Esta é a primeira parte do sistema
que **escreve no mundo**: aperta um botão e nasce um documento com valor legal.
Isso muda o peso de cada decisão de projeto, e é por isso que a tela pede
confirmação onde antes só mostrava número.

O ciclo que se fecha:

```
Conta Azul  ->  título a receber
                      |
                      v
DriveAzul   ->  "isto ainda não virou nota"  ->  botão
                      |
                      v
Focus NFe   ->  prefeitura  ->  gatilho de volta
                      |
                      v
DriveAzul   ->  PDF e XML no link, prontos para mandar ao cliente
```

## O fornecedor

[Focus NFe](https://doc.focusnfe.com.br/reference/). REST, ambiente de
homologação separado, webhook de verdade, e o mesmo token cobre NFe, NFCe,
NFS-e, NFS-e Nacional, CT-e, MDF-e, NFCom e DCe.

É o oposto da Conta Azul, que não tem webhook nenhum e obrigou o sistema a
varrer por CDC. Aqui eles avisam.

Planos em setembro de 2026:

| Plano | Mês | CNPJs | Notas | Adicional |
| --- | --- | --- | --- | --- |
| Solo | R$ 89,90 | 1 | 100 | R$ 0,10 |
| Start | R$ 113,90 | 3 | 100 por CNPJ | R$ 0,10 |
| **Growth** | **R$ 548,00** | **ilimitado** | **4.000** | **R$ 0,12** |
| Enterprise | sob consulta | ilimitado | acordo | sob consulta |

O Growth é o plano do modelo: a DriveData contrata uma vez e cada cliente vira
uma `empresa` dentro dele. É o que a tabela `core.fiscal_conta` chama de conta
da plataforma, com `tenant_id` nulo.

Duas coisas para não errar na conversa comercial:

O R$ 89,90 que o Diogo sugeriu como preço de revenda **é o preço de tabela do
plano Solo da própria Focus**. Quem quiser comprar direto, compra pelo mesmo
valor. O que o DriveAzul vende não é a emissão, é não precisar entrar em
prefeitura nenhuma e a nota sair do título que já está no ERP.

E a cobertura: a Focus fala em mais de 3.000 municípios integrados, com R$ 199
fixos para integrar um novo em 15 dias úteis. O Diogo falou em 5 mil. O Brasil
tem 5.570. Conferir a
[lista de municípios](https://focusnfe.com.br/cidades-integradas-nfse/) antes de
prometer cidade específica.

## O certificado digital

**O DriveAzul não guarda certificado.** Isto é regra do projeto, não detalhe de
implementação.

O arquivo A1 sobe pela tela, é convertido em base64 em memória, vai para a Focus
na mesma requisição e o objeto morre quando a função retorna. Não toca disco,
não toca coluna, não entra em log. A senha idem.

O que fica em `core.fiscal_emitente` é metadado: o CNPJ que o certificado provou
e a data em que ele vence. Só isso.

Duas razões. A primeira é que um dump deste banco não pode dar a ninguém o poder
de assinar documento fiscal em nome das empresas dos nossos clientes. A segunda
é que isso é argumento de venda: dá para dizer ao contador, com o código na mão,
que o certificado dele não está conosco.

A data de vencimento existe por um motivo específico. Certificado A1 vale um ano
e, quando vence, a emissão da empresa inteira para num dia qualquer, com um erro
que não parece erro de certificado. A tela avisa a partir de 30 dias.

## Como ligar

Passo 1 é seu, não meu: **criar a conta na Focus**. São 30 dias grátis e não
posso criar conta em nome de ninguém.

1. Criar a conta em <https://focusnfe.com.br> e pegar o token de **homologação**
   no painel.
2. Gerar um segredo longo para o gatilho e pôr no ambiente:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

3. Rodar o instalador:

   ```bash
   FOCUS_TOKEN=... FOCUS_AMBIENTE=homologacao APP_URL=https://driveazul.drivedata.com.br FOCUS_WEBHOOK_SECRET=... npm run fiscalinstalar
   ```

   Ele valida o token antes de gravar, guarda cifrado com a mesma chave dos
   tokens da Conta Azul (`TOKEN_ENCRYPTION_KEY`) e cadastra os gatilhos.

4. Conferir:

   ```bash
   npm run fiscalteste
   ```

Variáveis novas na Vercel: `FOCUS_WEBHOOK_SECRET` e `FOCUS_AMBIENTE`. O token da
Focus **não** vai para a Vercel, ele mora cifrado no banco.

Para virar produção, repetir o passo 3 com o token de produção e
`FOCUS_AMBIENTE=producao`.

## O que cada arquivo faz

| Arquivo | Papel |
| --- | --- |
| `migrations/0020_fiscal.sql` | conta, emitente, documento, evento e a view `mart.recebivel_sem_nota` |
| `src/providers/focusnfe.mjs` | o único lugar que conhece a forma da API da Focus |
| `lib/fiscal.js` | montagem do payload, emissão, consulta, cancelamento, encerramento |
| `app/api/fiscal/webhook/route.js` | recebe o gatilho, autentica por cabeçalho |
| `app/(dash)/notas/page.js` | a tela |
| `scripts/fiscalinstalar.mjs` | liga a conta e cadastra os gatilhos |
| `scripts/fiscalteste.mjs` | confere o payload sem token, e a conexão com token |

## Decisões que valem saber

**A referência é nossa e é a chave de idempotência.** A Focus identifica cada
documento por uma `ref` escolhida por quem chama, e recusa duas emissões com a
mesma. A `ref` nasce do id do título, com unicidade garantida pelo banco. Dois
cliques no botão emitir não emitem duas notas, e isso importa porque nota
duplicada gera imposto duplicado.

**O documento é gravado antes da chamada sair.** Se a rede cair depois do POST e
antes da resposta, existe linha no nosso banco com status `processando` e a
consulta a encontra. Gravar depois de responder perderia nota emitida de verdade,
em silêncio.

**A emissão é assíncrona e a tela diz isso.** O POST devolve
`processando_autorizacao`. A nota vira autorizada quando a prefeitura responde,
o que leva de segundos a minutos. O gatilho avisa; o botão Conferir existe para
quando o aviso não chega.

**Status desconhecido vira `processando`, não erro.** Se a Focus criar um estado
novo, a tela não pode pintar de vermelho uma nota que está apenas num estado que
ainda não conhecemos.

**A validação acontece antes de gastar chamada.** `montarNfse` é função pura e
devolve o que falta em português: inscrição municipal, código IBGE, item da
lista de serviço, documento do tomador. A maior parte do que dá errado numa
NFS-e é payload, não rede, e por isso o teste roda sem token nenhum.

## MDF-e

O MDF-e é o manifesto de carga, e é o documento que interessa à BDGAL, que é
logística.

Ele tem uma particularidade que quase nenhum sistema trata: **precisa ser
encerrado quando a carga chega**, por evento separado
(`POST /mdfe/{ref}/encerrar` com data, UF e município de descarga). Encerrar não
é cancelar. Cancelar é desistir antes de sair; encerrar é dizer que chegou.

Manifesto autorizado e nunca encerrado é pendência de fiscalização. A tela de
Notas fiscais mostra um cartão com os que estão em viagem e há quantos dias, e o
índice parcial em `core.fiscal_documento` existe só para essa pergunta.

Este é o pedaço com menos concorrência do que foi construído aqui.

## O que ainda não existe

- **Cadastro do emitente pela tela.** Hoje `cadastrarEmitente` existe em
  `lib/fiscal.js` e funciona, mas a tela de Conexões ainda não tem o formulário
  com o upload do certificado. É o próximo passo.
- **Emissão de NFe, CT-e e MDF-e pela tela.** O cliente da API cobre os cinco
  tipos e o banco também. A tela só emite NFS-e, que é o caso da DriveData e da
  carteira do Diogo.
- **Notas recebidas.** A Focus expõe NFe e CT-e emitidas *contra* o CNPJ do
  cliente, com cursor incremental pelo campo `versao` e cabeçalho
  `X-Max-Version`. É o mesmo CDC que construímos para a Conta Azul, só que
  melhor. Puxar isso traz a despesa direto da Receita, sem depender de ninguém
  lançar no ERP. `nfesRecebidas` e `ctesRecebidos` já existem no cliente; falta
  a ingestão e a tela.
- **Escrita de volta no Conta Azul.** Emitida a nota, gravar o número e o link
  no título de origem lá. Fecha o ciclo do jeito que o Diogo descreveu.
