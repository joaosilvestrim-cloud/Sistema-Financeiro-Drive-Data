# Plataforma de Analytics Financeiro sobre Conta Azul

Documento de arquitetura e plano de execução.
Data: 03/09/2026. Status: proposta técnica, nada implementado ainda.

---

## 1. O que a API da Conta Azul entrega (pesquisa feita)

Base da API v2: `https://api-v2.contaazul.com`
Auth (Cognito): `https://auth.contaazul.com/login` (authorize) e `https://auth.contaazul.com/oauth2/token`

### Fatos que definem a arquitetura

| Fato | Consequência de projeto |
|---|---|
| OAuth2 Authorization Code, scope `openid profile aws.cognito.signin.user.admin` | Cada empresa autoriza o app uma vez. Um `refresh_token` por empresa. |
| `access_token` dura 3600s | Cache de token com renovação preventiva (renovar aos 50 min). |
| `refresh_token` ROTACIONA a cada renovação | Ponto crítico. Se duas rotinas renovarem em paralelo, a conexão morre. Precisa de lock. |
| Código de autorização vale 3 minutos | Callback tem que trocar o code na hora. |
| NÃO existe webhook | Sincronização é por polling. Nada de tempo real puro. |
| Rate limit: 600 req/min e 10 req/s por empresa conectada | Token bucket por tenant, backoff exponencial no 429. |
| Paginação `pagina` + `tamanho_pagina`, resposta com `itens_totais` | Paginador genérico reutilizável. |
| Sem sandbox oficial. Conta de desenvolvimento dura 30 dias | Fixtures gravadas para teste. Não dependa da conta dev no CI. |
| Datas em ISO 8601, fuso São Paulo GMT-3 | Guardar tudo em UTC no banco e converter na borda. |

### Endpoints que interessam

Financeiro (`financial-apis-openapi`)
- `GET /v1/financeiro/eventos-financeiros/contas-a-receber/buscar`
- `GET /v1/financeiro/eventos-financeiros/contas-a-pagar/buscar`
  Filtros: `data_vencimento_de/ate` (obrigatórios), `data_competencia_de/ate`, `data_pagamento_de/ate`, `data_alteracao_de/ate`, `valor_de/ate`, `status[]`, `ids_contas_financeiras[]`, `ids_categorias[]`, `ids_centros_de_custo[]`, `ids_clientes[]`
  Retorno por parcela: `id`, `descricao`, `data_vencimento`, `data_competencia`, `status`, `status_traduzido` (PERDIDO, RECEBIDO, EM_ABERTO, RENEGOCIADO, RECEBIDO_PARCIAL, ATRASADO), `total`, `pago`, `nao_pago`, `categorias[]`, `data_criacao`, `data_alteracao`
- `GET /v1/financeiro/eventos-financeiros/alteracoes?data_inicio&data_fim` devolve os IDs dos eventos alterados no período. É o CDC da plataforma.
- `GET /v1/financeiro/eventos-financeiros/{id_evento}/parcelas`
- `GET /v1/financeiro/eventos-financeiros/parcelas/{id}` traz rateio, categoria e centro de custo
- `GET /v1/conta-financeira` e `GET /v1/conta-financeira/{id}/saldo-atual`
- `GET /v1/financeiro/eventos-financeiros/saldo-inicial`
- `GET /v1/financeiro/transferencias`
- `GET /v1/categorias`, `GET /v1/categorias/configuracao-padrao`, `GET /v1/financeiro/categorias-dre`
- `GET /v1/centro-de-custo`

Baixas (`acquittance-apis-openapi`)
- `GET /v1/financeiro/eventos-financeiros/parcelas/{parcela_id}/baixa` e `GET .../baixa/{baixa_id}`
  É o regime de caixa de verdade. Sem baixa não existe fluxo de caixa realizado confiável.

Vendas (`sales-apis-openapi`)
- `GET /v1/venda/busca`, `GET /v1/venda/{id}`, `GET /v1/venda/{id}/itens`, `GET /v1/venda/vendedores`

