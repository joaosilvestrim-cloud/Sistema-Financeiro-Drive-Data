import { config, basicAuthHeader } from './config.mjs'

export function buildAuthorizeUrl(state) {
  const url = new URL(`${config.authUrl}/login`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('scope', config.scope)
  return url.toString()
}

function normalize(raw, previous) {
  return {
    access_token: raw.access_token,
    // A Conta Azul rotaciona o refresh_token a cada renovacao. Quando a resposta
    // nao traz um novo, o antigo continua valendo. Perder esse valor derruba a
    // conexao e obriga o cliente a autorizar tudo de novo.
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
  if (!res.ok) {
    const err = new Error(`token endpoint ${res.status}: ${text.slice(0, 400)}`)
    err.status = res.status
    throw err
  }
  return normalize(JSON.parse(text), previous)
}

export const exchangeCode = (code) =>
  postToken({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
  })

export const refreshToken = (previous) =>
  postToken({ grant_type: 'refresh_token', refresh_token: previous.refresh_token }, previous)
