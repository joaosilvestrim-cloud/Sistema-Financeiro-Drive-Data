// Import que ninguém usa.
//
// Parece frescura e não é. Três vezes num dia só, um patch meu aplicou o import
// de uma função nova e falhou em aplicar a chamada, por fim de linha ou por um
// trecho que não casou exatamente. O resultado é pior que um erro: o código
// compila, o teste da camada de dados passa, e a funcionalidade simplesmente
// não existe na tela.
//
// Foi o que aconteceu com o detalhamento dos desvios em Indicadores. A consulta
// estava certa, o teste de conferência passava contra o banco, o import estava
// lá, e a tabela nunca virou linha expansível. Só apareceu numa varredura.
//
// Import sozinho é a assinatura desse defeito. Não prova que falta ligação, mas
// é barato demais para não olhar.
import { readFileSync, globSync } from 'node:fs'

// Import só pelo efeito colateral, sem nome para usar.
const SEM_NOME = new Set(['server-only'])

// Nome de import é sempre identificador, então a fronteira de palavra pode ser
// conferida sem montar expressão regular a partir de texto, que é onde este
// script se quebrou na primeira tentativa.
const IDENT = /[A-Za-z0-9_$]/
function contarUsos(texto, nome) {
  let n = 0
  let i = texto.indexOf(nome)
  while (i !== -1) {
    const antes = i > 0 ? texto[i - 1] : ' '
    const depois = i + nome.length < texto.length ? texto[i + nome.length] : ' '
    if (!IDENT.test(antes) && !IDENT.test(depois)) n++
    i = texto.indexOf(nome, i + nome.length)
  }
  return n
}

const arquivos = [
  ...globSync('app/**/*.js'),
  ...globSync('components/**/*.js'),
  ...globSync('lib/*.js'),
  ...globSync('src/**/*.mjs'),
].sort()

let achados = 0
for (const arq of arquivos) {
  const s = readFileSync(arq, 'utf8').replace(/\r\n/g, '\n')
  const linhaDe = (i) => s.slice(0, i).split('\n').length

  // Import nomeado: { a, b as c }
  for (const m of s.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
    if (SEM_NOME.has(m[2])) continue
    for (const bruto of m[1].split(',')) {
      const nome = bruto.trim().split(/\s+as\s+/).pop()?.trim()
      if (!nome) continue
      if (contarUsos(s, nome) <= 1) {
        achados++
        console.log(`  ${arq}:${linhaDe(m.index)}  ${nome} importado e nunca usado`)
      }
    }
  }

  // Import padrão de componente que nunca aparece no JSX. Esta é a regra que
  // pega o caso do Indicadores: LinhaExpansivel importado, tabela ainda com tr.
  //
  // Só vale onde há JSX. Em src/ um nome com maiúscula é uma classe, como o
  // PgBoss do worker, e cobrar `<PgBoss` seria falso positivo garantido.
  const temJsx = arq.startsWith('app') || arq.startsWith('components')
  for (const m of temJsx ? s.matchAll(/import\s+([A-Z]\w+)\s+from\s*'([^']+)'/g) : []) {
    const nome = m[1]
    if (!s.includes(`<${nome}`)) {
      achados++
      console.log(`  ${arq}:${linhaDe(m.index)}  ${nome} importado e nunca renderizado`)
    }
  }
}

console.log(achados ? `\n${achados} import(s) sem uso.` : '\nNenhum import sobrando.')
process.exit(achados ? 1 : 0)