Pessoas (`open-api-person`): `GET /v1/pessoas`
Produtos (`inventory-apis-openapi`): `GET /v1/produto/busca`
Contratos (`contracts-apis-openapi`): `GET /v1/contratos` (receita recorrente)
Cobranças (`charge-apis-openapi`): consulta de cobrança por id

### Limitações reais que o produto precisa contornar
1. Sem webhook. Latência mínima do dado é o intervalo do poller. Vender como "quase tempo real", nunca como tempo real.
2. `buscar` exige janela de `data_vencimento`. Carga inicial tem que ser fatiada por mês. Não dá para pedir "tudo".
3. `alteracoes` só diz que o evento mudou, não diz o que mudou. Logo o worker refaz o fetch do evento inteiro.
4. Salvar um registro sem mudar nada gera entrada no histórico. Vai haver ruído no CDC. Comparar hash do payload antes de gravar versão nova.
5. Não existe endpoint de DRE pronto. O DRE gerencial é nosso, montado em cima de `categorias-dre` mais parcelas.

---

## 2. Produto

Nome de trabalho: **DriveData Finance** (ou CA Insights).

Uma camada de inteligência financeira sobre o ERP. O cliente conecta a Conta Azul em dois cliques e passa a ter o que o ERP não dá: histórico versionado, projeção, cenário, alerta e comparação entre períodos.

### Módulos de analytics
1. Fluxo de caixa realizado por dia, semana e mês, por conta financeira.
2. Fluxo de caixa projetado com base em vencimentos em aberto, ajustado por probabilidade histórica de recebimento por faixa de atraso.
3. Runway e burn rate. Quantos dias de caixa restam no ritmo atual.
4. DRE gerencial mensal por `categorias-dre`, com comparativo mês a mês e ano a ano.
5. Aging de recebíveis e pagáveis (a vencer, 1 a 30, 31 a 60, 61 a 90, 90 mais).
6. Inadimplência: taxa, valor, evolução, ranking de clientes devedores.
7. DSO e DPO (prazo médio de recebimento e de pagamento) e ciclo financeiro.
8. Concentração de receita: Pareto 80/20 e índice HHI por cliente. Risco de dependência.
9. Sazonalidade e tendência por categoria e por centro de custo.
10. Previsão de receita e despesa 3, 6 e 12 meses. Começa com média móvel mais decomposição sazonal. Modelo estatístico depois.
11. Detecção de anomalia: despesa fora do padrão da categoria, salto de custo, cliente que parou de comprar.
12. Cenários what-if: e se eu atrasar X, e se perder o cliente Y, e se cortar Z% de uma categoria.
13. Alertas: saldo projetado negativo em N dias, título vencendo, meta estourada.
14. Metas e orçamento por categoria com realizado versus orçado.

### Diferencial defensável
O ERP mostra o presente. A plataforma guarda o **histórico versionado** de cada parcela. Isso permite responder "quanto eu previa receber em agosto quando ainda era julho" e medir a qualidade da própria previsão. A Conta Azul não guarda isso. Esse é o fosso do produto.

---

## 3. Arquitetura

```
                       +------------------------------+
  Conta Azul API v2 -->|  Connector Layer (provider)  |
   (por empresa)       |  contaazul | omie | bling    |
                       +--------------+---------------+
                                      |  payload cru
                       +--------------v---------------+
                       |  Sync Worker (Node, pg-boss) |
                       |  auth . rate limit . CDC     |
                       +--------------+---------------+
                                      |
        +-----------------------------v------------------------+
        |  Postgres / Supabase   (RLS por tenant_id)           |
        |  raw.*  ->  stg.*  ->  core.*  ->  mart.*            |
        +-----------------------------+------------------------+
                                      |
                       +--------------v---------------+
                       |  Next.js (Vercel) + API      |
                       |  dashboards . alertas . IA   |
                       +------------------------------+
```

