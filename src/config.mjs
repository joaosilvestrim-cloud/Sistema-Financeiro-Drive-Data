const required = (name) => {
  const v = process.env[name]
  if (!v) {
    console.error(`Faltou a variavel ${name} no .env`)
    process.exit(1)
  }
  return v
}

export const config = {
  clientId: required('CONTAAZUL_CLIENT_ID'),
  clientSecret: required('CONTAAZUL_CLIENT_SECRET'),
  redirectUri: required('CONTAAZUL_REDIRECT_URI'),
  authUrl: process.env.CONTAAZUL_AUTH_URL || 'https://auth.contaazul.com',
  apiUrl: process.env.CONTAAZUL_API_URL || 'https://api-v2.contaazul.com',
  scope: process.env.CONTAAZUL_SCOPE || 'openid profile aws.cognito.signin.user.admin',
  // Fase 0 guarda token em arquivo. Na Fase 1 isso vai para o banco, criptografado.
  tokenFile: process.env.TOKEN_FILE || '.tokens.json',
  dataDir: process.env.DATA_DIR || 'data',
  monthsBack: Number(process.env.PULL_MONTHS_BACK || 12),
  monthsForward: Number(process.env.PULL_MONTHS_FORWARD || 6),
  pageSize: Number(process.env.PULL_PAGE_SIZE || 100),
  // Teto de 10 req/s na API. Fica em 8 para ter folga.
  requestsPerSecond: Number(process.env.RATE_LIMIT_RPS || 8),
}

export const basicAuthHeader = () =>
  'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
