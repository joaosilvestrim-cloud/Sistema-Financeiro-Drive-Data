import 'server-only'
import { q, q1 } from './db.js'
import { escopo } from './escopo.js'
import { encrypt, decrypt } from '../src/crypto.mjs'
import { focusCliente, doRetorno, ErroFocus, EVENTO } from '../src/providers/focusnfe.mjs'

// Emissão de documento fiscal pelo DriveAzul.
//
// O ciclo que esta camada fecha é o que o Diogo desenhou na reunião: o Conta
// Azul diz o que há a receber, a tela mostra o que ainda não virou nota, um
// botão emite, e a nota volta com o link do PDF para mandar ao cliente. Hoje
// isso é uma pessoa entrando em prefeitura, uma por uma.
//
// A parte difícil não é chamar a API, é decidir o que fica gravado. Duas
// regras valem para o arquivo inteiro:
//
// O certificado atravessa esta camada e não para nela. Ele chega em memória,
// vira base64, vai para a Focus e o objeto morre quando a função retorna. Não
// existe caminho, aqui ou em qualquer lugar do sistema, que escreva um A1 em
// disco ou em coluna.
//
// E toda emissão nasce com a referência já gravada, antes da chamada sair. Se
// a rede cair depois do POST e antes da resposta, o documento existe no nosso
// banco como "processando" e a consulta o encontra. O contrário, gravar depois
// de responder, perde nota emitida de verdade e ninguém descobre.

// --------------------------------------------------------------- conta

// Qual conta da Focus usar. Primeiro a do próprio tenant, se ele trouxe a
// dele; senão a da plataforma, que é o plano com CNPJ ilimitado sob o qual todo
// cliente vira uma empresa.
export async function contaFiscal(tenantId, ambiente = null) {
  const alvo = ambiente ?? (process.env.FOCUS_AMBIENTE || 'homologacao')
  return q1(
    `select id, tenant_id, ambiente, token_enc, rotulo
       from core.fiscal_conta
      where provider = 'focusnfe'
        and ambiente = $2
        and (tenant_id = $1 or tenant_id is null)
      order by tenant_id nulls last
      limit 1`,
    [tenantId, alvo],
  )
}

export async function clienteFiscal(tenantId, ambiente = null) {
  const conta = await contaFiscal(tenantId, ambiente)
  if (!conta) return null
  return { conta, api: focusCliente({ token: decrypt(conta.token_enc), ambiente: conta.ambiente }) }
}

// Cadastra ou troca o token. Chamado pelo script de instalação e pela tela de
// conexões. O token nunca volta para a tela depois de salvo.
export async function salvarContaFiscal({ tenantId = null, ambiente, token, rotulo = null }) {
  if (!['homologacao', 'producao'].includes(ambiente)) throw new Error('Ambiente inválido')
  if (!token) throw new Error('Token vazio')
  const existente = await q1(
    `select id from core.fiscal_conta
      where provider = 'focusnfe' and ambiente = $2
        and tenant_id is not distinct from $1`,
    [tenantId, ambiente],
  )
  if (existente) {
    await q(
      `update core.fiscal_conta set token_enc = $2, rotulo = $3, atualizado_em = now() where id = $1`,
      [existente.id, encrypt(token), rotulo],
    )
    return existente.id
  }
  const nova = await q1(
    `insert into core.fiscal_conta (tenant_id, ambiente, token_enc, rotulo)
     values ($1, $2, $3, $4) returning id`,
    [tenantId, ambiente, encrypt(token), rotulo],
  )
  return nova.id
}

// ------------------------------------------------------------ emitentes

export async function emitentes(sessao) {
  return q(
    `select e.*, c.nome as empresa_erp, c.ambiente_rotulo
       from core.fiscal_emitente e
       left join lateral (
         select cn.nome, null::text as ambiente_rotulo
           from core.connection cn where cn.id = e.connection_id
       ) c on true
      where e.tenant_id = $1
      order by e.razao_social`,
    [sessao.tenantId],
  )
}

// O emitente da empresa selecionada. Sem empresa selecionada, o único que
// existir. Com mais de um e nenhuma seleção, nada: emitir nota pela empresa
// errada é o tipo de erro que não se desfaz.
export async function emitenteDoEscopo(sessao) {
  if (sessao.connectionId) {
    return q1(
      `select * from core.fiscal_emitente
        where tenant_id = $1 and connection_id = $2 and status = 'ativo'`,
      [sessao.tenantId, sessao.connectionId],
    )
  }
  const lista = await q(
    `select * from core.fiscal_emitente where tenant_id = $1 and status = 'ativo'`,
    [sessao.tenantId],
  )
  return lista.length === 1 ? lista[0] : null
}

