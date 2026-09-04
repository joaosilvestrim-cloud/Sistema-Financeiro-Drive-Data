// Le em cima da hora, nao no import.
//
// A variavel obrigatoria so e cobrada quando alguem a usa de verdade. Antes a
// cobranca acontecia na avaliacao do modulo, e o build do Next, que apenas
// importa a rota para coletar configuracao, falhava inteiro por causa de um
// valor que so faz falta em requisicao.
const required = (name) => {
  const v = process.env[name]
  if (!v) throw new Error(`Faltou a variavel de ambiente ${name}`)
  return v
}

const numero = (nome, padrao) => {
  const v = Number(process.env[nome])
  return Number.isFinite(v) && v > 0 ? v : padrao
}

export const config = {
  get clientId() { return required('CONTAAZUL_CLIENT_ID') },
  get clientSecret() { return required('CONTAAZUL_CLIENT_SECRET') },
  get redirectUri() { return required('CONTAAZUL_REDIRECT_URI') },

  // Três hosts diferentes, e a documentação pública ainda cita os antigos.
  //   login   tela de autorização, com os parâmetros dentro do fragmento (#)
  //   token   troca e renovação, que fica na própria API, não no host de auth
  //   api     os recursos
  get loginUrl() { return process.env.CONTAAZUL_LOGIN_URL || 'https://login.contaazul.com' },
  get tokenUrl() { return process.env.CONTAAZUL_TOKEN_URL || 'https://api-v2.contaazul.com/oauth/token' },
  get apiUrl() { return process.env.CONTAAZUL_API_URL || 'https://api-v2.contaazul.com' },
  get scope() { return process.env.CONTAAZUL_SCOPE || 'openid profile aws.cognito.signin.user.admin' },

  // Fase 0 guarda token em arquivo. Da Fase 1 em diante é o banco, criptografado.
  get tokenFile() { return process.env.TOKEN_FILE || '.tokens.json' },
  get dataDir() { return process.env.DATA_DIR || 'data' },

  get monthsBack() { return numero('PULL_MONTHS_BACK', 12) },
  get monthsForward() { return numero('PULL_MONTHS_FORWARD', 6) },

  // A API só aceita estes tamanhos de página. Qualquer outro valor devolve 400
  // com uma mensagem que não parece erro de paginação.
  get pageSize() {
    const v = Number(process.env.PULL_PAGE_SIZE)
    return [10, 20, 50, 100, 200, 500, 1000].includes(v) ? v : 100
  },

  // Teto de 10 req/s na API. Fica em 8 para ter folga.
  get requestsPerSecond() { return numero('RATE_LIMIT_RPS', 8) },
}

export const basicAuthHeader = () =>
  'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
