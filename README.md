# Sistema Financeiro DriveData

Plataforma de analytics financeiro que consome a API da Conta Azul (v2) e entrega fluxo de caixa, DRE gerencial, aging, projeção e alertas.

O plano completo de arquitetura está em [docs/PLANO.md](docs/PLANO.md).

## Estado

| Fase | O que é | Situação |
|---|---|---|
| 0 | Prova de conexão via CLI | pronta |
| 1 | Núcleo de ingestão (schema, worker, CDC) | pronta, falta rodar contra a API real |
| 2 | Marts e dashboard | pronta |
| 3 | Inteligência (previsão, cenário, anomalia) | a fazer |
| 4 | Produto vendável | a fazer |

Decidido: primeiro cliente é a própria DriveData, multiempresa por tenant já no v1, dashboard próprio sem Power BI, sync de 1 hora por conexão.

## Stack
- Next.js na Vercel (app e API, fase 2)
- Supabase / PostgreSQL 17 em sa-east-1, RLS multi-tenant
- Worker Node com pg-boss para sincronização em background
- API Conta Azul v2 via OAuth2, um par de tokens por empresa conectada

## Configuração

```bash
npm install
npm run keygen     # gera TOKEN_ENCRYPTION_KEY e OAUTH_STATE_SECRET
```

Copie `.env.example` para `.env` e preencha. O `.env` está no `.gitignore` e nunca deve ser comitado.

Dois detalhes que custam tempo se passarem despercebidos:
- A senha do Postgres precisa ser URL-encoded na `DATABASE_URL`. O `#` vira `%23`.
- `CONTAAZUL_REDIRECT_URI` precisa estar cadastrada no portal do desenvolvedor da Conta Azul. Enquanto a cadastrada for a do Google, o fluxo roda em modo colar URL.

Se perder a `TOKEN_ENCRYPTION_KEY`, todas as conexões precisam ser autorizadas de novo. Ela cifra os tokens no banco.

## Comandos

```bash
npm run migrate     # aplica migrations/ no banco
npm run selftest    # testa ingestao ponta a ponta, sem tocar na API
npm run seed        # cria o tenant _demo com dados sinteticos
npm run invite -- --email voce@dominio --senha "..." --tenant _demo
npm run dev         # dashboard em http://localhost:3000
npm run connect     # autoriza uma empresa e cria a conexao no banco
npm run sync        # sincroniza as conexoes vencidas
npm run worker      # sobe o worker continuo (fila + cron)
npm run report      # resumo dos marts no terminal
```

## Dashboard

Next.js com App Router. Login pelo Supabase Auth, e o middleware barra qualquer rota que nao seja a de login. Os dados nao passam pelo PostgREST: as telas rodam SQL direto nas views de `mart`, sempre filtrando por tenant a partir da sessao verificada. A RLS continua ligada nas tabelas como segunda barreira.

Telas: visao geral (KPIs, fluxo de caixa, aging, maiores clientes), recebiveis, DRE gerencial, clientes e conexoes.

O seletor no topo da barra lateral troca entre uma empresa e o consolidado do tenant.

Os graficos sao SVG proprio, sem biblioteca. A paleta e validada para daltonismo e contraste, e o realizado se distingue do que esta em aberto por hachura, nao so por cor.

Carga inicial de uma conexão nova:

```bash
npm run sync -- --connection <uuid> --kind backfill
```

Fase 0, sem banco, só para medir a API:

```bash
npm run auth        # OAuth, salva em .tokens.json
npm run pull        # baixa tudo para JSON em data/ e imprime volume e latencia
```

## Como funciona a sincronização

Não existe webhook na Conta Azul, então tudo é polling. O caminho incremental usa o endpoint de alterações como CDC:

1. `GET /financeiro/eventos-financeiros/alteracoes` devolve os ids dos eventos tocados desde o último watermark, com 10 minutos de sobreposição.
2. Cada evento é rebuscado por inteiro, porque a API diz que mudou mas não diz o que mudou.
3. O hash do payload decide se grava versão nova. Salvar um registro sem alterar nada gera evento no histórico da Conta Azul, e o hash filtra esse ruído.
4. O watermark só avança depois que tudo entrou. Se cair no meio, a próxima rodada refaz o período sem duplicar.

De madrugada roda uma reconciliação de 90 dias que detecta divergência silenciosa.

## Decisões que valem lembrar

**Chave natural é `(connection_id, external_id)`.** Os ids da Conta Azul só são únicos dentro de uma empresa. Usar só o id externo mistura dados de empresas diferentes.

**Renovação de token sob advisory lock.** O refresh_token rotaciona a cada renovação. Duas renovações em paralelo invalidam a conexão e obrigam o cliente a autorizar tudo de novo.

**Três eixos de data.** Competência para DRE, vencimento para projeção, pagamento da baixa para caixa realizado. Misturar os três é o erro clássico desse tipo de produto.

**Histórico versionado das parcelas.** É o diferencial. Permite responder quanto se previa receber num mês quando ainda era o mês anterior, e medir a qualidade da própria previsão. O ERP não guarda isso.
