import { readFile, writeFile } from 'node:fs/promises'
import { config, basicAuthHeader } from './config.mjs'

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

function normalize(raw, previous) {
  return {
    access_token: raw.access_token,
    // A Conta Azul rotaciona o refresh_token a cada renovacao. Quando a resposta
    // nao traz um novo, o antigo continua valendo. Perder esse valor derruba a conexao.
    refresh_token: raw.refresh_token || previous?.refresh_token,
    token_type: raw.token_type || 'Bearer',
    expires_at: new Date(Date.now() + (raw.expires_in ?? 3600) * 1000).toISOString(),
    obtained_at: new Date().toISOString(),
  }
}

async function postToken(body, previous) {
  const res = await fetch(`${config.authUrl}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${text.slice(0, 400)}`)
  return normalize(JSON.parse(text), previous)
}

export async function exchangeCode(code) {
  return postToken({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
  })
}

export async function refresh(previous) {
  return postToken(
    { grant_type: 'refresh_token', refresh_token: previous.refresh_token },
    previous,
  )
}

// Renova com 5 minutos de folga. Na Fase 1 essa funcao roda dentro de uma
// transacao com pg_advisory_xact_lock(connection_id) para nao haver duas
// renovacoes simultaneas invalidando o refresh_token.
export async function ensureFreshToken() {
  const current = await loadTokens()
  if (!current) throw new Error('Sem token. Rode "npm run auth" primeiro.')
  const marginMs = 5 * 60 * 1000
  if (new Date(current.expires_at).getTime() - Date.now() > marginMs) return current
  const renewed = await refresh(current)
  await saveTokens(renewed)
  console.log('token renovado, valido ate', renewed.expires_at)
  return renewed
}
