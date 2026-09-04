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
// O authorize diz na cara se o client_id existe. É o teste mais barato e o que
// pega o problema mais comum: app apagado, expirado ou de outro ambiente.
try {
  const url = new URL(`${config.authUrl}/login`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('state', 'doctor')
  url.searchParams.set('scope', config.scope)

  const res = await fetch(url, { redirect: 'manual' })
  const destino = res.headers.get('location') || ''

  if (destino.includes('error=')) {
    const motivo = decodeURIComponent(new URL(destino).searchParams.get('error') || 'desconhecido')
    erro('client_id nao aceito', `${motivo}. Confira o app em https://developers-portal.contaazul.com`)
  } else if (res.status === 200 || destino.includes('login')) {
    ok('client_id aceito', 'a tela de autorizacao abre')
  } else {
    aviso('resposta inesperada do authorize', `HTTP ${res.status} ${destino}`)
  }
} catch (e) {
  erro('authorize inacessivel', e.message)
}

// Com um code proposital invalido: invalid_grant quer dizer que o par
// client_id e secret foi aceito. invalid_client quer dizer que nao foi.
try {
  const res = await fetch(`${config.authUrl}/oauth2/token`, {
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
  if (corpo.includes('invalid_grant')) ok('client_secret aceito', 'o par credencial esta valido')
  else if (corpo.includes('invalid_client')) erro('client_secret recusado', 'client_id ou secret errados, ou app inexistente')
  else aviso('resposta inesperada do token', `HTTP ${res.status} ${corpo.slice(0, 120)}`)
} catch (e) {
  erro('endpoint de token inacessivel', e.message)
}

if (/google\.com/.test(config.redirectUri)) {
  aviso('redirect_uri aponta para o Google',
    'funciona no modo colar URL, mas para o produto cadastre a sua propria no portal')
}

await pool.end()
console.log(falhas ? `\n${falhas} problema(s) impedindo o funcionamento.\n` : '\nTudo pronto para conectar.\n')
process.exit(falhas ? 1 : 0)
