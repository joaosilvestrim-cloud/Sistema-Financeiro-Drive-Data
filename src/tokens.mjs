// Guarda de token em arquivo. Vale só para a Fase 0, onde a ideia é medir a API
// sem banco no caminho. A partir da Fase 1 quem manda é src/connections.mjs,
// que guarda cifrado no Postgres e renova sob lock.

import { readFile, writeFile } from 'node:fs/promises'
import { config } from './config.mjs'
import { refreshToken } from './oauth.mjs'

export { exchangeCode } from './oauth.mjs'

export async function loadTokens() {
  try {
    return JSON.parse(await readFile(config.tokenFile, 'utf8'))
  } catch {
    return null
  }
}

export async function saveTokens(t) {
  await writeFile(config.tokenFile, JSON.stringify(t, null, 2))
}

export async function ensureFreshToken() {
  const current = await loadTokens()
  if (!current) throw new Error('Sem token. Rode "npm run auth" primeiro.')
  const marginMs = 5 * 60 * 1000
  if (new Date(current.expires_at).getTime() - Date.now() > marginMs) return current
  const renewed = await refreshToken(current)
  await saveTokens(renewed)
  console.log('token renovado, valido ate', renewed.expires_at)
  return renewed
}
