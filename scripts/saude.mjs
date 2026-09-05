// Lê /api/saude em produção e diz o que está no ar.
//
//   npm run saude
//
// Existe porque a resposta para "já subiu?" tem três partes que costumam
// discordar entre si: qual commit está servindo, quais variáveis o processo
// enxerga, e se as consultas das telas respondem. Olhar só o painel da Vercel
// responde a primeira e mente sobre as outras duas.
//
// A pegadinha que este script existe para pegar: **a Vercel prende a variável
// ao build**. Adicionar uma variável não afeta o deploy que já está rodando.
// Sem redeploy, o painel mostra a variável lá e o processo não a enxerga, o que
// parece defeito do código e não é.
//
// A rota exige sessão, então o script cria um usuário temporário, entra com
// ele, lê e apaga. Nenhum valor de variável é devolvido pela rota, só se ela
// existe: a saúde do sistema não é motivo para expor segredo.
import { pool, query } from '../src/db.mjs'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICO = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const ALVO = process.argv[2] ?? process.env.APP_URL ?? 'https://driveazul.drivedata.com.br'

if (!URL || !SERVICO || !ANON) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_ANON_KEY no .env')
  process.exit(1)
}

// A que nao deve existir. DATABASE_URL e' conexao direta e nao aguenta
// serverless: em producao o app tem que usar o pooler. Ver docs/DEPLOY.md.
const NAO_DEVE_EXISTIR = new Set(['DATABASE_URL'])

const EMAIL = 'saude@driveazul.local'
const senha = 'Cf!' + Math.random().toString(36).slice(2, 12)
const admin = (p, o = {}) => fetch(URL + '/auth/v1/admin' + p, {
  ...o,
  headers: { apikey: SERVICO, Authorization: 'Bearer ' + SERVICO, 'Content-Type': 'application/json' },
})

// Sobra de execucao anterior interrompida. Limpa antes de criar.
const antigos = await (await admin('/users?per_page=200')).json()
for (const u of antigos.users ?? []) {
  if (u.email === EMAIL) await admin('/users/' + u.id, { method: 'DELETE' })
}

const usuario = await (await admin('/users', {
  method: 'POST',
  body: JSON.stringify({ email: EMAIL, password: senha, email_confirm: true }),
})).json()

let saiu = false
const apagar = async () => {
  if (saiu) return
  saiu = true
  await admin('/users/' + usuario.id, { method: 'DELETE' }).catch(() => {})
}
process.on('exit', () => { /* o delete e' async, feito no fim do fluxo */ })

try {
  const { rows: [t] } = await query('select id from core.tenant order by slug limit 1')
  await query(
    'insert into core.tenant_member (tenant_id, user_id, role) values ($1,$2,$3) on conflict do nothing',
    [t.id, usuario.id, 'owner'],
  )

  const login = await (await fetch(URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: senha }),
  })).json()

  const ref = URL.replace('https://', '').split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(login)).toString('base64')}`

  const j = await (await fetch(`${ALVO.replace(/\/$/, '')}/api/saude`, { headers: { Cookie: cookie } })).json()

  console.log(`${ALVO}`)
  console.log(`commit no ar: ${j.ambiente?.commit ?? '?'}   regiao: ${j.ambiente?.regiao ?? '?'}`)

  const local = (await import('node:child_process')).execSync('git rev-parse --short HEAD').toString().trim()
  if (j.ambiente?.commit && !local.startsWith(j.ambiente.commit) && !j.ambiente.commit.startsWith(local)) {
    console.log(`ATENCAO: o commit local e ${local}. O que esta no ar e outro.`)
  }

  console.log('\nvariaveis:')
  let faltando = 0
  for (const [k, existe] of Object.entries(j.variaveis ?? {})) {
    const deveria = !NAO_DEVE_EXISTIR.has(k)
    const certo = existe === deveria
    if (!certo) faltando++
    const marca = certo ? 'ok   ' : (existe ? 'SOBRA' : 'FALTA')
    console.log(`  ${marca} ${k}${NAO_DEVE_EXISTIR.has(k) ? '   (esta certo nao ter)' : ''}`)
  }

  console.log('\netapas:')
  let quebradas = 0
  for (const e of j.etapas ?? []) {
    if (!e.ok) quebradas++
    console.log(`  ${e.ok ? 'ok   ' : 'FALHA'} ${e.etapa}${e.erro ? ': ' + e.erro : ''}`)
  }

  if (faltando) {
    console.log('\nVariavel no painel e ausente no processo quase sempre e uma coisa so:')
    console.log('a Vercel prende a variavel ao build, entao o deploy que ja estava')
    console.log('rodando nao a enxerga. Refaca o deploy e confira o alvo Production.')
  }
  console.log(faltando || quebradas ? `\n${faltando} variavel(is) e ${quebradas} etapa(s) fora do lugar.` : '\nTudo no lugar.')
  await apagar()
  await pool.end()
  process.exit(faltando || quebradas ? 1 : 0)
} catch (e) {
  await apagar()
  await pool.end()
  console.error(`\nFalhou: ${e.message}`)
  process.exit(1)
}
