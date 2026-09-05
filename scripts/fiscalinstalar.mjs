// Liga a conta da Focus NFe ao DriveAzul.
//
// Roda uma vez por ambiente. Guarda o token cifrado e cadastra os gatilhos que
// avisam quando um documento sai de "processando".
//
//   FOCUS_TOKEN=xxxx FOCUS_AMBIENTE=homologacao APP_URL=https://... npm run fiscalinstalar
//
// O token entra por variável de ambiente e não por argumento de linha de
// comando de propósito: argumento aparece no histórico do shell e na lista de
// processos da máquina.
import { pool, query } from '../src/db.mjs'
import { focusCliente, EVENTO } from '../src/providers/focusnfe.mjs'
import { encrypt } from '../src/crypto.mjs'

const token = process.env.FOCUS_TOKEN
const ambiente = process.env.FOCUS_AMBIENTE || 'homologacao'
const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
const segredo = process.env.FOCUS_WEBHOOK_SECRET

if (!token) {
  console.error('Faltou FOCUS_TOKEN. Pegue em https://app.focusnfe.com.br, aba de tokens.')
  process.exit(1)
}
if (!['homologacao', 'producao'].includes(ambiente)) {
  console.error(`FOCUS_AMBIENTE invalido: ${ambiente}. Use homologacao ou producao.`)
  process.exit(1)
}

console.log(`Ambiente: ${ambiente}`)
console.log(`Token: ${token.length} caracteres, terminando em ...${token.slice(-4)}`)

const api = focusCliente({ token, ambiente })

// Prova que o token funciona antes de gravar. Gravar um token errado deixaria a
// tela quebrada com uma mensagem sobre outra coisa.
let empresas
try {
  empresas = await api.listarEmpresas()
} catch (e) {
  console.error(`\nO token nao foi aceito: ${e.message}`)
  process.exit(1)
}
console.log(`\nToken valido. ${empresas?.length ?? 0} empresa(s) cadastrada(s) na Focus:`)
for (const e of empresas ?? []) {
  console.log(`  ${e.cnpj ?? e.cpf}  ${e.nome ?? e.nome_fantasia ?? ''}`)
}

// --------------------------------------------------------------- conta
//
// tenant_id nulo: e' a conta da plataforma, sob a qual todo cliente vira uma
// empresa. E' o modelo do plano com CNPJ ilimitado.
const existente = await query(
  `select id from core.fiscal_conta
    where provider = 'focusnfe' and ambiente = $1 and tenant_id is null`,
  [ambiente],
)
if (existente.rows.length) {
  await query(
    `update core.fiscal_conta set token_enc = $2, atualizado_em = now() where id = $1`,
    [existente.rows[0].id, encrypt(token)],
  )
  console.log(`\nConta da plataforma atualizada (${existente.rows[0].id}).`)
} else {
  const { rows: [nova] } = await query(
    `insert into core.fiscal_conta (tenant_id, ambiente, token_enc, rotulo)
     values (null, $1, $2, 'plataforma DriveAzul') returning id`,
    [ambiente, encrypt(token)],
  )
  console.log(`\nConta da plataforma criada (${nova.id}).`)
}

// -------------------------------------------------------------- gatilhos

if (!appUrl || !segredo) {
  console.log('\nGatilhos nao cadastrados. Para cadastrar, defina:')
  if (!appUrl) console.log('  APP_URL              (ex.: https://driveazul.com.br)')
  if (!segredo) console.log('  FOCUS_WEBHOOK_SECRET (gere um valor longo e aleatorio)')
  console.log('\nSem gatilho o sistema ainda funciona: a tela tem o botao Conferir,')
  console.log('que pergunta o estado a Focus. O gatilho so evita a pergunta.')
} else {
  const url = `${appUrl.replace(/\/$/, '')}/api/fiscal/webhook`
  console.log(`\nCadastrando gatilhos para ${url}`)

  const jaTem = await api.listarGatilhos().catch(() => [])
  const tem = (evento) => (jaTem ?? []).some((h) => h.event === evento && h.url === url)

  // Um gatilho por tipo de documento que a plataforma emite, mais os
  // recebidos, que sao a porta para trazer despesa direto da Receita.
  const eventos = [
    EVENTO.nfse, EVENTO.nfse_nacional, EVENTO.nfe, EVENTO.cte, EVENTO.mdfe,
    EVENTO.nfe_recebida, EVENTO.cte_recebida,
  ]
  for (const evento of eventos) {
    if (tem(evento)) {
      console.log(`  ja existe  ${evento}`)
      continue
    }
    try {
      const h = await api.criarGatilho({ url, evento, autorizacao: segredo })
      console.log(`  criado     ${evento}  (${h.id})`)
    } catch (e) {
      console.log(`  FALHOU     ${evento}: ${e.message}`)
    }
  }
}

console.log('\nPronto. Confira com: npm run fiscalteste')
await pool.end()