### 3.1 Camada de conexão (a peça que vale dinheiro)
Interface `FinancialProvider` com métodos `listReceivables`, `listPayables`, `listSettlements`, `listAccounts`, `listCategories`, `listChangedSince`. A Conta Azul é a primeira implementação. Omie, Bling, Nibo e Granatum entram depois sem tocar em analytics. Sem essa abstração o produto fica preso a um ERP e vale muito menos na hora de vender.

### 3.2 Autenticação e segredos
- Um app OAuth só (client_id da DriveData). Cada empresa faz o consent.
- `redirect_uri` própria: `https://app.dominio.com.br/api/oauth/contaazul/callback`. Precisa ser cadastrada no portal do desenvolvedor. Hoje está apontando para `https://www.google.com/`, que serve para teste manual e não serve para produto.
- `state` assinado (HMAC com nonce e tenant_id, TTL de 5 min) para amarrar o callback ao tenant e evitar CSRF.
- `refresh_token` e `access_token` criptografados no banco. Chave fora do banco (env var no worker, ou Supabase Vault).
- **Renovação com lock**: `pg_advisory_xact_lock(tenant_id)` antes de renovar. Como o refresh rotaciona, dois processos renovando ao mesmo tempo invalidam a conexão. Esse erro derruba integração inteira e é difícil de diagnosticar depois.
- Estado da conexão: `connected`, `expired`, `revoked`. Se cair, e-mail para o cliente com link de reconexão. Sem isso o cliente descobre que parou de sincronizar olhando dado velho.

### 3.3 Ingestão
Backfill (primeira conexão)
- Janela de 36 meses para trás e 24 meses para frente, fatiada por mês, para `contas-a-receber/buscar` e `contas-a-pagar/buscar`.
- Depois busca detalhe de cada parcela (rateio, categoria, centro de custo) e as baixas.
- Dimensões primeiro: contas financeiras, categorias, categorias DRE, centros de custo, pessoas.
- Job com checkpoint por janela. Se cair no meio, retoma de onde parou.

Incremental (a cada 15 min)
1. `GET /financeiro/eventos-financeiros/alteracoes` com `data_inicio = ultimo_watermark - 10 min` (overlap para não perder evento na borda).
2. Para cada id retornado, busca as parcelas do evento e as baixas.
3. Compara hash do payload normalizado. Se igual, ignora. Se diferente, grava versão nova.
4. Avança o watermark só depois do commit.

Reconciliação (diária, de madrugada)
- Rebusca os últimos 90 dias por `data_alteracao` e confere contagem e soma contra o banco. Detecta evento perdido e evento apagado. Sem isso o dado diverge em silêncio e o cliente perde a confiança no produto.

Saldos
- `saldo-atual` de cada conta financeira é fotografado uma vez por dia em `core.account_balance_snapshot`. É a âncora para validar o fluxo de caixa calculado.

Controle de vazão
- Token bucket por tenant, 8 req/s de teto (folga sobre os 10). Fila com prioridade: sync interativo do usuário passa na frente do batch.
- Retry com backoff exponencial e jitter no 429 e no 5xx. Circuit breaker por tenant depois de N falhas seguidas.

### 3.4 Modelo de dados

`raw` (imutável, auditoria e reprocesso)
- `raw.api_payload(tenant_id, provider, resource, external_id, payload jsonb, hash, fetched_at)`

`core` (normalizado, versionado)
- `core.financial_event`, `core.installment`, `core.settlement` (baixa), `core.transfer`
- `core.installment_version(installment_id, valid_from, valid_to, total, pago, status, data_vencimento, ...)` SCD tipo 2. É daqui que sai o histórico de previsão.
- Dimensões: `core.account`, `core.category`, `core.dre_category`, `core.cost_center`, `core.person`, `core.sale`, `core.contract`
- `core.date_dim` com dia, mês, trimestre, ano, dia útil, feriado nacional.

`mart` (leitura rápida, materialized views por tenant)
- `mart.cashflow_daily`, `mart.dre_monthly`, `mart.aging_snapshot`, `mart.customer_metrics`, `mart.kpi_daily`
- Refresh incremental ao fim de cada sync. Dashboard nunca faz agregação pesada em request.