const digitos = (v) => String(v ?? '').replace(/\D/g, '')

// Cadastra a empresa na Focus e guarda o metadado aqui.
//
// `certificadoBase64` e `senha` entram por parâmetro, são usados uma vez e não
// são gravados em lugar nenhum. Quem chama é responsável por não os colocar em
// log; esta função não os devolve nem no erro.
export async function cadastrarEmitente(sessao, dados, { certificadoBase64, senha } = {}) {
  const cliente = await clienteFiscal(sessao.tenantId)
  if (!cliente) throw new Error('Nenhuma conta da Focus NFe configurada. Ver docs/FISCAL.md.')

  const cnpj = digitos(dados.cnpj)
  if (cnpj.length !== 14) throw new Error('CNPJ precisa ter 14 dígitos')

  const corpo = {
    nome: dados.razao_social,
    nome_fantasia: dados.nome_fantasia ?? dados.razao_social,
    cnpj,
    inscricao_municipal: dados.inscricao_municipal ?? null,
    inscricao_estadual: dados.inscricao_estadual ?? null,
    regime_tributario: dados.regime_tributario ?? null,
    logradouro: dados.logradouro,
    numero: dados.numero,
    complemento: dados.complemento ?? null,
    bairro: dados.bairro,
    municipio: dados.municipio,
    uf: dados.uf,
    cep: digitos(dados.cep),
    email: dados.email ?? null,
    telefone: dados.telefone ?? null,
    habilita_nfse: !!dados.habilita_nfse,
    habilita_nfe: !!dados.habilita_nfe,
    habilita_nfce: !!dados.habilita_nfce,
    habilita_cte: !!dados.habilita_cte,
    habilita_mdfe: !!dados.habilita_mdfe,
    ...(certificadoBase64
      ? { arquivo_certificado_base64: certificadoBase64, senha_certificado: senha }
      : {}),
  }

  // Simula antes de gravar. A Focus valida CNPJ, endereço e certificado sem
  // criar nada, e uma recusa aqui não deixa empresa pela metade lá nem aqui.
  await cliente.api.criarEmpresa(corpo, { simular: true })
  const criada = await cliente.api.criarEmpresa(corpo)

  const salvo = await q1(
    `insert into core.fiscal_emitente
       (tenant_id, conta_id, connection_id, cnpj, razao_social, nome_fantasia,
        inscricao_municipal, inscricao_estadual, regime_tributario, municipio, uf,
        codigo_municipio, item_lista_servico, codigo_cnae, codigo_tributario,
        aliquota_iss, iss_retido_padrao, optante_simples, discriminacao_padrao,
        habilita_nfse, habilita_nfe, habilita_nfce, habilita_cte, habilita_mdfe,
        certificado_cnpj, certificado_vence, certificado_enviado, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
             $20,$21,$22,$23,$24,$25,$26,$27,'ativo')
     on conflict (tenant_id, cnpj) do update set
       conta_id = excluded.conta_id,
       connection_id = excluded.connection_id,
       razao_social = excluded.razao_social,
       certificado_cnpj = excluded.certificado_cnpj,
       certificado_vence = excluded.certificado_vence,
       certificado_enviado = excluded.certificado_enviado,
       status = 'ativo', ultimo_erro = null, atualizado_em = now()
     returning *`,
    [
      sessao.tenantId, cliente.conta.id, dados.connection_id ?? sessao.connectionId ?? null,
      cnpj, dados.razao_social, dados.nome_fantasia ?? null,
      dados.inscricao_municipal ?? null, dados.inscricao_estadual ?? null,
      dados.regime_tributario ?? null, dados.municipio ?? null, dados.uf ?? null,
      dados.codigo_municipio ?? null, dados.item_lista_servico ?? null,
      dados.codigo_cnae ?? null, dados.codigo_tributario ?? null,
      dados.aliquota_iss ?? null, !!dados.iss_retido_padrao,
      dados.optante_simples !== false, dados.discriminacao_padrao ?? null,
      !!dados.habilita_nfse, !!dados.habilita_nfe, !!dados.habilita_nfce,
      !!dados.habilita_cte, !!dados.habilita_mdfe,
      criada?.certificado_cnpj ?? criada?.cnpj ?? cnpj,
      criada?.certificado_valido_ate ?? criada?.certificado_vencimento ?? null,
      certificadoBase64 ? new Date() : null,
    ],
  )
  return salvo
}

