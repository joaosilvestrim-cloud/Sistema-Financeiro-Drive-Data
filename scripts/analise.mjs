// Gera a analise do ultimo mes fechado pela linha de comando.
//
//   npm run analise
//   npm run analise -- --mes 2026-07
//
// Serve para o worker rodar isso de madrugada quando o mes virar, e para
// conferir o texto sem depender da tela.

import { pool, query } from '../src/db.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]])
    return acc
  }, []),
)

const t = (await query('select id, nome from core.tenant order by slug limit 1')).rows[0]
if (!t) { console.error('nenhum tenant'); await pool.end(); process.exit(1) }

const { gerarAnalise } = await import('../lib/analise.js')
const sessao = { tenantId: t.id, tenantNome: t.nome, connectionId: null, user: null }

const t0 = Date.now()
const r = await gerarAnalise(sessao, args.mes ?? null)
if (r.erro) {
  console.error('falhou:', r.erro)
  await pool.end()
  process.exit(1)
}

console.log(`\n### ${t.nome} · ${r.analise.competencia}`)
console.log(`modelo ${r.analise.modelo} · ${r.analise.tokens} tokens · ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
console.log(r.analise.texto)
console.log(`\nfatos guardados: ${Object.keys(r.analise.fatos).length} blocos`)
await pool.end()
