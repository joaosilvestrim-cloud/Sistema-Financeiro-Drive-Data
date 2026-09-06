// Confere a camada fiscal.
//
// A maior parte do que dá errado numa NFS-e não é rede, é payload: inscrição
// municipal ausente, código IBGE trocado pelo nome da cidade, tomador sem
// documento. Por isso o montador do corpo é uma função pura e a maior parte
// deste teste roda sem token nenhum, contra dados reais do banco.
//
// Quando FOCUS_TOKEN existir no ambiente, o teste também conversa com a
// homologação, para provar que a autenticação e o caminho estão certos. Sem
// token ele diz o que deixou de conferir, em vez de fingir que passou.
import { pool, query } from '../src/db.mjs'
import { montarNfse } from '../lib/fiscal.js'
import { focusCliente, doRetorno, statusInterno } from '../src/providers/focusnfe.mjs'

let falhas = 0
const ok = (cond, texto, extra = '') => {
  if (!cond) falhas++
  console.log(`  ${cond ? 'ok  ' : 'FALHA'} ${texto}${extra ? '  ' + extra : ''}`)
}

const { rows: [t] } = await query('select id, nome from core.tenant order by slug limit 1')
const sessao = { tenantId: t.id, connectionId: null }

console.log('== ESQUEMA ==')
{
  const { rows } = await query(
    `select table_name from information_schema.tables
      where table_schema = 'core' and table_name like 'fiscal_%'
      order by table_name`)
  const nomes = rows.map((r) => r.table_name)
  for (const esperado of ['fiscal_conta', 'fiscal_documento', 'fiscal_emitente', 'fiscal_evento']) {
    ok(nomes.includes(esperado), `tabela core.${esperado}`)
  }
  // O token e' da empresa, nao da conta. Sem estas colunas o sistema emitiria
  // tudo com o token administrativo, que e' de outra empresa.
  const { rows: cols } = await query(
    `select column_name from information_schema.columns
      where table_schema = 'core' and table_name = 'fiscal_emitente'`)
  const temCol = (c) => cols.some((x) => x.column_name === c)
  ok(temCol('token_homologacao_enc') && temCol('token_producao_enc'),
     'emitente tem o proprio par de tokens')
  const { rows: [v] } = await query(
    `select count(*) as n from information_schema.views
      where table_schema = 'mart' and table_name = 'recebivel_para_nota'`)
  ok(Number(v.n) === 1, 'view mart.recebivel_para_nota')

  // A referencia e' chave de idempotencia. Sem a unicidade no banco, dois
  // cliques no botao emitiriam duas notas e o cliente pagaria imposto em dobro.
  const { rows: [u] } = await query(
    `select count(*) as n from pg_indexes
      where schemaname = 'core' and tablename = 'fiscal_documento'
        and indexdef ilike '%unique%(tenant_id, ref)%'`)
  ok(Number(u.n) === 1, 'referencia unica por tenant')
}

console.log('\n== O QUE ENTRA NA LISTA DE EMISSAO ==')
{
  const { rows } = await query(
    `select motivo, count(*)::int n, coalesce(sum(total),0) valor
       from mart.recebivel_para_nota
      where tenant_id = $1 and data_competencia <= current_date
      group by 1 order by 2 desc`, [t.id])
  for (const r of rows) {
    console.log(`  ${String(r.n).padStart(4)}  ${r.motivo.padEnd(14)} ${Number(r.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`)
  }

  // A regra que a Tamires pediu, virada em teste: titulo que o Conta Azul ja
  // faturou nunca pode aparecer como pendente. O ERP carimba o numero na
  // descricao, e emitir de novo criaria nota duplicada, que e' imposto em dobro
  // e retificacao na prefeitura.
  const { rows: [d] } = await query(
    `select count(*) n from mart.recebivel_para_nota
      where tenant_id = $1 and motivo = 'pendente'
        and descricao ~ 'NFS-?e\s*:\s*[0-9]+'`, [t.id])
  ok(Number(d.n) === 0, 'nenhum titulo com nota do ERP entra como pendente', `${d.n} entrariam`)

  // E o numero da nota do ERP tem que ser lido, senao a regra acima passaria
  // por nao achar nada em vez de por estar certa.
  const { rows: [ler] } = await query(
    `select count(*) n from mart.recebivel_para_nota
      where tenant_id = $1 and nota_no_erp is not null`, [t.id])
  ok(Number(ler.n) > 0, 'o numero da NFS-e e lido da descricao do ERP', `${ler.n} titulo(s)`)

  // Sem CPF ou CNPJ do tomador a NFS-e nao sai. Oferecer o botao ali seria
  // prometer uma coisa que a validacao recusa depois.
  const { rows: [semdoc] } = await query(
    `select count(*) n from mart.recebivel_para_nota
      where tenant_id = $1 and motivo = 'pendente'
        and coalesce(regexp_replace(pessoa_documento, '[^0-9]', '', 'g'), '') !~ '^([0-9]{11}|[0-9]{14})$'`,
    [t.id])
  ok(Number(semdoc.n) === 0, 'nenhum pendente sem documento do tomador', `${semdoc.n} entrariam`)

  // Todo recebivel tem exatamente um motivo. Se algum cair fora do CASE, ele
  // some da tela sem ninguem perceber.
  const { rows: [cobre] } = await query(
    `select
       (select count(*) from core.installment
         where tenant_id = $1 and kind = 'receivable' and deleted_at is null
           and data_competencia is not null) todos,
       (select count(*) from mart.recebivel_para_nota where tenant_id = $1) na_view`, [t.id])
  ok(Number(cobre.todos) === Number(cobre.na_view), 'a view cobre todo recebivel',
     `${cobre.todos} contra ${cobre.na_view}`)
}

