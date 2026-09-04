import { NextResponse } from 'next/server'
import { exchangeCode } from '@/src/oauth.mjs'
import { encrypt } from '@/src/crypto.mjs'
import { q, q1 } from '@/lib/db'
import { lerState } from '@/lib/oauthState'

export const dynamic = 'force-dynamic'

// Retorno da autorizacao da Conta Azul.
//
// O codigo dura 3 minutos e so pode ser trocado uma vez, entao a troca acontece
// aqui mesmo, na primeira chegada, sem passar por tela intermediaria.
//
// A identidade da empresa sai do proprio token, que e um JWT, e vira o
// external_company_id. E isso que faz reautorizar a mesma empresa atualizar a
// conexao em vez de criar uma segunda com o mesmo dado dentro.

const voltar = (request, params) => {
  const url = new URL('/conexoes', request.url)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

function identidade(accessToken) {
  try {
    const corpo = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString())
    return corpo.username ?? corpo.sub ?? null
  } catch {
    return null
  }
}

export async function GET(request) {
  const params = request.nextUrl.searchParams
  const erro = params.get('error')
  if (erro) return voltar(request, { erro: params.get('error_description') || erro })

  const code = params.get('code')
  if (!code) return voltar(request, { erro: 'A Conta Azul nao devolveu o codigo de autorizacao.' })

  const dados = lerState(params.get('state'))
  if (!dados) {
    return voltar(request, {
      erro: 'A autorizacao expirou ou o retorno nao confere. Comece de novo pelo botao Conectar.',
    })
  }

  try {
    const tokens = await exchangeCode(code)
    const conta = identidade(tokens.access_token)

    const tenant = await q1('select id, nome from core.tenant where id = $1', [dados.t])
    if (!tenant) return voltar(request, { erro: 'Tenant nao encontrado.' })

    const [conn] = await q(
      `insert into core.connection
         (tenant_id, provider, nome, external_company_id,
          access_token_enc, refresh_token_enc, token_expires_at, status, last_error)
       values ($1, 'contaazul', $2, $3, $4, $5, $6, 'connected', null)
       on conflict (tenant_id, provider, external_company_id) do update
         set access_token_enc = excluded.access_token_enc,
             refresh_token_enc = excluded.refresh_token_enc,
             token_expires_at = excluded.token_expires_at,
             status = 'connected', last_error = null, updated_at = now()
       returning id, nome, (xmax = 0) as criada`,
      [
        dados.t,
        dados.nome || tenant.nome,
        conta,
        encrypt(tokens.access_token),
        encrypt(tokens.refresh_token),
        tokens.expires_at,
      ],
    )

    return voltar(request, {
      ok: conn.criada ? 'criada' : 'atualizada',
      // Sem refresh_token a conexao morre em uma hora, e isso precisa aparecer
      // na tela em vez de virar um sync falhando de madrugada.
      renova: tokens.refresh_token ? '1' : '0',
    })
  } catch (e) {
    return voltar(request, { erro: e.message.slice(0, 300) })
  }
}
