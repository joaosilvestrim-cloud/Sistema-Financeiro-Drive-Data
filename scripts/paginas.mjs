// Abre todas as telas com uma sessão de verdade e confere se elas renderizam.
//
// Existe por causa de um erro que passou por todos os outros testes. O painel
// inteiro estava quebrado em produção e:
//
//   - o build passava, porque o JavaScript compilava;
//   - a auditoria de dados passava, porque o SQL estava certo;
//   - o teste da camada de dados passava, porque ele montava a sessão à mão e
//     colocava nela um campo que o requireSession de verdade não devolvia;
//   - o HTTP respondia 200, porque o Next transmite a página em pedaços e a
//     casca sai antes de o componente quebrar.
//
// A única coisa que pega isso é abrir a tela como o navegador abre e procurar
// pela marca da página de erro do Next dentro do que voltou. É o que este script
// faz, contra a máquina local ou contra produção.
//
//   npm run paginas
//   npm run paginas -- https://driveazul.drivedata.com.br

import { pool, query } from '../src/db.mjs'

const BASE = process.argv[2] ?? 'http://localhost:3000'

// Cada rota com um trecho que só existe se a página tiver renderizado até o
// fim. Procurar apenas pela ausência de erro não basta: a casca da página sai
// antes do conteúdo, e uma página que morre no meio ainda devolve 200 com o
// menu inteiro dentro.
const ROTAS = [
  ['/', 'Saldo em conta'],
  ['/resumo', 'Dá para confiar no saldo'],
  ['/fluxo', 'Fluxo de caixa'],
  ['/previsao', 'Projeção'],
  ['/recebiveis', 'Títulos em aberto'],
  ['/notas', 'Notas fiscais'],
  // O caminho que derrubou a tela em producao: a acao falhou, o erro voltou
  // pela URL, e a pagina tem que mostrar o recado em vez de morrer.
  ['/notas?erro=emitente+sem+habilitacao', 'A emissão não foi concluída'],
  ['/dre', 'Total de receitas'],
  ['/precificacao', 'Como o multiplicador sai'],
  ['/impostos', 'Como o número sai'],
  ['/indicadores', 'Prazo'],
  ['/qualidade', 'Qualidade da previsão'],
  ['/clientes', 'Faturado'],
  ['/produtividade', 'Produtividade'],
  ['/metas', 'Metas'],
  ['/fatura', 'Importar fatura'],
  ['/dados', 'auxiliar'],
  ['/conexoes', 'Últimas rodadas'],
  ['/assinar', 'Profissional'],
]
const PUBLICAS = [
  ['/login', 'Entrar'],
  ['/comecar', 'Começar agora'],
  ['/termos', 'Termos de Uso'],
  ['/privacidade', 'Política de Privacidade'],
]

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const EMAIL = 'diagnostico@driveazul.local'
const SENHA = 'Diag!' + Math.random().toString(36).slice(2, 10)

const admin = (path, opts = {}) => fetch(`${URL_SB}/auth/v1/admin${path}`, {
  ...opts,
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
})

async function sessaoDeTeste() {
  const lista = await (await admin('/users?per_page=200')).json()
  for (const u of lista.users ?? []) {
    if (u.email === EMAIL) await admin(`/users/${u.id}`, { method: 'DELETE' })
  }
  const criado = await (await admin('/users', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: SENHA, email_confirm: true }),
  })).json()
  if (!criado.id) throw new Error('nao criou o usuario: ' + JSON.stringify(criado).slice(0, 200))

  const { rows: [t] } = await query('select id from core.tenant order by slug limit 1')
  await query(
    `insert into core.tenant_member (tenant_id, user_id, role) values ($1, $2, 'owner')
     on conflict do nothing`, [t.id, criado.id])

  const login = await (await fetch(`${URL_SB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: SENHA }),
  })).json()
  if (!login.access_token) throw new Error('nao logou: ' + JSON.stringify(login).slice(0, 200))

  const ref = URL_SB.replace('https://', '').split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(login)).toString('base64')}`
  return { cookie, userId: criado.id }
}

// A marca da tela de erro do Next, procurando o elemento e não a regra de
// estilo. O CSS `.next-error-h1{...}` vem embutido em toda página, inclusive nas
// que renderizaram bem, e procurar pelo nome solto acusava as vinte telas.
const QUEBROU = (texto) =>
  texto.includes('class="next-error-h1"') || texto.includes('Application error:')

// Sem o cabeçalho RSC de propósito. Ele sozinho faz o Next devolver 307 para a
// mesma rota com ?_rsc, e o teste mediria o redirecionamento em vez da página.
// O que interessa é o que o navegador recebe, e o await do texto espera o fim da
// transmissão, inclusive o pedaço em que a página quebra.
async function abrir(rota, cookie, esperado) {
  const t0 = Date.now()
  const r = await fetch(BASE + rota, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'manual',
  })
  const corpo = await r.text()
  return {
    status: r.status, ms: Date.now() - t0, bytes: corpo.length,
    quebrou: QUEBROU(corpo),
    temConteudo: esperado ? corpo.includes(esperado) : true,
  }
}

console.log(`alvo: ${BASE}\n`)
const { cookie, userId } = await sessaoDeTeste()
let falhas = 0

function relatar(rota, r) {
  const ok = !r.quebrou && r.status < 400 && r.temConteudo
  if (!ok) falhas++
  const porque = r.quebrou ? 'tela de erro do Next'
    : r.status >= 400 ? 'status ruim'
    : !r.temConteudo ? 'renderizou sem o conteudo esperado'
    : ''
  console.log(
    `  ${ok ? 'ok   ' : 'FALHA'} ${rota.padEnd(16)} ${String(r.status).padStart(3)}  `
    + `${String(r.ms).padStart(5)}ms  ${String(r.bytes).padStart(7)} bytes`
    + (porque ? `  <- ${porque}` : ''),
  )
}

console.log('telas do painel, com sessao:')
for (const [rota, marca] of ROTAS) relatar(rota, await abrir(rota, cookie, marca))

console.log('\ntelas publicas, sem sessao:')
for (const [rota, marca] of PUBLICAS) relatar(rota, await abrir(rota, null, marca))

console.log('\nprotecao das rotas:')
const semSessao = await abrir('/resumo', null)
const protegida = semSessao.status === 307 || semSessao.status === 302
if (!protegida) falhas++
console.log(`  ${protegida ? 'ok   ' : 'FALHA'} /resumo sem sessao devolve ${semSessao.status}, esperado 307`)

const cron = await fetch(BASE + '/api/cron/sync', { redirect: 'manual' })
const cronOk = cron.status === 401
if (!cronOk) falhas++
console.log(`  ${cronOk ? 'ok   ' : 'FALHA'} /api/cron/sync sem segredo devolve ${cron.status}, esperado 401`)

await admin(`/users/${userId}`, { method: 'DELETE' })
console.log(`\n${falhas === 0 ? 'Todas as telas renderizaram.' : `${falhas} FALHA(S).`}`)
await pool.end()
process.exitCode = falhas === 0 ? 0 : 1
