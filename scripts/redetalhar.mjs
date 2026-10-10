// Passa pelo detalhe da API os títulos de uma conexão que o espelho não pode
// garantir: os que só vieram pela busca (sem id de evento) e todos os abertos.
//
// Existe por causa da auditoria de 10/10/2026, que comparou dois tenants da
// mesma empresa no Conta Azul. Achou título apagado no ERP ainda em aberto no
// espelho, título sem conta financeira e total líquido de taxa no lugar do
// bruto. O sync novo já não produz nada disso; este script conserta o que
// ficou para trás. Roda quantas vezes quiser: o ingest é idempotente.
//
//   node --env-file=.env scripts/redetalhar.mjs            (todas as conexões)
//   node --env-file=.env scripts/redetalhar.mjs <conexao>  (só uma)
import { pool, query } from '../src/db.mjs'
import { clientFor } from '../src/connections.mjs'
import { contaAzulProvider } from '../src/providers/contaazul.mjs'
import { loadDimensionMaps } from '../src/ingest.mjs'
import { rebuscarParcelas } from '../src/sync.mjs'

const alvo = process.argv[2] ?? null
const { rows: conexoes } = await query(
  `select c.id, c.tenant_id, t.nome from core.connection c join core.tenant t on t.id = c.tenant_id
    where c.status = 'connected' and c.provider = 'contaazul' and ($1::uuid is null or c.id = $1)`,
  [alvo],
)

for (const c of conexoes) {
  const ctx = { tenantId: c.tenant_id, connectionId: c.id }
  const api = contaAzulProvider(clientFor(c.id))
  const maps = await loadDimensionMaps(ctx)
  const { rows } = await query(
    `select external_id from core.installment
      where connection_id = $1 and deleted_at is null
        and (event_external_id is null or coalesce(nao_pago, 0) > 0.009)
      order by data_vencimento`,
    [c.id],
  )
  const inicio = Date.now()
  const r = await rebuscarParcelas(ctx, api, maps, rows.map((x) => x.external_id))
  console.log(`${c.nome}: ${rows.length} na fila, ${r.varridos} rebuscados, ${r.corrigidos} corrigidos, `
    + `${r.excluidos} excluidos no ERP, ${Math.round((Date.now() - inicio) / 1000)} s`)
}
await pool.end()
