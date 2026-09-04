import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// O parametro `state` amarra o retorno do OAuth ao tenant que iniciou o fluxo.
//
// Ele volta pela URL, ou seja, pelo navegador do usuario, entao nao pode ser
// apenas o id do tenant: qualquer um mudaria o valor e ligaria a conta de
// outra empresa ao proprio tenant. Por isso vai assinado, com prazo curto e um
// nonce, e a assinatura e conferida em tempo constante.

const TTL_MS = 10 * 60 * 1000

function segredo() {
  const s = process.env.OAUTH_STATE_SECRET
  if (!s) throw new Error('Falta OAUTH_STATE_SECRET no ambiente')
  return s
}

const assinar = (corpo) =>
  createHmac('sha256', segredo()).update(corpo).digest('base64url')

export function criarState(tenantId) {
  const corpo = Buffer.from(JSON.stringify({
    t: tenantId,
    n: randomBytes(8).toString('hex'),
    e: Date.now() + TTL_MS,
  })).toString('base64url')
  return `${corpo}.${assinar(corpo)}`
}

export function lerState(state) {
  if (!state || !state.includes('.')) return null
  const [corpo, assinatura] = state.split('.')

  const esperada = Buffer.from(assinar(corpo))
  const recebida = Buffer.from(assinatura)
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null

  try {
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString())
    if (!dados.e || dados.e < Date.now()) return null
    return dados
  } catch {
    return null
  }
}