console.log('\n== MONTAGEM DA NFS-e ==')
{
  // Emitente completo, so' para o montador. Nao toca o banco.
  const emitente = {
    cnpj: '12345678000199', inscricao_municipal: '123456', codigo_municipio: '3550308',
    item_lista_servico: '01.07', aliquota_iss: 2, codigo_cnae: '6201500',
    optante_simples: true, natureza_operacao: '1', iss_retido_padrao: false,
    discriminacao_padrao: 'Servico de consultoria',
  }
  const titulo = {
    pessoa: 'CLIENTE EXEMPLO LTDA', pessoa_documento: '11.222.333/0001-81',
    descricao: 'Consultoria de dados, setembro', total: 12500.5,
  }

  const { payload, faltando } = montarNfse(emitente, titulo)
  ok(faltando.length === 0, 'emitente completo nao acusa falta', faltando.join(', '))
  ok(payload.prestador.cnpj === '12345678000199', 'CNPJ do prestador')
  ok(payload.prestador.codigo_municipio === '3550308', 'codigo IBGE no prestador')
  ok(payload.servico.codigo_municipio === '3550308', 'codigo IBGE no servico')
  // O documento do tomador chega com pontuacao do ERP e tem que sair limpo, no
  // campo certo conforme o tamanho.
  ok(payload.tomador.cnpj === '11222333000181', 'CNPJ do tomador limpo de pontuacao')
  ok(payload.tomador.cpf === undefined, 'CNPJ nao vai no campo de CPF')
  ok(payload.servico.valor_servicos === 12500.5, 'valor do servico')
  ok(payload.servico.discriminacao === titulo.descricao, 'discriminacao vem do titulo')
  ok(payload.servico.iss_retido === false, 'ISS retido segue o padrao do emitente')

  // Tomador pessoa fisica cai no outro campo.
  const pf = montarNfse(emitente, { ...titulo, pessoa_documento: '123.456.789-09' })
  ok(pf.payload.tomador.cpf === '12345678909', 'CPF do tomador vai em cpf')
  ok(pf.payload.tomador.cnpj === undefined, 'CPF nao vai no campo de CNPJ')

  // Campos obrigatorios da API, conferidos um a um. Se a Focus mudar o
  // contrato, este teste quebra antes do cliente.
  for (const campo of ['data_emissao', 'natureza_operacao', 'optante_simples_nacional',
                       'prestador', 'tomador', 'servico']) {
    ok(payload[campo] !== undefined, `campo obrigatorio ${campo}`)
  }
  for (const campo of ['valor_servicos', 'iss_retido', 'item_lista_servico',
                       'discriminacao', 'codigo_municipio']) {
    ok(payload.servico[campo] !== undefined, `campo obrigatorio servico.${campo}`)
  }

  // E o que importa mais: config incompleta tem que dizer o que falta, em
  // portugues, antes de gastar uma chamada.
  const capenga = montarNfse(
    { ...emitente, inscricao_municipal: null, codigo_municipio: null, item_lista_servico: null },
    { ...titulo, pessoa_documento: null, descricao: null },
  )
  ok(capenga.faltando.length === 4, 'config incompleta acusa as quatro faltas',
     capenga.faltando.join(' | '))
  ok(capenga.faltando.some((f) => f.includes('IBGE')), 'a falta do IBGE e nomeada')

  // A descricao do titulo faltou acima e nao foi acusada, de proposito: o
  // emitente tem discriminacao padrao e ela cobre o buraco. So' quando as duas
  // faltam e' que a nota nao tem como sair.
  const semTexto = montarNfse(
    { ...emitente, discriminacao_padrao: null },
    { ...titulo, descricao: null },
  )
  ok(semTexto.faltando.length === 1
     && semTexto.faltando[0].includes('discriminação'),
     'discriminacao padrao cobre titulo sem descricao, e a falta das duas e acusada',
     semTexto.faltando.join(' | '))

  // Valor zero nao pode virar nota. Nota de zero real e' recusada pela
  // prefeitura e, pior, conta como emissao no pacote.
  const semValor = montarNfse(emitente, { ...titulo, total: 0 })
  ok(semValor.faltando.some((f) => f.includes('valor')), 'valor zero e barrado')
}

