// Exercita a agenda que o cron da Vercel chama.
import { pool, query } from '../src/db.mjs'
import { rodarAgenda, encerrarTestesVencidos } from '../src/agenda.mjs'

console.log('== estado antes ==')
const antes = await query(`
  select c.nome, c.status, c.last_sync_at, c.updated_at, c.sync_interval_minutes,
         t.status tenant_status, t.plano
    from core.connection c join core.tenant t on t.id = c.tenant_id`)
console.table(antes.rows.map(r => ({
  conexao: r.nome, status: r.status, plano: r.plano, tenant: r.tenant_status,
  ultimo_sync: r.last_sync_at ? new Date(r.last_sync_at).toISOString().slice(0,16) : null,
  intervalo_min: r.sync_interval_minutes,
})))

const vencidos = await encerrarTestesVencidos()
console.log(`\ntestes encerrados: ${vencidos.length ? vencidos.map(v=>v.nome).join(', ') : 'nenhum'}`)

console.log('\n== rodando a agenda com orcamento de 40s ==')
const t0 = Date.now()
const r = await rodarAgenda({ orcamentoMs: 40_000 })
console.log(`levou ${((Date.now()-t0)/1000).toFixed(1)}s`)
console.log(JSON.stringify(r, null, 2))

console.log('\n== estado depois ==')
const depois = await query(`select nome, last_sync_at, updated_at, last_error from core.connection`)
console.table(depois.rows.map(r => ({
  conexao: r.nome,
  ultimo_sync: r.last_sync_at ? new Date(r.last_sync_at).toISOString().slice(0,16) : null,
  token_tocado: r.updated_at ? new Date(r.updated_at).toISOString().slice(0,16) : null,
  erro: r.last_error?.slice(0,50) ?? null,
})))
await pool.end()