Três eixos de data, sempre explícitos na interface:
- competência (`data_competencia`) para DRE
- vencimento (`data_vencimento`) para projeção
- caixa (`data_pagamento` da baixa) para fluxo realizado

Misturar esses três é o erro clássico desse tipo de produto. O seletor de regime é elemento de primeira classe da interface.

### 3.5 Multi-tenant
- Um banco, `tenant_id` em toda tabela, RLS ligada em tudo. Mesmo padrão do CRM.
- Um tenant tem N conexões de ERP já no v1. Ver decisão 2 na seção 6. Chave natural de todo registro externo é `(connection_id, external_id)`.
- Papéis: owner, financeiro, leitura, contador externo.
- Escape hatch para cliente grande ou exigente: banco dedicado com o mesmo schema. A camada de app já lê a connection string por tenant.

### 3.6 Runtime (definido)
- Repositório: `github.com/joaosilvestrim-cloud/Sistema-Financeiro-Drive-Data`
- App: Next.js na Vercel. Só request curto.
- Banco: Supabase, projeto `ekmqhhfxfkljdxkmlpmi`, PostgreSQL 17.6, região sa-east-1. Conexão testada e funcionando por direct, pooler sessão (5432) e pooler transação (6543).
- Worker: processo Node contínuo (Koyeb) com `pg-boss` no próprio Postgres. Sem Redis, sem fila externa, sem custo novo. Sync longo não cabe em serverless.
- Scheduler: cron do `pg-boss` dentro do worker. GitHub Actions só como gatilho de emergência.
- Observabilidade: tabela `sync_run` com início, fim, recursos, páginas, itens, erros. Página de status por tenant. Sentry para exceção.

Notas de conexão
- A senha do Postgres tem `#`, que precisa ir como `%23` dentro da `DATABASE_URL`. Se não escapar, o driver corta a string na senha.
- Worker usa pooler em modo sessão. Rotas serverless da Vercel usam pooler em modo transação (6543).

### 3.7 IA
- Resumo mensal em linguagem natural: o que mudou, o que preocupa, o que fazer.
- Pergunta em linguagem natural respondida sobre os marts, com SQL gerado em cima de um schema restrito e whitelisted. Nunca SQL livre no banco.
- Explicação de variação: por que a despesa subiu em agosto, com decomposição por categoria.

---

## 4. Riscos

| Risco | Mitigação |
|---|---|
| Ausência de webhook limita a proposta de valor | Vender "atualizado a cada 15 min", medir e mostrar o horário do último sync na tela |
| Rotação do refresh token derruba conexão | Lock na renovação, retry, alerta e fluxo de reconexão em um clique |
| Rate limit em cliente com histórico grande | Backfill em background com progresso visível, janela mensal, prioridade de fila |
| Mudança de contrato da API | Camada raw guarda o payload cru. Reprocessa sem rebuscar. Monitorar o changelog |
| Conta Azul lançar analytics nativo | Fosso é o histórico versionado, a projeção e o multi-ERP |
| LGPD com dado financeiro de terceiros | DPA, termos de uso e aceite eletrônico, criptografia em repouso, direito de exportação e exclusão. Reaproveitar o módulo legal que já existe no CRM |
| Homologação e limite de app no portal | Confirmar cedo com a Conta Azul se app público de terceiro tem restrição de número de conexões |

---

## 5. Fases

**Fase 0 · Prova de conexão (1 a 2 dias)**
Script CLI que faz o fluxo OAuth completo com callback local, guarda os tokens, renova, e baixa 12 meses de contas a receber e a pagar para JSON. O objetivo é medir volume, latência e formato real antes de escrever qualquer schema. Nada de interface.

**Fase 1 · Núcleo de ingestão**
Provider Conta Azul, worker, pg-boss, backfill fatiado, incremental por `alteracoes`, camadas raw e core, `sync_run`, criptografia de token, lock de refresh.

