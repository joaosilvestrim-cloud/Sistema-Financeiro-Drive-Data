// Ensaio da importação de fatura, sem tocar no ERP.
//
// Roda prepararFatura contra o banco real: lê a fatura, consulta categoria,
// conta e fornecedor da empresa e mostra o que seria enviado. Nada é gravado e
// nenhum POST sai daqui. É a única forma de conferir a sugestão de categoria
// sem criar despesa de teste num ERP que não tem como apagar lançamento.

import { readFileSync } from 'node:fs'
import { pool, query } from '../src/db.mjs'
import { prepararFatura } from '../lib/faturaServidor.js'

const arquivo = process.argv[2] ?? 'C:/Users/joaol/Downloads/fatura-inter.csv'
const { rows: [t] } = await query(`select id, nome from core.tenant order by slug limit 1`)
if (!t) { console.error('nenhum tenant'); await pool.end(); process.exit(1) }

const r = await prepararFatura({ tenantId: t.id }, readFileSync(arquivo, 'utf8'))
if (r.erro) { console.error(r.erro); await pool.end(); process.exit(1) }

const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const nome = new Map(r.categorias.map((c) => [c.id, c.nome]))

console.log(`${t.nome} · fatura vence ${r.vencimento}`)
console.log(`${r.resumo.compras} compras, ${r.resumo.novas} novas, ${r.resumo.repetidas} já importadas`)
console.log(`${r.categorias.length} categorias de despesa, ${r.contas.length} contas, ${r.pessoas.length} pessoas\n`)

for (const l of r.linhas) {
  const cat = l.categoria_id ? nome.get(l.categoria_id) : '— SEM CATEGORIA —'
  console.log(`  ${l.data}  ${brl(l.valor).padStart(12)}  ${l.descricao.padEnd(40).slice(0, 40)}  ${cat}`)
  if (l.motivo) console.log(`${' '.repeat(64)}${l.motivo}`)
}

console.log(`\nsoma a enviar ${brl(r.resumo.soma)} · ${r.resumo.semCategoria} sem categoria`)
console.log('\ncontas disponiveis:')
for (const c of r.contas) console.log(`  ${c.tipo ?? '?'} · ${c.nome}`)
console.log('\nnada foi enviado ao ERP.')

await pool.end()
