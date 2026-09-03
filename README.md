# Sistema Financeiro DriveData

Plataforma de analytics financeiro que consome a API da Conta Azul (v2) e entrega fluxo de caixa, DRE gerencial, aging, projeção e alertas.

## Estado
Fase de planejamento. Ainda não há código de aplicação.
O plano completo de arquitetura está em [docs/PLANO.md](docs/PLANO.md).

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

## Próximo passo
Fase 0 do plano: script CLI que completa o fluxo OAuth, renova o token e baixa 12 meses de contas a receber e a pagar para JSON.
