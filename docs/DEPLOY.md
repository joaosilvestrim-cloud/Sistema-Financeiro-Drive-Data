# Deploy do DriveAzul

O app web vai para a Vercel. O worker de sincronização não vai, porque função
serverless tem limite de tempo e a carga inicial leva minutos.

## 1. Variáveis de ambiente na Vercel

Sem elas o middleware não sobe e a Vercel responde `MIDDLEWARE_INVOCATION_FAILED`,
sem dizer o motivo. Cadastre as três em Settings, Environment Variables,
marcando Production, Preview e Development.

| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | a chave `anon` do projeto |
| `DATABASE_URL_POOLED` | string do **pooler em modo transação** |
| `CONTAAZUL_CLIENT_ID` | do app de produção no portal |
| `CONTAAZUL_CLIENT_SECRET` | do app de produção no portal |
| `CONTAAZUL_REDIRECT_URI` | `https://<dominio>/api/oauth/contaazul/callback`, igual à cadastrada no portal |
| `OAUTH_STATE_SECRET` | assina o `state` do OAuth |
| `TOKEN_ENCRYPTION_KEY` | **a mesma da sua máquina e do worker** |

A string do pooler tem esta forma, e repare que o usuário leva o ref do projeto:

```
postgresql://postgres.<ref>:<senha>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
```

Dois detalhes que quebram o deploy em silêncio:

- **Porta 6543, não 5432.** Em serverless cada instância abre suas próprias
  conexões e o modo sessão estoura o limite do banco rápido. O modo transação
  devolve a conexão a cada consulta.
- **Senha URL-encoded.** O `#` da senha precisa virar `%23`. Sem isso o driver
  corta a string no meio e o erro que aparece é de autenticação, que manda você
  procurar no lugar errado.

A `TOKEN_ENCRYPTION_KEY` precisa ser exatamente a mesma nos três lugares: sua
máquina, o worker e a Vercel. Quem cifra o token é quem recebe a autorização, e
quem decifra é quem sincroniza. Chaves diferentes e a conexão nasce ilegível
para o worker, com um erro de autenticação que não explica a causa.

Não cadastre a `SUPABASE_SERVICE_ROLE_KEY` na Vercel. O app web não usa: ela só
serve para o script que cria usuário, que roda na sua máquina.

Depois de cadastrar, refaça o deploy. Variável nova não entra em deploy antigo.

## 2. Primeiro acesso

O app não tem tela de cadastro por decisão de projeto: quem entra é convidado.
Da sua máquina:

```bash
npm run invite -- --email voce@drivedata.com.br --senha "uma senha forte" --tenant drivedata --role owner
```

Isso cria o usuário no Supabase Auth e o vincula ao tenant. Sem o vínculo o
login funciona mas a aplicação devolve para a tela de entrada, porque a sessão
não resolve nenhum tenant.

Rodar de novo com o mesmo e-mail troca a senha e atualiza o papel. É o caminho
para redefinir senha sem abrir o painel do Supabase.

## 3. Worker

O worker é um processo contínuo. Sobe em Koyeb, Fly ou qualquer lugar que rode
um container. Ele precisa de:

- `DATABASE_URL` (modo sessão, porta 5432 ou o pooler na 5432)
- `TOKEN_ENCRYPTION_KEY` (a mesma que cifrou os tokens, senão nenhuma conexão abre)
- `CONTAAZUL_CLIENT_ID`, `CONTAAZUL_CLIENT_SECRET`, `CONTAAZUL_REDIRECT_URI`

```bash
npm run worker
```

## 4. Checagem rápida quando algo falha

| Sintoma | Causa quase sempre |
|---|---|
| `MIDDLEWARE_INVOCATION_FAILED` | faltou `NEXT_PUBLIC_SUPABASE_URL` ou a chave anon |
| Página de erro dizendo que falta `DATABASE_URL` | faltou `DATABASE_URL_POOLED` |
| Erro de autenticação no banco | `#` da senha não virou `%23` |
| Timeout ou `too many connections` | está usando a porta 5432 no app; troque para 6543 |
| Login entra e volta para a tela de login | usuário sem vínculo em `core.tenant_member` |
| Dashboard vazio | tenant sem conexão sincronizada, ou empresa errada no seletor |

Com as variáveis certas, o middleware passa a responder com o diagnóstico em
texto em vez de derrubar a função, então a própria página diz o que falta.
