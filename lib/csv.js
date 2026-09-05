// Leitor de planilha colada ou de arquivo.
//
// Sem 'server-only' de proposito: e logica pura, e logica pura precisa de teste
// que rode sem banco e sem servidor.

// O separador é decidido antes de quebrar a linha, e nesta ordem, porque em
// português a vírgula é decimal. Se ela também valesse como separador de
// coluna, "R$ 160.000,50" viraria duas colunas e o valor cairia para 160 sem
// erro nenhum aparecer, que é o pior jeito de errar.
function separadorDe(linhas) {
  const amostra = linhas.slice(0, 5).join('\n')
  if (amostra.includes(';')) return ';'
  if (amostra.includes('\t')) return '\t'
  return ','
}

// Aceita ponto e vírgula, tabulação ou vírgula, porque planilha em português
// exporta com ponto e vírgula e ninguém deveria precisar saber disso. O valor
// aceita tanto 1.234,56 quanto 1234.56.
export function lerCsv(texto) {
  const linhas = String(texto ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const pontos = []
  const erros = []
  const sep = separadorDe(linhas)

  for (const [i, linha] of linhas.entries()) {
    const partes = linha.split(sep).map((p) => p.trim().replace(/^"|"$/g, ''))
    if (partes.length < 2) continue

    const [bruto, valorBruto, dimensao] = partes
    const competencia = normalizarCompetencia(bruto)
    if (!competencia) {
      // A primeira linha costuma ser cabeçalho. Só vira erro se vier no meio.
      if (i > 0) erros.push(`linha ${i + 1}: "${bruto}" não é uma competência`)
      continue
    }

    const valor = normalizarNumero(valorBruto)
    if (valor === null) {
      erros.push(`linha ${i + 1}: "${valorBruto}" não é um número`)
      continue
    }
    pontos.push({ competencia, valor, dimensao: dimensao || '' })
  }
  return { pontos, erros }
}

// Aceita 2026-01, 01/2026, jan/26 e 2026-01-15.
function normalizarCompetencia(texto) {
  const t = String(texto ?? '').trim()
  let m = t.match(/^(\d{4})-(\d{2})(-\d{2})?$/)
  if (m) return `${m[1]}-${m[2]}`
  m = t.match(/^(\d{2})\/(\d{4})$/)
  if (m) return `${m[2]}-${m[1]}`
  m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}`
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  m = t.toLowerCase().match(/^([a-zç]{3})[a-zç]*[\/\- ](\d{2,4})$/)
  if (m) {
    const idx = MESES.indexOf(m[1])
    if (idx >= 0) {
      const ano = m[2].length === 2 ? `20${m[2]}` : m[2]
      return `${ano}-${String(idx + 1).padStart(2, '0')}`
    }
  }
  return null
}

// 1.234,56 e 1234.56 são o mesmo número. R$ e espaços são ruído.
function normalizarNumero(texto) {
  let t = String(texto ?? '').replace(/[R$\s%]/gi, '').trim()
  if (!t) return null
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.')
  else if (t.includes(',')) t = t.replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// --------------------------------------------------------- escrita
//
// Geração de CSV para abrir no Excel em português. Três decisões separam um
// arquivo que abre de um arquivo que vira uma coluna só de lixo:
//
// 1. Ponto e vírgula como separador, pelo mesmo motivo que o leitor acima o
//    procura primeiro: em português a vírgula é decimal, e um CSV separado por
//    vírgula joga a planilha inteira numa coluna.
//
// 2. Vírgula no decimal. Número com ponto entra no Excel pt-BR como texto, e
//    texto não soma.
//
// 3. BOM no começo. Sem ele o Excel lê como Latin-1 e "Conciliação" vira
//    "ConciliaÃ§Ã£o".

const BOM = '﻿'

const escapar = (valor) => {
  const texto = String(valor ?? '')
  // Aspas, quebra de linha ou o próprio separador dentro do valor obrigam a
  // envolver em aspas e a dobrar as aspas internas.
  return /["\n\r;]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto
}

const formatar = (valor, tipo) => {
  if (valor === null || valor === undefined) return ''
  if (tipo === 'dinheiro' || tipo === 'numero') {
    const n = Number(valor)
    return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : ''
  }
  if (tipo === 'inteiro') {
    const n = Number(valor)
    return Number.isFinite(n) ? String(Math.round(n)) : ''
  }
  if (tipo === 'percentual') {
    const n = Number(valor)
    return Number.isFinite(n) ? (n * 100).toFixed(2).replace('.', ',') : ''
  }
  if (tipo === 'data') {
    const d = valor instanceof Date ? valor : new Date(valor)
    return Number.isNaN(d.getTime())
      ? String(valor)
      : d.toISOString().slice(0, 10).split('-').reverse().join('/')
  }
  return valor
}

// `colunas` é uma lista de [chave, rótulo, tipo]. O tipo decide o formato e o
// padrão é texto.
export function paraCsv(linhas, colunas) {
  const cabecalho = colunas.map(([, rotulo]) => escapar(rotulo)).join(';')
  const corpo = (linhas ?? []).map((linha) =>
    colunas.map(([chave, , tipo]) => escapar(formatar(linha[chave], tipo))).join(';'),
  )
  return BOM + [cabecalho, ...corpo].join('\r\n') + '\r\n'
}

// A data entra no nome. Quem exporta a mesma tela em dois dias fica com dois
// arquivos identificáveis, e não com "clientes (1).csv".
export function nomeDoArquivo(base) {
  return `driveazul-${base}-${new Date().toISOString().slice(0, 10)}.csv`
}