// ------------------------------------------------------------ referência
//
// A referência é a chave de idempotência. Ela nasce do título quando existe
// título, para que dois cliques no mesmo botão produzam a mesma referência e a
// Focus recuse a segunda em vez de emitir duas notas. O sufixo só aparece
// quando já houve uma tentativa antes, que é o caso de reemitir depois de
// cancelar.
async function novaRef(tenantId, tipo, semente) {
  const base = `${tipo}-${digitos(semente) || String(semente).replace(/[^a-z0-9]/gi, '').toLowerCase()}`.slice(0, 36)
  const usados = await q(
    `select ref from core.fiscal_documento where tenant_id = $1 and ref like $2`,
    [tenantId, `${base}%`],
  )
  if (!usados.length) return base
  return `${base}-${usados.length + 1}`
}

// --------------------------------------------------------------- emissão

// Monta o corpo da NFS-e a partir do título e dos padrões do emitente.
//
// Separado da emissão de propósito: assim dá para conferir o payload num teste
// sem token nenhum, e a maior parte dos erros de NFS-e é payload, não rede.
export function montarNfse(emitente, titulo, ajustes = {}) {
  const doc = digitos(ajustes.tomador_documento ?? titulo.pessoa_documento)
  const valor = Number(ajustes.valor ?? titulo.total ?? 0)

  const faltando = []
  if (!emitente.inscricao_municipal) faltando.push('inscrição municipal do emitente')
  if (!emitente.codigo_municipio) faltando.push('código IBGE do município do emitente')
  if (!emitente.item_lista_servico) faltando.push('item da lista de serviço')
  if (!(valor > 0)) faltando.push('valor do serviço')
  if (doc.length !== 11 && doc.length !== 14) faltando.push('CPF ou CNPJ do tomador')

  const discriminacao = ajustes.discriminacao
    ?? titulo.descricao
    ?? emitente.discriminacao_padrao
    ?? null
  if (!discriminacao) faltando.push('discriminação do serviço')

  const payload = {
    data_emissao: (ajustes.data_emissao ?? new Date()).toISOString?.() ?? ajustes.data_emissao,
    natureza_operacao: emitente.natureza_operacao ?? '1',
    optante_simples_nacional: emitente.optante_simples !== false,
    prestador: {
      cnpj: emitente.cnpj,
      inscricao_municipal: emitente.inscricao_municipal,
      codigo_municipio: emitente.codigo_municipio,
    },
    tomador: {
      ...(doc.length === 14 ? { cnpj: doc } : {}),
      ...(doc.length === 11 ? { cpf: doc } : {}),
      razao_social: ajustes.tomador_nome ?? titulo.pessoa,
      ...(ajustes.tomador_email ? { email: ajustes.tomador_email } : {}),
    },
    servico: {
      valor_servicos: Number(valor.toFixed(2)),
      iss_retido: ajustes.iss_retido ?? !!emitente.iss_retido_padrao,
      item_lista_servico: emitente.item_lista_servico,
      discriminacao,
      codigo_municipio: emitente.codigo_municipio,
      ...(emitente.aliquota_iss != null ? { aliquota: Number(emitente.aliquota_iss) } : {}),
      ...(emitente.codigo_cnae ? { codigo_cnae: emitente.codigo_cnae } : {}),
      ...(emitente.codigo_tributario ? { codigo_tributario_municipio: emitente.codigo_tributario } : {}),
    },
  }

  return { payload, faltando }
}

