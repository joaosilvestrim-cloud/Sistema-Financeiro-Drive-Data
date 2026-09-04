// Testa o leitor da fatura contra o arquivo real do Inter.
import { readFileSync } from 'node:fs'
import { lerFatura, sugerirCategoria } from '../lib/fatura.js'

const arquivo = process.argv[2] ?? 'C:/Users/joaol/Downloads/fatura-inter.csv'
const { compras, pagamentos, vencimento, total } = lerFatura(readFileSync(arquivo, 'utf8'))

const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
console.log(`vencimento ${vencimento} · total da fatura ${brl(total)}\n`)
console.log(`${compras.length} compras:`)
for (const c of compras) console.log(`  ${c.data}  ${brl(c.valor).padStart(12)}  ${c.descricao}`)
console.log(`\n${pagamentos.length} credito(s) ignorado(s):`)
for (const p of pagamentos) console.log(`  ${p.data}  ${brl(p.valor).padStart(12)}  ${p.descricao}`)

const soma = compras.reduce((a, c) => a + c.valor, 0)
const creditos = pagamentos.reduce((a, p) => a + p.valor, 0)
console.log(`\nsoma das compras   ${brl(soma)}`)
console.log(`soma dos creditos  ${brl(creditos)}`)
console.log(`compras - creditos ${brl(soma - creditos)}   (fatura diz ${brl(total)})`)
console.log(`confere: ${Math.abs((soma - creditos) + Number(total)) < 0.01 ? 'sim' : 'NAO'}`)

const impressoes = new Set(compras.map((c) => c.impressao))
console.log(`impressoes digitais unicas: ${impressoes.size} de ${compras.length}`)

// Duas compras identicas no mesmo dia precisam de impressoes diferentes.
const duplicado = `"","01/09/2026","x","ASSINATURA TESTE","SERVICOS","Compra à vista","-R$ 50,00"
"","01/09/2026","x","ASSINATURA TESTE","SERVICOS","Compra à vista","-R$ 50,00"`
const d = lerFatura(duplicado)
console.log(`\nduas compras identicas no mesmo dia: ${d.compras.length} lidas, ${new Set(d.compras.map(c=>c.impressao)).size} impressoes distintas`)
