// Prova que nome proprio nao sai para a Groq.
//
// Monta o dossie real, mascara, e procura no JSON que iria pela rede cada nome
// de cliente e de conta que existe no banco. Se algum aparecer, a politica de
// privacidade esta mentindo e o teste falha.

import { pool, query } from '../src/db.mjs'
import { montarDossie } from '../lib/dossie.js'
import { mascarar, revelar } from '../lib/anonimo.js'

const { rows: [t] } = await query('select id, nome from core.tenant order by slug limit 1')
const sessao = { tenantId: t.id, connectionId: null, conexoes: [] }

const dossie = await montarDossie(sessao)
if (!dossie) { console.error('sem dossie'); await pool.end(); process.exit(1) }

const { dossie: mascarado, mapa } = mascarar(dossie)
const enviado = JSON.stringify(mascarado)

console.log(`${mapa.size} nome(s) trocado(s) por apelido:`)
for (const [apelido, real] of mapa) console.log(`  ${apelido.padEnd(12)} <- ${real}`)

let vazou = 0
for (const [, real] of mapa) {
  if (enviado.includes(real)) { console.log(`  VAZOU: ${real}`); vazou++ }
}

// Confere tambem contra a base inteira, e nao so contra o que foi mascarado:
// um nome pode aparecer em campo que ninguem lembrou de mascarar.
//
// Nome de categoria fica de fora da varredura, de proposito. Categoria e plano
// de contas, nao identifica pessoa, e a IA precisa dela para dizer "o gasto com
// software subiu". O problema e que categoria e fornecedor as vezes tem o mesmo
// nome, como "Simples Nacional", que existe como pessoa e dentro de
// "Parcelamento do Simples Nacional". Varrer o texto inteiro acusaria isso como
// vazamento de fornecedor, e nao e.
const semCategorias = JSON.stringify({
  ...mascarado,
  maiores_categorias_do_mes: undefined,
  desvios_de_categoria: undefined,
  categorias: undefined,
})
const { rows: pessoas } = await query(
  `select distinct nome from core.person where nome is not null and length(nome) > 6 limit 500`,
)
const { rows: contas } = await query(
  `select distinct nome from core.account where nome is not null and length(nome) > 6`,
)
for (const p of [...pessoas, ...contas]) {
  if (semCategorias.includes(p.nome)) { console.log(`  VAZOU (base): ${p.nome}`); vazou++ }
}

console.log(`\n${vazou === 0 ? 'ok: nenhum nome proprio no payload que sai para a Groq' : `FALHA: ${vazou} vazamento(s)`}`)

// E a volta precisa devolver o nome real, senao o produto piora.
const [primeiro] = [...mapa.entries()]
if (primeiro) {
  const frase = `${primeiro[0]} concentra boa parte do faturamento`
  const devolvido = revelar(frase, mapa)
  console.log(`\nvolta: "${frase}"\n    -> "${devolvido}"`)
  console.log(devolvido.includes(primeiro[1]) ? 'ok: nome real volta na tela' : 'FALHA: nao voltou')
}

await pool.end()
process.exitCode = vazou === 0 ? 0 : 1