console.log('\n== TRADUCAO DO RETORNO ==')
{
  ok(statusInterno('processando_autorizacao') === 'processando', 'processando_autorizacao')
  ok(statusInterno('autorizado') === 'autorizado', 'autorizado')
  ok(statusInterno('erro_autorizacao') === 'erro', 'erro_autorizacao')
  ok(statusInterno('cancelado') === 'cancelado', 'cancelado')
  // Status desconhecido nao pode virar erro: virar erro faria a tela mostrar
  // vermelho para uma nota que esta apenas em um estado novo.
  ok(statusInterno('coisa_nova') === 'processando', 'status desconhecido fica em processando')

  const r = doRetorno({
    status: 'autorizado', numero: '42', serie: '1',
    chave_nfe: '3526' + '0'.repeat(40),
    caminho_xml_nota_fiscal: '/arquivos/x.xml', caminho_danfe: '/arquivos/x.pdf',
  })
  ok(r.status === 'autorizado', 'retorno traduzido')
  ok(r.url_pdf.startsWith('https://'), 'caminho relativo vira URL absoluta', r.url_pdf)

  // NFS-e nao tem chave de acesso, tem codigo de verificacao. O mesmo campo
  // interno guarda os dois, senao a tela precisaria de duas colunas para a
  // mesma ideia.
  const nfse = doRetorno({ status: 'autorizado', numero_nfse: '10', codigo_verificacao: 'ABC123' })
  ok(nfse.chave === 'ABC123', 'codigo de verificacao da NFS-e cai em chave')
  ok(nfse.numero === '10', 'numero da NFS-e')
}

console.log('\n== CLIENTE ==')
{
  let erro = null
  try { focusCliente({ token: null }) } catch (e) { erro = e }
  ok(erro !== null, 'sem token o cliente se recusa a existir')

  const api = focusCliente({ token: 'fake', ambiente: 'homologacao' })
  ok(api.ambiente === 'homologacao', 'ambiente de homologacao')

  // Justificativa curta e' barrada aqui, com mensagem que explica, em vez de
  // virar um 400 generico da SEFAZ.
  let curta = null
  try { await api.cancelar('nfse', 'x', 'curta') } catch (e) { curta = e }
  ok(curta && /15 caracteres/.test(curta.message), 'justificativa curta e barrada antes de sair')

  let tipo = null
  try { await api.consultar('inexistente', 'x') } catch (e) { tipo = e }
  ok(tipo && /Tipo fiscal desconhecido/.test(tipo.message), 'tipo desconhecido e barrado')
}

console.log('\n== EMITENTES CADASTRADOS ==')
{
  const { rows: emits } = await query(
    `select razao_social, cnpj, status, inscricao_municipal, codigo_municipio,
            item_lista_servico, habilita_nfse, habilita_mdfe,
            token_homologacao_enc is not null as tem_homologacao,
            token_producao_enc is not null as tem_producao,
            gatilhos_em
       from core.fiscal_emitente where tenant_id = $1 order by razao_social`, [t.id])
  if (!emits.length) {
    console.log('  nenhum ainda. Rode: npm run fiscalinstalar')
  }
  for (const e of emits) {
    console.log(`  ${e.cnpj}  ${e.razao_social}  (${e.status})`)
    // Emitente ativo sem token nao emite, e o erro so' apareceria no clique.
    ok(e.tem_homologacao || e.tem_producao, `  ${e.razao_social}: tem token proprio`)
    if (e.habilita_nfse) {
      ok(!!e.inscricao_municipal, `  ${e.razao_social}: inscricao municipal`)
      ok(!!e.codigo_municipio, `  ${e.razao_social}: codigo IBGE do municipio`)
      ok(!!e.item_lista_servico, `  ${e.razao_social}: item da lista de servico`)
    }
    console.log(`    gatilhos: ${e.gatilhos_em ? String(e.gatilhos_em).slice(0, 19) : 'nao cadastrados'}`)
  }
}

console.log('\n== CONEXAO COM A FOCUS ==')
if (!process.env.FOCUS_TOKEN) {
  console.log('  pulado: FOCUS_TOKEN nao esta no ambiente.')
  console.log('  O token fica no painel da Focus, em Painel API > Tokens de Acesso,')
  console.log('  e pertence a uma empresa, nao a conta. Depois rode: npm run fiscalinstalar')
} else {
  const api = focusCliente({
    token: process.env.FOCUS_TOKEN,
    ambiente: process.env.FOCUS_AMBIENTE || 'homologacao',
  })
  try {
    const empresas = await api.listarEmpresas()
    ok(Array.isArray(empresas), 'listar empresas responde', `${empresas?.length ?? 0} empresa(s)`)
    const hooks = await api.listarGatilhos()
    ok(Array.isArray(hooks), 'listar gatilhos responde', `${hooks?.length ?? 0} gatilho(s)`)
    for (const h of hooks ?? []) console.log(`    gatilho ${h.event} -> ${h.url}`)
  } catch (e) {
    falhas++
    console.log(`  FALHA ao falar com a Focus: ${e.message}`)
  }
}

console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.')
await pool.end()
process.exit(falhas ? 1 : 0)
