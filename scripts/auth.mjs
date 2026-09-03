// Fase 0: completa o fluxo OAuth da Conta Azul e guarda os tokens em .tokens.json.
//
// Dois modos, escolhidos pela CONTAAZUL_REDIRECT_URI do .env:
//  1. localhost  -> sobe um servidor local e captura o code sozinho.
//                   Exige que a URL esteja cadastrada no portal do desenvolvedor.
//  2. qualquer   -> imprime a URL, voce faz o login e cola de volta a URL final.
//                   Serve enquanto a redirect_uri cadastrada for a do Google.
//
// O codigo de autorizacao vale 3 minutos. Cole rapido.

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { config } from '../src/config.mjs'
import { exchangeCode, saveTokens } from '../src/tokens.mjs'

const state = randomBytes(16).toString('hex')

const authorizeUrl = new URL(`${config.authUrl}/login`)
authorizeUrl.searchParams.set('response_type', 'code')
authorizeUrl.searchParams.set('client_id', config.clientId)
authorizeUrl.searchParams.set('redirect_uri', config.redirectUri)
authorizeUrl.searchParams.set('state', state)
authorizeUrl.searchParams.set('scope', config.scope)

console.log('\nAbra esta URL no navegador e autorize a empresa:\n')
console.log(authorizeUrl.toString())
console.log('')

const isLocal = /^http:\/\/localhost(:\d+)?\//.test(config.redirectUri)

async function finish(code, returnedState) {
  if (returnedState && returnedState !== state) {
    throw new Error('state nao confere. Refaca a autorizacao.')
  }
  const tokens = await exchangeCode(code)
  await saveTokens(tokens)
  console.log('\nConectado. Tokens salvos em', config.tokenFile)
  console.log('access_token valido ate', tokens.expires_at)
  console.log('Proximo passo: npm run pull')
}

if (isLocal) {
  const url = new URL(config.redirectUri)
  const port = Number(url.port || 80)
  const server = createServer(async (req, res) => {
    const incoming = new URL(req.url, `http://localhost:${port}`)
    if (incoming.pathname !== url.pathname) {
      res.writeHead(404).end('not found')
      return
    }
    const code = incoming.searchParams.get('code')
    const err = incoming.searchParams.get('error')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(err ? `<h1>Erro: ${err}</h1>` : '<h1>Pode fechar esta aba.</h1>')
    server.close()
    if (err) {
      console.error('Autorizacao negada:', err)
      process.exit(1)
    }
    try {
      await finish(code, incoming.searchParams.get('state'))
      process.exit(0)
    } catch (e) {
      console.error(e.message)
      process.exit(1)
    }
  })
  server.listen(port, () => console.log(`Aguardando o callback em ${config.redirectUri} ...`))
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('Cole aqui a URL completa para onde o navegador foi redirecionado:\n> ')
  rl.close()
  const raw = answer.trim()
  const code = raw.includes('://')
    ? new URL(raw).searchParams.get('code')
    : new URLSearchParams(raw.replace(/^\?/, '')).get('code') || raw
  if (!code) {
    console.error('Nao achei o parametro code nessa URL.')
    process.exit(1)
  }
  const returnedState = raw.includes('://') ? new URL(raw).searchParams.get('state') : null
  await finish(code, returnedState)
}
