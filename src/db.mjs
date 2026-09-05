import pg from 'pg'

// numeric volta como string por padrão no driver. Nesse produto todo numeric é
// dinheiro em escala 2, então converter para Number é seguro e evita erro bobo
// de somar string em relatório.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)))

// Criado sob demanda, e nao na importacao.
//
// Este modulo nasceu para o worker, onde derrubar o processo cedo era o certo.
// Hoje o app tambem chega aqui, pela tela de fatura, e o build do Next importa
// a rota so para coletar configuracao. Um process.exit no import derrubava o
// build inteiro por causa de uma variavel que so faz falta em requisicao.
//
// A ordem das variaveis depende de onde o codigo esta rodando, e inverte-la
// custa caro.
//
// Na minha maquina e no worker vale DATABASE_URL, a conexao direta em modo
// sessao, porque sao processos longos e poucos.
//
// Na Vercel vale o pooler, sempre. Cada invocacao de funcao abre a propria
// conexao e some, e conexao direta em modo sessao nao e devolvida a tempo: com
// o cron rodando de 30 em 30 minutos mais o trafego das telas, o limite do
// Postgres estoura e o erro aparece como "too many connections" numa tela
// qualquer, longe da causa. Se as duas variaveis existirem la, como existem
// hoje, escolher DATABASE_URL seria escolher errado em silencio.
//
// O advisory lock deste modulo e por transacao de proposito, entao vale nos
// dois modos.
function connectionString() {
  const naVercel = !!process.env.VERCEL
  const url = naVercel
    ? (process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL)
    : (process.env.DATABASE_URL || process.env.DATABASE_URL_POOLED)
  if (!url) {
    throw new Error(
      'Falta DATABASE_URL (ou DATABASE_URL_POOLED) no ambiente. ' +
      'Cadastre a variavel e refaca o deploy. Ver docs/DEPLOY.md.',
    )
  }
  return url
}

const globalParaPg = globalThis

export function getPool() {
  if (!globalParaPg.__pgPoolWorker) {
    globalParaPg.__pgPoolWorker = new pg.Pool({
      connectionString: connectionString(),
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: 30_000,
    })
  }
  return globalParaPg.__pgPoolWorker
}

// Os scripts fecham o pool no fim com pool.end(). O proxy mantem essa chamada
// funcionando sem abrir conexao so por existir uma importacao.
export const pool = new Proxy({}, {
  get: (_, prop) => {
    const p = getPool()
    const v = p[prop]
    return typeof v === 'function' ? v.bind(p) : v
  },
})

export const query = (text, params) => getPool().query(text, params)

export async function tx(fn) {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    const out = await fn(client)
    await client.query('commit')
    return out
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}

// Serializa por conexão. Usado na renovação do token, que não pode acontecer
// duas vezes em paralelo porque o refresh_token da Conta Azul rotaciona.
export async function withConnectionLock(connectionId, fn) {
  return tx(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [connectionId])
    return fn(client)
  })
}