**Fase 2 · Marts e dashboard v1**
Fluxo de caixa realizado e projetado, aging, DRE gerencial, saldo por conta, filtros por categoria e centro de custo. Next.js, RLS, seletor de regime.

**Fase 3 · Inteligência**
Previsão, sazonalidade, DSO e DPO, concentração, anomalia, cenários, metas.

**Fase 4 · Produto vendável**
Onboarding self-service com "Conectar Conta Azul", planos e cobrança, convite de usuário, alertas por e-mail e WhatsApp, página de status, termos e DPA, exportação em Excel e PDF.

**Fase 5 · Expansão**
Segundo provider (Omie ou Bling), API pública de leitura, white label para contabilidade.

Ordem definida: 0, 1, 2, 3, depois 4 e 5. Como o primeiro cliente é a própria DriveData, a Fase 4 (cobrança, planos, onboarding self-service) só faz sentido quando existir cliente externo em vista.

---

## 6. Decisões tomadas (03/09/2026)

**1. Primeiro cliente é a própria DriveData.**
Consequência: a Fase 3 (inteligência) vem antes da Fase 4 (produto vendável). Nada de cobrança, plano ou onboarding self-service no começo. O tenant da DriveData é criado por script. O tempo economizado vai para previsão, cenário e alerta, que é o que decide se o produto se vende depois. Vantagem colateral: dogfooding. Se o DRE gerencial não bater com o que o financeiro da casa enxerga, o erro aparece antes de qualquer cliente pagar.

**2. Multiempresa por tenant já no v1.**
Essa é a decisão que mais mexe no modelo de dados, e é bem mais barata agora do que depois.
- Toda tabela de fato carrega `tenant_id` **e** `connection_id`. Uma conexão é uma empresa autorizada na Conta Azul, com o seu próprio par de tokens e o seu próprio watermark de sync.
- `core.connection(id, tenant_id, provider, external_company_id, nome, status, access_token_enc, refresh_token_enc, expires_at, last_sync_at)`.
- Os IDs da Conta Azul (categoria, conta financeira, centro de custo, pessoa) só são únicos dentro de uma empresa. A chave natural em todo lugar é `(connection_id, external_id)`. Nunca só `external_id`. Errar isso mistura o dado de duas empresas e é quase impossível de desfazer depois.
- Rate limit é por empresa conectada, então cada conexão tem o seu próprio balde de vazão. Duas empresas sincronizam em paralelo sem uma atrapalhar a outra.
- Interface: seletor de empresa no topo, mais a opção "consolidado".
- Pegadinha do consolidado: cada empresa tem o seu plano de contas. Somar categoria por nome dá número errado. Precisa de `core.canonical_category` e um de-para por conexão. No v1 o de-para é manual, com sugestão automática por similaridade de nome e por `entrada_dre`. Sem isso o DRE consolidado é ficção.

**3. Dashboard próprio.**
Next.js e componentes próprios. Sem Power BI embutido, sem licença por usuário, sem dependência de Azure. O portal-bi continua sendo produto separado. Isso mantém o produto vendável por assinatura simples e o gráfico interativo dentro da nossa stack.

### Ainda em aberto
4. Cadência de sync. Assumido para o v1: **1 hora** por conexão, mais um botão "sincronizar agora" que enfileira com prioridade alta. Uso interno não justifica 15 min, e 1 h corta o custo de worker e o consumo de rate limit. Fácil de baixar para 15 min quando entrar cliente externo, é só configuração por conexão.

---

## 7. Fontes
- https://developers.contaazul.com/aboutapis
- https://developers.contaazul.com/auth
- https://developers.contaazul.com/changecode
- https://developers.contaazul.com/renewingaccesstoken
- https://developers.contaazul.com/authorize-multiple-clients
- https://developers.contaazul.com/faq
- https://developers.contaazul.com/docs/financial-apis-openapi/v1
- https://developers.contaazul.com/docs/acquittance-apis-openapi
- https://developers.contaazul.com/docs/sales-apis-openapi
- https://developers.contaazul.com/open-api-docs/open-api-person
