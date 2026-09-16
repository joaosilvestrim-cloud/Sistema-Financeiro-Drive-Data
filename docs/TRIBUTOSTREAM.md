# TributoStream

Motor de conciliação de split payment da Reforma Tributária. Começado em 14/09/2026.

## O problema

Com o split payment, a liquidação do Pix, boleto ou cartão chega dividida: o imposto vai ao Fisco na hora e só o líquido cai na conta. O banco decide quanto reter com base no que consegue cruzar no instante da transação. Sem dado casado em tempo real, aplica o split simplificado com alíquota de referência, que costuma reter a mais. O módulo valida se o retido na fonte bate com o imposto calculado na NFe e acusa a diferença.

## As três pontas

| Ponta | Onde mora | Origem |
|---|---|---|
| Título a receber | `core.installment` | Conta Azul |
| Nota fiscal | `core.fiscal_documento` | Focus NFe |
| Liquidação bancária | `core.split_liquidacao` | webhook de adquirente ou retorno CNAB |

A chave que amarra tudo é o `id_repasse`, o identificador transacional de segregação do arranjo de pagamento. Único por tenant em `core.split_liquidacao`.

## O que existe hoje (migration 0027)

- `raw.split_webhook`: ingestão bruta, dedupe por `(fonte, hash sha256 dos bytes)`, `tenant_id` nulo permitido (aviso órfão se investiga, aviso recusado se perde). RLS ligada sem policy, igual `raw.api_payload`.
- `core.split_liquidacao`: evento normalizado com FKs para título e nota, valores com constraint `bruto = liquido + retido`, `tipo_split` (inteligente, simplificado, desconhecido), `situacao` (recebido, conciliado, divergente, orfao). Policy `tenant_read` via `core.is_member`.
- `core.split_divergencia`: anomalias com ciclo de vida próprio (retencao_maior, retencao_menor, split_simplificado, sem_nota, sem_titulo). Índice único parcial impede duplicar anomalia aberta no reprocessamento.
- Rota `POST /api/webhooks/bank` (`?fonte=cnab` para retorno de arquivo): valida `BANK_WEBHOOK_SECRET` no header authorization com comparação em tempo constante, grava o bruto e devolve 200 rápido (`maxDuration = 10`). Duplicado e órfão também ganham 200, porque o banco reenvia tudo que não for 200. Pública no `proxy.js` como as outras rotas de máquina.
- `lib/tributostream.js`: hash, leitura best-effort do payload (nomes variam por adquirente), atribuição de tenant pelo CNPJ do recebedor via `core.fiscal_emitente`, normalização quando o payload tem o mínimo (idRepasse, tenant e os três valores fechando com tolerância de meio centavo).

## Decisão de arquitetura: sem service role na rota

O projeto não usa o client Supabase com `SUPABASE_SERVICE_ROLE_KEY` em rota nenhuma e essa chave nunca vai para a Vercel. O app conecta direto no Postgres via pooler com role própria (`lib/db.js`), que já passa por cima da RLS como o worker. Efeito idêntico ao service role no PostgREST, sem expor uma chave que entrega o banco inteiro. A atribuição de tenant é feita no código, pelo CNPJ, e testada no `segurancateste`.

## Credencial por tenant (feito em 16/09, migration 0028)

Requisito de autosserviço: o cliente gera a própria credencial na tela de Conexões, sem ninguém da plataforma no meio. `core.webhook_credencial` guarda o segredo cifrado (AES-256-GCM de `src/crypto.mjs`); o endpoint vira `POST /api/webhooks/bank/<id_publico>` e o segredo continua no header (o id da URL só identifica, quem autentica é o header). O segredo aparece uma única vez na criação; perdeu, revoga e gera outra. A atribuição de tenant vem da credencial e o CNPJ do payload vira conferência. A rota base com `BANK_WEBHOOK_SECRET` segue existindo para teste da plataforma.

## Próximos passos

1. Processador assíncrono (cron) que reprocessa `raw.split_webhook` pendente e casa liquidação com título (valor + CNPJ + janela de vencimento) e com NFe (installment_id já liga as duas).
2. Cálculo do `imposto_nfe` a partir do retorno da Focus e geração das divergências.
3. Tela de pendências: órfãos, divergências abertas, retido a mais acumulado no mês.
4. Cadastro do endpoint no adquirente quando existir (cliente faz sozinho pela tela de Conexões).
