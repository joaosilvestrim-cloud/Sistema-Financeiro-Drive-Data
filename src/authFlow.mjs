import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { config } from './config.mjs'
import { buildAuthorizeUrl, exchangeCode } from './oauth.mjs'

// Captura o código de autorização e troca por tokens.
//
// Dois modos, escolhidos pela CONTAAZUL_REDIRECT_URI:
//   localhost  sobe um servidor local e captura sozinho
//   qualquer   imprime a URL e pede que você cole a URL de retorno
//
// O segundo modo existe porque a redirect_uri cadastrada hoje no portal é a do
// Google. Depois de cadastrar a nossa, é só trocar a variável no .env.
export async function obtainTokensInteractive() {
  const state = randomBytes(16).toString('hex')
  const url = buildAuthorizeUrl(state)

  console.log('\nAbra esta URL no navegador e autorize a empresa:\n')
  console.log(url)
  console.log('\nO codigo de autorizacao vale 3 minutos.\n')

  const conferirState = (recebido) => {
    if (recebido && recebido !== state) throw new Error('state nao confere, refaca a autorizacao')
  }

  if (/^http:\/\/localhost(:\d+)?\//.test(config.redirectUri)) {
    const alvo = new URL(config.redirectUri)
    const port = Number(alvo.port || 80)
    const code = await new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const incoming = new URL(req.url, `http://localhost:${port}`)
        if (incoming.pathname !== alvo.pathname) return res.writeHead(404).end('not found')
        const erro = incoming.searchParams.get('error')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(erro ? `<h1>Erro: ${erro}</h1>` : '<h1>Pode fechar esta aba.</h1>')
        server.close()
        if (erro) return reject(new Error(`autorizacao negada: ${erro}`))
        try {
          conferirState(incoming.searchParams.get('state'))
          resolve(incoming.searchParams.get('code'))
        } catch (e) {
          reject(e)
        }
      })
      server.listen(port, () => console.log(`Aguardando o callback em ${config.redirectUri} ...`))
    })
    return exchangeCode(code)
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const resposta = (await rl.question('Cole a URL completa para onde o navegador foi redirecionado:\n> ')).trim()
  rl.close()

  let code = resposta
  if (resposta.includes('://')) {
    const u = new URL(resposta)
    conferirState(u.searchParams.get('state'))
    code = u.searchParams.get('code')
  } else if (resposta.includes('=')) {
    code = new URLSearchParams(resposta.replace(/^\?/, '')).get('code')
  }
  if (!code) throw new Error('nao achei o parametro code nessa URL')
  return exchangeCode(code)
}
