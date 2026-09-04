// Prepara a leitura da IA de todos os indicadores.
//
//   npm run insights
//
// Existe para rodar logo depois do sync: a primeira geracao leva alguns
// segundos e nao e para o usuario esperar por ela. Com o cache quente, quem
// abre a tela ja encontra os bullets prontos.

import { pool, query } from '../src/db.mjs'

const tenants = (await query('select id, nome from core.tenant order by slug')).rows
if (!tenants.length) { console.error('nenhum tenant'); await pool.end(); process.exit(1) }

const { insights } = await import('../lib/insights.js')
let falhas = 0

for (const t of tenants) {
  const conexoes = (await query(
    `select id, nome, status, last_sync_at, sync_interval_minutes
       from core.connection where tenant_id = $1 order by nome`, [t.id],
  )).rows

  // O consolidado do tenant e cada empresa separadamente, que sao os escopos
  // que o seletor da barra lateral oferece.
  const escopos = [null, ...conexoes.map((c) => c.id)]

  for (const connectionId of escopos) {
    const t0 = Date.now()
    const b = await insights({
      tenantId: t.id, tenantNome: t.nome, connectionId, conexoes, user: null,
    })
    const n = Object.keys(b).length
    const alvo = connectionId ? conexoes.find((c) => c.id === connectionId)?.nome : 'consolidado'
    if (n === 0) falhas++
    console.log(`${n ? 'ok   ' : 'FALHA'} ${t.nome} · ${alvo}: ${n} bullets em ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  }
}

await pool.end()
process.exit(falhas ? 1 : 0)
