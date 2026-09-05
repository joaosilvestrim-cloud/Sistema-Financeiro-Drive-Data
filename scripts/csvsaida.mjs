// Confere o CSV que sai para o Excel em portugues.
import { paraCsv, nomeDoArquivo } from '../lib/csv.js'

let falhas = 0
const ok = (nome, cond, det = '') => { if (!cond) falhas++; console.log(`  ${cond ? 'ok   ' : 'FALHA'} ${nome.padEnd(50)} ${det}`) }

const colunas = [
  ['cliente', 'Cliente', 'texto'],
  ['valor', 'Valor', 'dinheiro'],
  ['titulos', 'Títulos', 'inteiro'],
  ['parte', 'Participação', 'percentual'],
  ['venc', 'Vencimento', 'data'],
]
const linhas = [
  { cliente: 'COFERLY COSMETICA LTDA.', valor: 9720.5, titulos: 3, parte: 0.087, venc: '2026-09-15' },
  { cliente: 'CAZETTA; ZANGIROLAMI', valor: -1744.82, titulos: 1, parte: 0.0161, venc: new Date('2026-10-01') },
  { cliente: 'Com "aspas" dentro', valor: null, titulos: 0, parte: null, venc: null },
]

const csv = paraCsv(linhas, colunas)
const l = csv.split('\r\n')

ok('comeca com BOM, para o Excel ler acento', csv.charCodeAt(0) === 0xFEFF)
ok('separa por ponto e virgula', l[0] === '﻿Cliente;Valor;Títulos;Participação;Vencimento')
ok('decimal com virgula', l[1].includes('9720,50'), l[1].split(';')[1])
ok('negativo preservado', l[2].includes('-1744,82'))
ok('percentual vira numero de 0 a 100', l[1].includes('8,70'))
ok('data em dd/mm/aaaa', l[1].includes('15/09/2026'))
ok('objeto Date tambem vira data', l[2].includes('01/10/2026'))
ok('valor com ponto e virgula sai entre aspas', l[2].startsWith('"CAZETTA; ZANGIROLAMI"'))
ok('aspas internas dobradas', l[3].includes('"Com ""aspas"" dentro"'))
ok('nulo vira celula vazia', l[3].endsWith(';;0;;'), l[3].slice(-6))
ok('quebra de linha do Windows', csv.includes('\r\n'))
ok('lista vazia ainda gera cabecalho', paraCsv([], colunas).split('\r\n')[0].includes('Cliente'))
ok('nome do arquivo leva a data', /^driveazul-clientes-\d{4}-\d{2}-\d{2}\.csv$/.test(nomeDoArquivo('clientes')))

console.log('\n' + (falhas === 0 ? 'Tudo passou.' : `${falhas} FALHA(S).`))
process.exitCode = falhas === 0 ? 0 : 1
