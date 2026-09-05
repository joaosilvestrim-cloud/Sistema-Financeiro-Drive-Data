// Liga a conta da Focus NFe ao DriveAzul.
//
//   FOCUS_TOKEN=xxxx APP_URL=https://... FOCUS_WEBHOOK_SECRET=yyy npm run fiscalinstalar
//
// O token entra por variável de ambiente e não por argumento de linha de
// comando: argumento aparece no histórico do shell e na lista de processos.
//
// Duas coisas da Focus que este script existe para resolver.
//
// O token pertence à empresa, não à conta. Não existe "token da conta" para
// pedir; existe o token da empresa principal, que é com quem se conversa para
// criar e listar as outras. É esse que entra em FOCUS_TOKEN.
//
// E a API de empresas só funciona em produção. Mesmo com a emissão apontada
// para homologação, este script fala com o servidor de produção para listar. Os
// dois tokens de cada empresa, homologação e produção, vêm na listagem, e é por
// isso que importar é possível sem ninguém copiar nada na mão.
import { pool, query } from '../src/db.mjs'
import { focusCliente } from '../src/providers/focusnfe.mjs'
import { encrypt } from '../src/crypto.mjs'

const token = process.env.FOCUS_TOKEN
const ambiente = process.env.FOCUS_AMBIENTE || 'homologacao'
const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
const segredo = process.env.FOCUS_WEBHOOK_SECRET

if (!token) {
  console.error('Faltou FOCUS_TOKEN.')
  console.error('')
  console.error('Ele fica no painel da Focus, em Painel API > Tokens de Acesso,')
  console.error('e pertence a uma empresa. Se ainda nao houver empresa nenhuma,')
  console.error('cadastre a primeira pela tela deles (o botao CADASTRAR EMPRESA)')
  console.error('e volte aqui com o token de producao dela.')
  process.exit(1)
}
if (!['homologacao', 'producao'].includes(ambiente)) {
  console.error(`FOCUS_AMBIENTE invalido: ${ambiente}. Use homologacao ou producao.`)
  process.exit(1)
}

console.log(`Emissao apontada para: ${ambiente}`)
console.log(`Token: ${token.length} caracteres, terminando em ...${token.slice(-4)}`)

const api = focusCliente({ token, ambiente })

// Prova que o token funciona antes de gravar. Gravar um token errado deixaria a
// tela quebrada com uma mensagem sobre outra coisa.
let empresas
try {
  empresas = await api.listarEmpresas()
} catch (e) {
  console.error(`\nO token nao foi aceito: ${e.message}`)
  console.error('Confira se e o token de PRODUCAO: a API de empresas so existe la.')
  process.exit(1)
}

const lista = Array.isArray(empresas) ? empresas : (empresas?.empresas ?? [])
console.log(`\nToken valido. ${lista.length} empresa(s) na conta.`)

// --------------------------------------------------------- token admin

const { rows: [conta] } = await query(
  `insert into core.fiscal_conta (tenant_id, ambiente, token_enc, rotulo)
   values (null, 'producao', $1, 'administrativo, empresa principal')
   on conflict do nothing
   returning id`,
  [encrypt(token)],
)
let contaId = conta?.id
if (!contaId) {
  const { rows: [j] } = await query(
    `update core.fiscal_conta set token_enc = $1, atualizado_em = now()
      where provider = 'focusnfe' and tenant_id is null
      returning id`,
    [encrypt(token)],
  )
  contaId = j.id
  console.log(`Token administrativo atualizado (${contaId}).`)
} else {
  console.log(`Token administrativo guardado (${contaId}).`)
}

// ---------------------------------------------------------- emitentes
//
// Importa o que ja existe na Focus. Cada empresa traz o proprio par de tokens,
// e sem eles nao ha emissao: e' por isso que este passo nao e' opcional.

const { rows: [t] } = await query('select id, nome from core.tenant order by slug limit 1')
console.log(`\nImportando para o tenant ${t.nome}:`)

const digitos = (v) => String(v ?? '').replace(/\D/g, '')