// Emite a NFS-e de um título a receber.
//
// A ordem importa. O documento é gravado antes da chamada sair, com a
// referência já definida. Se a chamada falhar, ele fica com status de erro e a
// mensagem; se der certo, vira "processando" até o gatilho chegar. Em nenhum
// caso existe nota emitida na Focus sem linha correspondente aqui.
export async function emitirNfseDeTitulo(sessao, installmentId, ajustes = {}) {
  const emitente = ajustes.emitente ?? await emitenteDoEscopo(sessao)
  if (!emitente) throw new Error('Nenhum emitente ativo para esta empresa')
  if (!emitente.habilita_nfse) throw new Error('Este emitente não está habilitado para NFS-e')

  const titulo = await q1(
    `select * from mart.recebivel_sem_nota where tenant_id = $1 and installment_id = $2`,
    [sessao.tenantId, installmentId],
  )
  if (!titulo) throw new Error('Título não encontrado ou já tem nota')

  const { payload, faltando } = montarNfse(emitente, titulo, ajustes)
  if (faltando.length) {
    throw new Error(`Falta preencher: ${faltando.join(', ')}`)
  }

  const ref = await novaRef(sessao.tenantId, 'nfse', installmentId)
  const doc = await q1(
    `insert into core.fiscal_documento
       (tenant_id, emitente_id, connection_id, tipo, ref, status, installment_id,
        person_id, valor, tomador_nome, tomador_doc, descricao, enviado)
     values ($1,$2,$3,'nfse',$4,'rascunho',$5,$6,$7,$8,$9,$10,$11)
     returning *`,
    [
      sessao.tenantId, emitente.id, emitente.connection_id, ref, installmentId,
      titulo.person_id, payload.servico.valor_servicos,
      payload.tomador.razao_social, payload.tomador.cnpj ?? payload.tomador.cpf,
      payload.servico.discriminacao, payload,
    ],
  )

  const cliente = await clienteFiscal(sessao.tenantId)
  try {
    const r = await cliente.api.emitir('nfse', ref, payload)
    return await gravarRetorno(doc.id, r)
  } catch (e) {
    const mensagem = e instanceof ErroFocus
      ? (e.corpo?.mensagem ?? e.corpo?.erros?.[0]?.mensagem ?? e.message)
      : e.message
    await q(
      `update core.fiscal_documento
          set status = 'erro', mensagem = $2, retorno = $3, atualizado_em = now()
        where id = $1`,
      [doc.id, mensagem, e instanceof ErroFocus ? e.corpo ?? {} : {}],
    )
    throw e
  }
}

async function gravarRetorno(documentoId, r) {
  const t = doRetorno(r)
  return q1(
    `update core.fiscal_documento
        set status = $2::core.fiscal_status,
            numero = coalesce($3, numero),
            serie = coalesce($4, serie),
            chave = coalesce($5, chave),
            protocolo = coalesce($6, protocolo),
            mensagem = $7,
            url_xml = coalesce($8, url_xml),
            url_pdf = coalesce($9, url_pdf),
            data_emissao = coalesce(data_emissao, case when $2 = 'autorizado' then now() end),
            cancelado_em = case when $2 = 'cancelado' then coalesce(cancelado_em, now()) else cancelado_em end,
            encerrado_em = case when $2 = 'encerrado' then coalesce(encerrado_em, now()) else encerrado_em end,
            retorno = $10,
            atualizado_em = now()
      where id = $1
      returning *`,
    [documentoId, t.status, t.numero, t.serie, t.chave, t.protocolo, t.mensagem,
     t.url_xml, t.url_pdf, r ?? {}],
  )
}

// Pergunta o estado atual à Focus. É a rede de segurança do gatilho: se o
// webhook não chegou, isto resolve, e a tela oferece o botão.
export async function sincronizarDocumento(sessao, documentoId) {
  const doc = await q1(
    `select * from core.fiscal_documento where tenant_id = $1 and id = $2`,
    [sessao.tenantId, documentoId],
  )
  if (!doc) throw new Error('Documento não encontrado')
  const cliente = await clienteFiscal(sessao.tenantId)
  const r = await cliente.api.consultar(doc.tipo, doc.ref)
  return gravarRetorno(doc.id, r)
}

export async function cancelarDocumento(sessao, documentoId, justificativa) {
  const doc = await q1(
    `select * from core.fiscal_documento where tenant_id = $1 and id = $2`,
    [sessao.tenantId, documentoId],
  )
  if (!doc) throw new Error('Documento não encontrado')
  if (doc.status !== 'autorizado') throw new Error('Só documento autorizado pode ser cancelado')
  const cliente = await clienteFiscal(sessao.tenantId)
  const r = await cliente.api.cancelar(doc.tipo, doc.ref, justificativa)
  return gravarRetorno(doc.id, r)
}

