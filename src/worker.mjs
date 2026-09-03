// Worker de sincronização. Processo contínuo, roda fora da Vercel.
//
// A fila é o pg-boss no próprio Postgres, então não entra Redis nem serviço de
// fila novo na conta. Sync longo não cabe em função serverless.
//
// Três agendamentos:
//   scan        de minuto em minuto, enfileira as conexões que venceram o intervalo
//   reconcile   de madrugada, rebusca 90 dias e corrige divergência silenciosa
//   sync        o trabalho em si, uma conexão por vez

import PgBoss from 'pg-boss'
import { listDueConnections } from './connections.mjs'
import { syncConnection } from './sync.mjs'

const FILA = 'sync-connection'

const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  schema: 'pgboss',
})

boss.on('error', (e) => console.error('pg-boss:', e.message))

await boss.start()
await boss.createQueue(FILA)

await boss.work(FILA, { batchSize: 1 }, async ([job]) => {
  const { connectionId, kind } = job.data
  const t0 = Date.now()
  const r = await syncConnection(connectionId, kind)
  console.log(`[${kind}] ${connectionId}: ${r.itens} itens em ${((Date.now() - t0) / 1000).toFixed(1)}s`)
})

// Uma conexão nunca tem duas rodadas em voo. O singletonKey garante isso mesmo
// se o scan rodar enquanto a anterior ainda está processando.
const enfileirar = (connectionId, kind, priority = 0) =>
  boss.send(FILA, { connectionId, kind }, {
    singletonKey: `${connectionId}:${kind}`,
    retryLimit: 2,
    retryBackoff: true,
    expireInMinutes: 120,
    priority,
  })

await boss.schedule('scan-due', '* * * * *', {}, { tz: 'America/Sao_Paulo' })
await boss.work('scan-due', async () => {
  const pendentes = await listDueConnections()
  for (const c of pendentes) await enfileirar(c.id, 'incremental')
  if (pendentes.length) console.log(`scan: ${pendentes.length} conexao(oes) enfileirada(s)`)
})

await boss.schedule('scan-reconcile', '15 4 * * *', {}, { tz: 'America/Sao_Paulo' })
await boss.work('scan-reconcile', async () => {
  const { rows } = await (await import('./db.mjs')).query(
    `select id from core.connection where status = 'connected'`,
  )
  for (const c of rows) await enfileirar(c.id, 'reconcile', -10)
  console.log(`reconcile noturno: ${rows.length} conexao(oes)`)
})

console.log('worker de sincronizacao no ar')

const encerrar = async () => {
  console.log('encerrando...')
  await boss.stop({ graceful: true })
  process.exit(0)
}
process.on('SIGINT', encerrar)
process.on('SIGTERM', encerrar)