for (const e of lista) {
  const cnpj = digitos(e.cnpj)
  if (cnpj.length !== 14) {
    console.log(`  pulado    ${e.cnpj ?? e.cpf} (nao e CNPJ)`)
    continue
  }

  // Casa com a empresa do Conta Azul. Esse elo e' o que faz a nota nascer do
  // titulo a receber sem ninguem redigitar nada, e sem ele o botao de emitir
  // nunca aparece.
  //
  // Duas tentativas, nessa ordem.
  //
  // Primeiro pelo CNPJ, procurando entre as pessoas cadastradas. E' exato
  // quando funciona, e funciona em grupo com intercompany, onde uma empresa do
  // grupo aparece como cliente da outra.
  //
  // Depois pela falta de ambiguidade: uma conexao so' e uma empresa so' nao tem
  // como estar erradas. E' o caso de todo cliente que comeca, inclusive o
  // nosso, onde a empresa nao e' cliente de si mesma e o CNPJ nao aparece em
  // lugar nenhum do proprio ERP.
  //
  // Com varias de cada lado e nenhum CNPJ batendo, nao ha desempate: emitir
  // pela empresa errada nao se desfaz, e adivinhar trocaria um botao que falta
  // por uma nota no CNPJ errado.
  let conexao = (await query(
    `select c.id, c.nome, 'CNPJ' as como from core.connection c
      where c.tenant_id = $1
        and exists (
          select 1 from core.person p
           where p.connection_id = c.id
             and regexp_replace(coalesce(p.documento,''), '[^0-9]', '', 'g') = $2
        )
      limit 1`,
    [t.id, cnpj],
  )).rows[0]

  if (!conexao && lista.length === 1) {
    const { rows: unica } = await query(
      `select id, nome, 'unica empresa dos dois lados' as como
         from core.connection
        where tenant_id = $1 and status = 'connected'`,
      [t.id],
    )
    if (unica.length === 1) conexao = unica[0]
  }

  const { rows: [salvo] } = await query(
    `insert into core.fiscal_emitente
       (tenant_id, conta_id, connection_id, cnpj, razao_social, nome_fantasia,
        inscricao_municipal, inscricao_estadual, municipio, uf, codigo_municipio,
        habilita_nfse, habilita_nfe, habilita_nfce, habilita_cte, habilita_mdfe,
        token_homologacao_enc, token_producao_enc, externo_id,
        habilita_nfse_nacional, habilita_recebidas_nfe, habilita_recebidas_cte, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
             $20,$21,$22,'ativo')
     on conflict (tenant_id, cnpj) do update set
       conta_id = excluded.conta_id,
       connection_id = coalesce(excluded.connection_id, core.fiscal_emitente.connection_id),
       razao_social = excluded.razao_social,
       inscricao_municipal = coalesce(excluded.inscricao_municipal, core.fiscal_emitente.inscricao_municipal),
       codigo_municipio = coalesce(excluded.codigo_municipio, core.fiscal_emitente.codigo_municipio),
       habilita_nfse = excluded.habilita_nfse,
       habilita_nfe = excluded.habilita_nfe,
       habilita_nfce = excluded.habilita_nfce,
       habilita_cte = excluded.habilita_cte,
       habilita_mdfe = excluded.habilita_mdfe,
       token_homologacao_enc = coalesce(excluded.token_homologacao_enc, core.fiscal_emitente.token_homologacao_enc),
       token_producao_enc = coalesce(excluded.token_producao_enc, core.fiscal_emitente.token_producao_enc),
       externo_id = coalesce(excluded.externo_id, core.fiscal_emitente.externo_id),
       habilita_nfse_nacional = excluded.habilita_nfse_nacional,
       habilita_recebidas_nfe = excluded.habilita_recebidas_nfe,
       habilita_recebidas_cte = excluded.habilita_recebidas_cte,
       status = 'ativo', atualizado_em = now()
     returning id, razao_social, gatilhos_em`,
    [
      t.id, contaId, conexao?.id ?? null, cnpj,
      e.nome ?? e.nome_fantasia ?? cnpj, e.nome_fantasia ?? null,
      e.inscricao_municipal ?? null, e.inscricao_estadual ?? null,
      e.municipio ?? null, e.uf ?? null,
      e.codigo_municipio ? String(e.codigo_municipio) : null,
      !!e.habilita_nfse, !!e.habilita_nfe, !!e.habilita_nfce,
      !!e.habilita_cte, !!e.habilita_mdfe,
      e.token_homologacao ? encrypt(e.token_homologacao) : null,
      e.token_producao ? encrypt(e.token_producao) : null,
      e.id ? String(e.id) : null,
      !!e.habilita_nfsen_producao,
      !!e.habilita_manifestacao,
      !!e.habilita_manifestacao_cte,
    ],
  )

  const tem = [
    e.habilita_nfse && 'NFS-e', e.habilita_nfsen_producao && 'NFS-e nacional',
    e.habilita_nfe && 'NFe', e.habilita_cte && 'CT-e', e.habilita_mdfe && 'MDF-e',
    e.habilita_manifestacao && 'NFe recebidas',
    e.habilita_manifestacao_cte && 'CT-e recebidas',
  ].filter(Boolean)
  console.log(`  ok        ${cnpj}  ${salvo.razao_social}`)
  console.log(`            ${tem.length ? tem.join(', ') : 'nenhum documento habilitado ainda'}`
    + `${conexao ? `  |  ERP: ${conexao.nome} (por ${conexao.como})` : ''}`)
  if (!conexao) {
    console.log('            SEM VINCULO com empresa do Conta Azul. O botao de emitir')
    console.log('            so aparece quando o emitente esta ligado a uma conexao.')
  }
  if (!e.token_homologacao && !e.token_producao) {
    console.log('            ATENCAO: sem token, esta empresa nao emite.')
  }
  if (!e.inscricao_municipal) {
    console.log('            falta inscricao municipal para emitir NFS-e.')
  }
  if (!e.codigo_municipio) {
    console.log('            falta codigo IBGE do municipio.')
  }
}

// -------------------------------------------------------------- gatilhos

if (!appUrl || !segredo) {
  console.log('\nGatilhos nao cadastrados. Para cadastrar, defina:')
  if (!appUrl) console.log('  APP_URL              (ex.: https://driveazul.drivedata.com.br)')
  if (!segredo) console.log('  FOCUS_WEBHOOK_SECRET (gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))")')
  console.log('\nSem gatilho o sistema ainda funciona: a tela tem o botao Conferir,')
  console.log('que pergunta o estado a Focus. O gatilho so evita a pergunta.')
} else {
  const { registrarGatilhos } = await import('../lib/fiscal.js')
  const { rows: emits } = await query(
    `select * from core.fiscal_emitente where tenant_id = $1 and status = 'ativo'`, [t.id])
  console.log(`\nCadastrando gatilhos para ${appUrl.replace(/\/$/, '')}/api/fiscal/webhook`)
  for (const em of emits) {
    const r = await registrarGatilhos(em)
    if (r.pulado) console.log(`  ${em.razao_social}: ${r.pulado}`)
    else if (r.nenhum) console.log(`  ${em.razao_social}: ${r.nenhum}, nada a registrar`)
    else console.log(`  ${em.razao_social}: ${r.criados.length ? r.criados.join(', ') : 'ja estavam todos'}`)
  }
}

console.log('\nPronto. Confira com: npm run fiscalteste')
await pool.end()
