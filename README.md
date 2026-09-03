# Sistema Financeiro DriveData

Plataforma de analytics financeiro que consome a API da Conta Azul (v2) e entrega fluxo de caixa, DRE gerencial, aging, projeção e alertas.

## Estado
Fase 0 (prova de conexão) implementada. Sem interface ainda.
O plano completo de arquitetura está em [docs/PLANO.md](docs/PLANO.md).

Decidido: primeiro cliente é a própria DriveData, multiempresa por tenant já no v1, dashboard próprio sem Power BI.

## Stack
- Next.js na Vercel (app e API)
- Supabase / PostgreSQL 17 (banco, auth, RLS multi-tenant)
- Worker Node com pg-boss para sincronização em background
- API Conta Azul v2 via OAuth2 (um refresh token por empresa conectada)

## Configuração
Copie `.env.example` para `.env` e preencha. O `.env` está no `.gitignore` e nunca deve ser comitado.

Detalhes importantes:
- A senha do Postgres precisa ser URL-encoded na `DATABASE_URL`. O caractere `#` vira `%23`.
- `CONTAAZUL_REDIRECT_URI` precisa estar cadastrada no portal do desenvolvedor da Conta Azul.

## Fase 0: como rodar

Requer Node 20 ou mais novo. Não tem dependência de npm, usa só o que vem no Node.

```bash
npm run auth
```
Abre o fluxo OAuth. Copie a URL impressa, autorize no navegador e cole de volta a URL de retorno. O código de autorização vale 3 minutos, então cole rápido. Os tokens ficam em `.tokens.json`, que está no `.gitignore`.

```bash
npm run pull
```
Baixa dimensões (contas financeiras, categorias, categorias DRE, centros de custo, pessoas), 18 meses de contas a receber e a pagar em janelas mensais, o feed de alterações dos últimos 7 dias e o saldo atual de cada conta. Grava JSON em `data/` e imprime um resumo com contagem, tempo e volume por recurso.

Ajuste o intervalo pelas variáveis `PULL_MONTHS_BACK` e `PULL_MONTHS_FORWARD`.

O que essa fase responde antes de escrever qualquer schema: quantas parcelas existem de verdade, quanto tempo leva uma carga completa, quanto payload isso gera e quais campos vêm preenchidos na prática.

## Próximo passo
Fase 1 do plano: worker de ingestão, camadas raw e core no Supabase, CDC incremental e criptografia de token no banco.