// Encerra o manifesto. É o evento que falta na maioria das transportadoras e o
// motivo de existir a tela de manifestos em viagem.
export async function encerrarManifesto(sessao, documentoId, { data, uf, municipio }) {
  const doc = await q1(
    `select * from core.fiscal_documento
      where tenant_id = $1 and id = $2 and tipo = 'mdfe'`,
    [sessao.tenantId, documentoId],
  )
  if (!doc) throw new Error('Manifesto não encontrado')
  if (doc.encerrado_em) throw new Error('Este manifesto já foi encerrado')
  const cliente = await clienteFiscal(sessao.tenantId)
  await cliente.api.encerrarMdfe(doc.ref, {
    data: data ?? new Date().toISOString().slice(0, 10),
    sigla_uf: uf,
    nome_municipio: municipio,
  })
  return q1(
    `update core.fiscal_documento
        set status = 'encerrado', encerrado_em = now(), atualizado_em = now()
      where id = $1 returning *`,
    [doc.id],
  )
}

// --------------------------------------------------------------- gatilho

// Grava o aviso antes de interpretá-lo. Se a interpretação falhar, o aviso
// continua no banco com `processado = false` e dá para reprocessar sem pedir
// reenvio à Focus.
export async function registrarEvento({ ref, corpo }) {
  const doc = ref
    ? await q1(`select id, tenant_id from core.fiscal_documento where ref = $1`, [ref])
    : null
  const evento = await q1(
    `insert into core.fiscal_evento (tenant_id, documento_id, ref, status, corpo)
     values ($1, $2, $3, $4, $5) returning id`,
    [doc?.tenant_id ?? null, doc?.id ?? null, ref ?? null, corpo?.status ?? null, corpo ?? {}],
  )
  if (!doc) return { evento: evento.id, documento: null }
  await gravarRetorno(doc.id, corpo)
  await q(`update core.fiscal_evento set processado = true where id = $1`, [evento.id])
  return { evento: evento.id, documento: doc.id }
}

// --------------------------------------------------------------- leitura

export async function documentos(sessao, limite = 60) {
  const { where, params } = escopo(sessao, 'd')
  return q(
    `select d.*, e.razao_social as emitente
       from core.fiscal_documento d
       join core.fiscal_emitente e on e.id = d.emitente_id
      where ${where}
      order by d.criado_em desc
      limit $${params.length + 1}`,
    [...params, limite],
  )
}

export async function recebiveisSemNota(sessao, limite = 60) {
  const { where, params } = escopo(sessao)
  return q(
    `select * from mart.recebivel_sem_nota
      where ${where}
        and data_competencia <= current_date
      order by data_vencimento asc
      limit $${params.length + 1}`,
    [...params, limite],
  )
}

// Manifestos autorizados que ninguém encerrou. A pergunta que só existe porque
// o MDFe tem evento de encerramento separado, e a que ninguém responde hoje.
export async function manifestosEmViagem(sessao) {
  const { where, params } = escopo(sessao, 'd')
  return q(
    `select d.*, current_date - d.data_emissao::date as dias_em_viagem
       from core.fiscal_documento d
      where ${where}
        and d.tipo = 'mdfe'
        and d.status = 'autorizado'
        and d.encerrado_em is null
      order by d.data_emissao asc`,
    params,
  )
}

export async function resumoFiscal(sessao) {
  const { where, params } = escopo(sessao, 'd')
  const doc = await q1(
    `select
       count(*) filter (where d.status = 'autorizado')                 as autorizados,
       count(*) filter (where d.status = 'processando')                as processando,
       count(*) filter (where d.status = 'erro')                       as com_erro,
       coalesce(sum(d.valor) filter (
         where d.status = 'autorizado'
           and date_trunc('month', d.data_emissao) = date_trunc('month', current_date)
       ), 0)                                                            as valor_no_mes,
       count(*) filter (
         where d.tipo = 'mdfe' and d.status = 'autorizado' and d.encerrado_em is null
       )                                                                as manifestos_abertos
     from core.fiscal_documento d
     where ${where}`,
    params,
  )

  const semNota = await q1(
    `select count(*) as titulos, coalesce(sum(total), 0) as valor
       from mart.recebivel_sem_nota
      where ${escopo(sessao).where} and data_competencia <= current_date`,
    escopo(sessao).params,
  )

  const certificado = await q1(
    `select min(certificado_vence) as vence,
            count(*) filter (where certificado_vence < current_date + 30) as vencendo
       from core.fiscal_emitente
      where tenant_id = $1 and status = 'ativo'`,
    [sessao.tenantId],
  )

  return { ...doc, semNota, certificado }
}

export { EVENTO }
