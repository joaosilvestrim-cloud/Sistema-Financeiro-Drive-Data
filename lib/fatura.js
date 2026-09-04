import { createHash } from 'node:crypto'

// Leitor da fatura de cartão exportada pelo banco.
//
// Sem 'server-only': é lógica pura e precisa rodar em teste, sem banco e sem
// servidor. O arquivo do Inter tem cabeçalho, linhas de cartão e vencimento,
// linhas em branco e um total no fim. Tudo isso é ruído e é descartado aqui.

const num = (texto) => {
  const t = String(texto ?? '').replace(/[R$\s.]/g, '').replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const data = (texto) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(texto ?? '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

// Colunas entre aspas, com vírgula dentro do valor. Um split simples quebraria
// "-R$ 668,84" em duas colunas.
function celulas(linha) {
  const saida = []
  let atual = ''
  let dentro = false
  for (const c of linha) {
    if (c === '"') { dentro = !dentro; continue }
    if (c === ',' && !dentro) { saida.push(atual); atual = ''; continue }
    atual += c
  }
  saida.push(atual)
  return saida.map((s) => s.trim())
}

// A ocorrencia entra na impressao porque a mesma compra pode aparecer duas
// vezes no mesmo dia pelo mesmo valor, e acontece: duas assinaturas iguais, dois
// creditos de servico. Sem ela, a segunda seria tratada como repetida e ficaria
// de fora do ERP para sempre.
export const impressaoDigital = (compra, ocorrencia = 1) =>
  createHash('sha256')
    .update(`${compra.data}|${compra.descricao.toUpperCase().replace(/\s+/g, ' ')}`
      + `|${compra.valor.toFixed(2)}|${ocorrencia}`)
    .digest('hex')
    .slice(0, 32)

export function lerFatura(texto) {
  const linhas = String(texto ?? '').split(/\r?\n/).filter((l) => l.trim())
  const compras = []
  const pagamentos = []
  const vistas = new Map()
  let vencimento = null
  let total = null

  for (const linha of linhas) {
    const c = celulas(linha)
    if (c[0] === 'Vencimento') { vencimento = c[1]; continue }
    if (c[0] === 'Total') { total = num(c[6]); continue }

    const dia = data(c[1])
    const valor = num(c[6])
    const descricao = (c[3] || '').replace(/\s{2,}/g, ' ').trim()
    if (!dia || valor === null || !descricao) continue

    // Valor positivo na fatura é crédito: pagamento da fatura anterior ou
    // estorno. Não é despesa e não pode virar conta a pagar.
    const item = { data: dia, descricao, valor: Math.abs(valor), tipo: c[5] || '' }
    if (valor > 0) { pagamentos.push(item); continue }

    const chave = `${item.data}|${item.descricao}|${item.valor}`
    const ocorrencia = (vistas.get(chave) ?? 0) + 1
    vistas.set(chave, ocorrencia)
    compras.push({ ...item, ocorrencia, impressao: impressaoDigital(item, ocorrencia) })
  }

  return { compras, pagamentos, vencimento, total }
}

// Vocabulário que resolve o que o histórico não resolve. Fica pequeno de
// propósito: a fonte principal de sugestão é o que a empresa já classificou.
const PALAVRAS = [
  [/GOOGLE ADS|META ADS|FACEBOOK|LINKEDIN/i, 'marketing'],
  // Nuvem e hospedagem caem em licença de software porque é onde a empresa já
  // classifica o resto das assinaturas. Inventar categoria nova aqui só criaria
  // uma linha solta no DRE que ninguém olha.
  [/VERCEL|SUPABASE|CONTABO|AWS|AMAZON WEB|DIGITALOCEAN|CLOUDFLARE|HEROKU/i, 'software'],
  [/ANTHROPIC|OPENAI|CLAUDE|CHATGPT|GITHUB|FIGMA|NOTION|SLACK|MICROSOFT|GOOGLE WORKSP/i, 'software'],
  [/KIWIFY|HOTMART|UDEMY|ALURA|COURSERA/i, 'cursos'],
  // IOF de compra internacional é custo do cartão, não imposto retido em venda.
  // A diferença importa: imposto retido sai do faturamento, custo de cartão é
  // despesa financeira, e trocar os dois desloca a margem no DRE.
  [/IOF/i, 'tarifas de cartoes'],
  [/ANUIDADE|TARIFA|JUROS|MULTA|ENCARGO/i, 'tarifas de cartoes'],
]

const normalizar = (texto) => String(texto ?? '')
  .toUpperCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

// Sugere categoria comparando com o que já foi classificado antes.
//
// A comparação é por palavra significativa, não por texto inteiro: a descrição
// da fatura vem com cidade e país colados no nome do fornecedor, e o histórico
// tem o mesmo fornecedor escrito de outro jeito. "VERCEL INC COVINA CA" e
// "VERCEL" precisam se encontrar.
export function sugerirCategoria(descricao, historico, categorias) {
  const palavras = normalizar(descricao)
    .split(' ')
    .filter((p) => p.length >= 4 && !/^(INTERNACIONAL|PAGAMENTO|COMPRA|BRA|USA|LTDA)$/.test(p))

  let melhor = null
  for (const h of historico) {
    const alvo = normalizar(h.descricao)
    const acertos = palavras.filter((p) => alvo.includes(p)).length
    if (!acertos) continue
    const nota = acertos / palavras.length
    if (!melhor || nota > melhor.nota) melhor = { nota, categoria_id: h.category_id, origem: h.descricao }
  }
  if (melhor && melhor.nota >= 0.5) {
    return { categoria_id: melhor.categoria_id, motivo: `parecido com "${melhor.origem}"` }
  }

  for (const [padrao, termo] of PALAVRAS) {
    if (!padrao.test(descricao)) continue
    const c = categorias.find((x) => normalizar(x.nome).includes(normalizar(termo)))
    if (c) return { categoria_id: c.id, motivo: `palavra-chave "${termo}"` }
  }

  return { categoria_id: null, motivo: null }
}
