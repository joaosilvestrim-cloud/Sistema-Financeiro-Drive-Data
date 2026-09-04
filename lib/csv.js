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
