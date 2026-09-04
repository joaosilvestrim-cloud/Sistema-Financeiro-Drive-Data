import { config, basicAuthHeader } from './config.mjs'

// A tela de autorização fica em login.contaazul.com e os parâmetros vão dentro
// do fragmento, depois do #. Por isso a URL é montada como string: URL e
// searchParams colocariam a query antes do fragmento e o app não receberia nada.
export function buildAuthorizeUrl(state) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    scope: config.scope,
  })
  return `${config.loginUrl}/#/oauth/authorize?${p.toString()}`
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

// O endpoint de token fica na própria API, não no host de login.
async function postToken(body, previous) {
  const res = await fetch(config.tokenUrl, {
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
