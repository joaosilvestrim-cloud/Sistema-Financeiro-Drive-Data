// Percorre o funil de compra como um cliente novo percorre.
//
// Cadastro, criação da conta, tela de conectar, URL de autorização, retorno do
// OAuth, carga inicial e o que acontece quando algo dá errado no meio. Nada
// aqui usa atalho: o usuário nasce pela chave pública, como no navegador, e o
// tenant nasce sozinho no primeiro acesso, como acontece de verdade.
//
// O único passo que este script não faz é o clique dentro do Conta Azul, que
// exige a conta e o segundo fator do cliente. Tudo antes e tudo depois é
// exercitado, inclusive o que o callback faz quando o retorno vem torto.
//
//   npm run funil
//   npm run funil -- https://driveazul.drivedata.com.br

import { pool, query } from '../src/db.mjs'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
// Domínio com TLD de verdade: o Supabase recusa .local como e-mail inválido.
const EMAIL = `funil${Date.now()}@driveazul-teste.com.br`
const SENHA = 'Funil!' + Math.random().toString(36).slice(2, 10)

let falhas = 0
const ok = (nome, condicao, detalhe = '') => {
  if (!condicao) falhas++
  console.log(`  ${condicao ? 'ok   ' : 'FALHA'} ${nome.padEnd(52)} ${detalhe}`)
}

const admin = (path, opts = {}) => fetch(`${URL_SB}/auth/v1/admin${path}`, {
  ...opts,
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
})

const cookieDe = (sessao) => {
  const ref = URL_SB.replace('https://', '').split('.')[0]
  return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(sessao)).toString('base64')}`
}

const abrir = (rota, cookie) => fetch(BASE + rota, {
  headers: cookie ? { Cookie: cookie } : {},
  redirect: 'manual',
})

console.log(`alvo: ${BASE}\n`)

// ---------------------------------------------------------- 1. cadastro

console.log('1. Cadastro em /comecar')

const paginaCadastro = await (await abrir('/comecar')).text()
ok('a tela abre sem sessão', paginaCadastro.includes('Começar agora'))
ok('promete o teste sem cartão', paginaCadastro.includes('Sem cartão'))
ok('avisa que só funciona no plano Pro na tela seguinte', true, '(conferido em /bem-vindo)')

// Como o projeto está configurado hoje, antes de tentar. É isso que decide se
// um cliente novo consegue entrar sozinho.
const config = await (await fetch(`${URL_SB}/auth/v1/settings`, { headers: { apikey: ANON } })).json()
const exigeConfirmacao = config.mailer_autoconfirm === false
ok('o cadastro público está aberto', config.disable_signup !== true)

// O mesmo caminho do navegador: chave pública, nada de service role.
const cadastro = await (await fetch(`${URL_SB}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: EMAIL,
    password: SENHA,
    data: { empresa: 'Padaria do Teste', origem: 'loja-contaazul' },
  }),
})).json()

let userId = cadastro.user?.id ?? cadastro.id
let sessao = cadastro.access_token ? cadastro : null

// Este é o achado que decide se dá para vender. Com a confirmação ligada, todo
// cadastro dispara um e-mail, e o serviço de e-mail embutido do Supabase é
// limitado a poucos envios por hora e documentado como não sendo para produção.
// O terceiro cliente da hora simplesmente não consegue se cadastrar.
if (cadastro.error_code === 'over_email_send_rate_limit') {
  falhas++
  console.log('  FALHA o cadastro público funciona para qualquer um'.padEnd(60)
    + 'o Supabase recusou: limite de envio de e-mail excedido')
} else {
  ok('o cadastro público cria o usuário', !!userId,
     userId ? EMAIL : JSON.stringify(cadastro).slice(0, 120))
}
ok('o cadastro entrega a sessão na hora, sem esperar e-mail', !!sessao,
   exigeConfirmacao ? 'confirmação de e-mail está LIGADA' : '')

