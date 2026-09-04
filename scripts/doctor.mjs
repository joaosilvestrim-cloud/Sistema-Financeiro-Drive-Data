// Diagnóstico do ambiente. Roda em segundos e diz o que está impedindo o
// sistema de funcionar, em vez de deixar o erro aparecer lá na frente,
// disfarçado de outra coisa.
//
//   npm run doctor

import { config } from '../src/config.mjs'
import { pool, query } from '../src/db.mjs'

let falhas = 0
const ok = (t, extra = '') => console.log(`  ok    ${t}${extra ? '  ' + extra : ''}`)
const erro = (t, detalhe) => { falhas++; console.log(`  FALHA ${t}\n        ${detalhe}`) }
const aviso = (t, detalhe) => console.log(`  aviso ${t}\n        ${detalhe}`)

console.log('\n== ambiente ==')
for (const nome of ['CONTAAZUL_CLIENT_ID', 'CONTAAZUL_CLIENT_SECRET', 'CONTAAZUL_REDIRECT_URI', 'DATABASE_URL']) {
  if (process.env[nome]) ok(nome)
  else erro(nome, 'ausente no .env')
}
if (process.env.TOKEN_ENCRYPTION_KEY) {
  const bytes = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'base64').length
  bytes === 32 ? ok('TOKEN_ENCRYPTION_KEY', '32 bytes') : erro('TOKEN_ENCRYPTION_KEY', `tem ${bytes} bytes, precisa de 32`)
} else {
  erro('TOKEN_ENCRYPTION_KEY', 'ausente. Gere com npm run keygen')
}

console.log('\n== banco ==')
try {
  const { rows } = await query('select version() v')
  ok('conexao', rows[0].v.split(',')[0])
  const m = await query('select count(*)::int c from core._migration')
  ok('migrations aplicadas', String(m.rows[0].c))
  const t = await query('select slug from core.tenant order by slug')
  ok('tenants', t.rows.map((r) => r.slug).join(', ') || 'nenhum')
  const c = await query('select nome, provider, status from core.connection order by nome')
  if (c.rows.length) {
    for (const conn of c.rows) {
      const linha = `${conn.nome} (${conn.provider})`
      conn.status === 'connected' ? ok('conexao', linha) : erro('conexao ' + linha, `status ${conn.status}`)
    }
  } else {
    aviso('nenhuma conexao cadastrada', 'rode npm run connect depois de resolver as credenciais')
  }
} catch (e) {
  erro('banco', e.message)
}

console.log('\n== Conta Azul ==')
// A tela de autorizacao virou uma SPA e os parametros vao dentro do fragmento,
// que o servidor nao enxerga. Entao nao da para testar o client_id por ali.
// O teste confiavel e o endpoint de token com um code proposital invalido:
// invalid_grant quer dizer que o par client_id e secret foi aceito,
// invalid_client quer dizer que nao foi.
try {
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code: 'diagnostico-codigo-invalido',
      redirect_uri: config.redirectUri,
    }).toString(),
  })
  const corpo = await res.text()
  // invalid_client e o unico erro que fala das credenciais. Reclamar do codigo
  // (invalid_grant ou invalid_request) significa que o par ja foi aceito.
  if (corpo.includes('invalid_client')) {
    erro('credenciais recusadas', 'client_id ou secret errados, ou app expirado')
  } else if (corpo.includes('invalid_grant') || corpo.includes('invalid_request')) {
    ok('credenciais aceitas', 'client_id e secret validos')
  } else {
    aviso('resposta inesperada do token', `HTTP ${res.status} ${corpo.slice(0, 140)}`)
  }
} catch (e) {
  erro('endpoint de token inacessivel', e.message)
}

// A API responde 401 sem token. Serve para confirmar que o host esta de pe.
try {
  const res = await fetch(`${config.apiUrl}/v1/categorias?pagina=1&tamanho_pagina=10`)
  // Sem token a API responde erro. Qualquer resposta serve para provar que o
  // host esta de pe, que e tudo que este teste precisa saber.
  res.status >= 400
    ? ok('API respondendo', `HTTP ${res.status} sem token, como esperado`)
    : aviso('API respondeu sem token', `HTTP ${res.status}`)
} catch (e) {
  erro('API inacessivel', e.message)
}

if (!/\/\/(localhost|.*vercel\.app|.*drivedata)/.test(config.redirectUri)) {
  aviso(`redirect_uri e ${config.redirectUri}`,
    'e a do app de desenvolvimento. Para producao cadastre a nossa no portal')
}

await pool.end()
console.log(falhas
  ? `\n${falhas} problema(s) impedindo o funcionamento.\n`
  : '\nTudo pronto para conectar.\n')
process.exit(falhas ? 1 : 0)
