// Ensaio da carga inicial fatiada.
//
// Roda contra a conexao real com orcamento curto, so para provar que a carga
// para no meio, grava onde parou e retoma do mesmo lugar. O ingest e
// idempotente, entao reprocessar janela nao duplica nada.
//
// No fim apaga o job para nao deixar o onboarding achando que ha carga pendente.

import { pool, query } from '../src/db.mjs'
import { criarCarga, avancarCarga, progressoCarga } from '../src/carga.mjs'

const { rows: [c] } = await query(
  `select id, nome, tenant_id from core.connection
    where status = 'connected' order by nome limit 1`,
)
if (!c) { console.error('nenhuma conexao conectada'); await pool.end(); process.exit(1) }

console.log(`conexao: ${c.nome}\n`)
await query('delete from core.onboarding_job where connection_id = $1', [c.id])
await criarCarga(c.tenant_id, c.id)

const antes = Number((await query(
  'select count(*) n from core.installment where connection_id = $1', [c.id])).rows[0].n)
console.log(`parcelas antes: ${antes}\n`)

// Fatias curtas de proposito: cada uma tem que parar no meio e a seguinte tem
// que continuar do mesmo mes.
for (let i = 1; i <= 3; i++) {
  const t0 = Date.now()
  const p = await avancarCarga(c.id, 10_000)
  console.log(
    `fatia ${i}  ${((Date.now() - t0) / 1000).toFixed(1)}s  ` +
    `${String(p.percentual).padStart(3)}%  ${p.etapa} janela ${p.janela}/${p.janelas_total}  ` +
    `${p.itens} itens  status ${p.status}` + (p.erro ? `  ERRO ${p.erro}` : ''),
  )
  if (p.status === 'concluido' || p.status === 'erro') break
}

const depois = Number((await query(
  'select count(*) n from core.installment where connection_id = $1', [c.id])).rows[0].n)
const versoes = Number((await query(
  'select count(*) n from core.installment_version v join core.installment i on i.id = v.installment_id where i.connection_id = $1', [c.id])).rows[0].n)
console.log(`\nparcelas depois: ${depois}  (${depois - antes} novas)`)
console.log(`versoes SCD2: ${versoes}`)
console.log(depois === antes
  ? 'ok: reprocessar as mesmas janelas nao criou parcela duplicada'
  : 'ATENCAO: contagem de parcelas mudou')

const final = await progressoCarga(c.id)
console.log(`\nprogresso guardado: ${final.etapa} janela ${final.janela}, status ${final.status}`)
await query('delete from core.onboarding_job where connection_id = $1', [c.id])
console.log('job de teste removido.')
await pool.end()
