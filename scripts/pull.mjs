// Fase 0: baixa dimensoes e movimento financeiro para JSON em data/.
// O objetivo e medir volume, latencia e formato real antes de desenhar o schema.
// Nada aqui vai para producao. E instrumento de medicao.

import { mkdir, writeFile } from 'node:fs/promises'
import { config } from '../src/config.mjs'
import { ContaAzul, monthWindows, stats } from '../src/contaazul.mjs'

const ca = new ContaAzul()
const report = []

await mkdir(config.dataDir, { recursive: true })

const save = (nome, dados) =>
  writeFile(`${config.dataDir}/${nome}.json`, JSON.stringify(dados, null, 2))

async function coletar(nome, fn) {
  const t0 = Date.now()
  try {
    const itens = await fn()
    await save(nome, itens)
    report.push({ recurso: nome, itens: itens.length, ms: Date.now() - t0, erro: '' })
    console.log(`ok   ${nome}: ${itens.length} itens em ${Date.now() - t0}ms`)
  } catch (e) {
    report.push({ recurso: nome, itens: 0, ms: Date.now() - t0, erro: e.message.slice(0, 160) })
    console.error(`FALHA ${nome}: ${e.message.slice(0, 300)}`)
  }
}

console.log('\n== dimensoes ==')
await coletar('contas-financeiras', async () => (await ca.getAll('/v1/conta-financeira')).itens)
await coletar('categorias', async () => (await ca.getAll('/v1/categorias', { permite_apenas_filhos: false })).itens)
await coletar('categorias-dre', async () => (await ca.getAll('/v1/financeiro/categorias-dre')).itens)
await coletar('centros-de-custo', async () => (await ca.getAll('/v1/centro-de-custo')).itens)
await coletar('pessoas', async () => (await ca.getAll('/v1/pessoas')).itens)

console.log('\n== movimento financeiro ==')
const janelas = monthWindows(config.monthsBack, config.monthsForward)
console.log(`${janelas.length} janelas mensais, de ${janelas[0][0]} a ${janelas.at(-1)[1]}`)

async function parcelas(tipo) {
  const path = `/v1/financeiro/eventos-financeiros/contas-a-${tipo}/buscar`
  const todas = []
  for (const [de, ate] of janelas) {
    const { itens } = await ca.getAll(path, { data_vencimento_de: de, data_vencimento_ate: ate })
    todas.push(...itens)
    process.stdout.write(`  ${de} -> ${itens.length}\n`)
  }
  return todas
}

await coletar('contas-a-receber', () => parcelas('receber'))
await coletar('contas-a-pagar', () => parcelas('pagar'))

console.log('\n== CDC (eventos alterados nos ultimos 7 dias) ==')
await coletar('alteracoes-7d', async () => {
  const fim = new Date()
  const ini = new Date(Date.now() - 7 * 86400e3)
  const { itens } = await ca.getAll('/v1/financeiro/eventos-financeiros/alteracoes', {
    data_inicio: ini.toISOString(),
    data_fim: fim.toISOString(),
  })
  return itens
})

console.log('\n== saldo das contas financeiras ==')
await coletar('saldos-atuais', async () => {
  const contas = (await ca.getAll('/v1/conta-financeira')).itens
  const saldos = []
  for (const c of contas) {
    try {
      saldos.push({ conta: c, saldo: await ca.get(`/v1/conta-financeira/${c.id}/saldo-atual`) })
    } catch (e) {
      saldos.push({ conta: c, erro: e.message.slice(0, 160) })
    }
  }
  return saldos
})

console.log('\n== resumo ==')
console.table(report)
console.log(
  `requisicoes: ${stats.requests} | retries: ${stats.retries} | ` +
  `payload: ${(stats.bytes / 1024 / 1024).toFixed(2)} MB | ` +
  `tempo em rede: ${(stats.ms / 1000).toFixed(1)}s | ` +
  `media: ${Math.round(stats.ms / Math.max(stats.requests, 1))}ms por chamada`,
)
await save('_relatorio', { geradoEm: new Date().toISOString(), report, stats })
console.log(`\nArquivos em ${config.dataDir}/`)