// Sem usuário pelo caminho público, o teste segue pela via administrativa para
// validar o resto do funil. O problema do cadastro fica registrado acima.
if (!userId) {
  const criado = await (await admin('/users', {
    method: 'POST',
    body: JSON.stringify({
      email: EMAIL, password: SENHA, email_confirm: true,
      user_metadata: { empresa: 'Padaria do Teste', origem: 'loja-contaazul' },
    }),
  })).json()
  userId = criado.id
  console.log('       (seguindo pela via administrativa para validar o resto)')
}
if (!sessao) {
  await admin(`/users/${userId}`, { method: 'PUT', body: JSON.stringify({ email_confirm: true }) })
  sessao = await (await fetch(`${URL_SB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: SENHA }),
  })).json()
}
if (!sessao.access_token) { console.error('  sem sessão, nao da para seguir'); await pool.end(); process.exit(1) }
const cookie = cookieDe(sessao)

// ------------------------------------------------- 2. conta e teste grátis

console.log('\n2. Primeiro acesso em /bem-vindo')

const semTenant = await query(
  'select count(*)::int n from core.tenant_member where user_id = $1', [userId])
ok('antes do primeiro acesso não existe empresa', semTenant.rows[0].n === 0)

const bemVindo = await (await abrir('/bem-vindo', cookie)).text()
ok('a tela abre', bemVindo.includes('Conectar meu Conta Azul'))
ok('usa o nome da empresa que a pessoa digitou', bemVindo.includes('Padaria do Teste'))
ok('avisa da exigência do plano Pro', bemVindo.includes('Conta Azul Pro'))
ok('promete que não vê a senha', bemVindo.includes('nunca vemos a sua senha'))
ok('explica os três passos', bemVindo.includes('Autorizar') && bemVindo.includes('Esperar a carga'))

const { rows: [t] } = await query(
  `select t.id, t.nome, t.plano, t.status, t.origem, t.limite_empresas,
          ceil(extract(epoch from (t.trial_ate - now())) / 86400)::int as dias
     from core.tenant t join core.tenant_member m on m.tenant_id = t.id
    where m.user_id = $1`, [userId])
ok('a empresa nasce sozinha', !!t, t?.nome)
ok('em teste de 14 dias', t?.plano === 'trial' && t?.dias === 14, `${t?.dias} dias`)
ok('ativa e com limite de 1 empresa', t?.status === 'ativo' && t?.limite_empresas === 1)
ok('guarda de onde o cliente veio', t?.origem === 'loja-contaazul', t?.origem)

const papel = await query(
  'select role from core.tenant_member where user_id = $1 and tenant_id = $2', [userId, t.id])
ok('quem cadastrou vira dono', papel.rows[0]?.role === 'owner')

// ---------------------------------------------------- 3. URL de autorização

console.log('\n3. O botão de conectar')

const { criarState } = await import('../lib/oauthState.js')
const { buildAuthorizeUrl } = await import('../src/oauth.mjs')
const autorizar = buildAuthorizeUrl(criarState(t.id))
const u = new URL(autorizar.replace('/#/', '/'))
const p = new URLSearchParams(u.search || autorizar.split('?')[1])

ok('aponta para o host de login da Conta Azul', autorizar.startsWith('https://login.contaazul.com'))
ok('os parâmetros vão depois do #', autorizar.includes('/#/oauth/authorize?'))
ok('pede code', p.get('response_type') === 'code')
ok('leva o client_id', !!p.get('client_id'), p.get('client_id'))
ok('o redirect é o de produção', p.get('redirect_uri') === process.env.CONTAAZUL_REDIRECT_URI,
   p.get('redirect_uri'))
ok('leva escopo', !!p.get('scope'))
ok('leva state assinado', (p.get('state') ?? '').includes('.'))

const { lerState } = await import('../lib/oauthState.js')
ok('o state volta para o tenant certo', lerState(p.get('state'))?.t === t.id)
ok('state adulterado é recusado', lerState(p.get('state').slice(0, -3) + 'xxx') === null)
ok('state de outro segredo é recusado', lerState('abc.def') === null)

const resposta = await fetch(autorizar, { redirect: 'manual' })
ok('a tela de autorização responde', resposta.status < 500, `HTTP ${resposta.status}`)

// -------------------------------------------------- 4. retorno com problema

console.log('\n4. Quando o retorno vem torto')

const erro1 = await abrir('/api/oauth/contaazul/callback?error=access_denied')
const destino1 = erro1.headers.get('location') ?? ''
ok('cliente que recusa volta para Conexões com o motivo',
   destino1.includes('/conexoes') && destino1.includes('erro'), `HTTP ${erro1.status}`)

const erro2 = await abrir('/api/oauth/contaazul/callback')
ok('retorno sem código não quebra',
   (erro2.headers.get('location') ?? '').includes('erro'), `HTTP ${erro2.status}`)

const erro3 = await abrir('/api/oauth/contaazul/callback?code=x&state=invalido')
ok('state inválido não conecta nada',
   (erro3.headers.get('location') ?? '').includes('erro'), `HTTP ${erro3.status}`)

const orfas = await query(
  'select count(*)::int n from core.connection where tenant_id = $1', [t.id])
ok('nenhuma conexão foi criada por esses retornos', orfas.rows[0].n === 0)

// --------------------------------------------------------- 5. carga e telas

console.log('\n5. Sem conexão ainda')

const carregando = await abrir('/carregando', cookie)
ok('a tela de carga não trava quem não tem carga',
   [307, 302].includes(carregando.status), `HTTP ${carregando.status}`)

const painel = await (await abrir('/', cookie)).text()
ok('o painel abre vazio, sem quebrar', !painel.includes('class="next-error-h1"'))
ok('e explica o que falta', painel.includes('Nenhum dado ainda') || painel.includes('Conecte'))

const conexoes = await (await abrir('/conexoes', cookie)).text()
ok('Conexões oferece o botão de conectar', conexoes.includes('Conectar Conta Azul'))
ok('e não oferece uma segunda empresa no plano de uma', !conexoes.includes('Conectar outra empresa'))

// ---------------------------------------------------------- 6. fim do teste

console.log('\n6. Quando o teste acaba')

await query(`update core.tenant set trial_ate = now() - interval '1 day' where id = $1`, [t.id])
const bloqueado = await abrir('/resumo', cookie)
const vaiParaAssinar = (bloqueado.headers.get('location') ?? '').includes('/assinar')
ok('o painel para e manda para os planos', vaiParaAssinar, `HTTP ${bloqueado.status}`)

const planos = await (await abrir('/assinar', cookie)).text()
ok('a tela de planos abre', planos.includes('Essencial') && planos.includes('Profissional'))
ok('diz que os dados continuam lá', planos.includes('dados continuam'))

// ------------------------------------------------------------- limpeza

await query('delete from core.tenant where id = $1', [t.id])
await admin(`/users/${userId}`, { method: 'DELETE' })
console.log('\nconta de teste removida.')
console.log(falhas === 0 ? '\nO funil inteiro funciona.' : `\n${falhas} FALHA(S) no funil.`)
await pool.end()
process.exitCode = falhas === 0 ? 0 : 1
