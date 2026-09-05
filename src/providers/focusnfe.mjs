// Cliente da Focus NFe.
//
// Só este arquivo conhece a forma da API deles. O resto do sistema fala em
// "emitir", "consultar", "encerrar", e recebe o formato interno. Quando um dia
// entrar outro emissor, entra um irmão deste arquivo com a mesma superfície,
// igual ao que já vale para a Conta Azul.
//
// Três coisas dessa API mudam como o código em volta tem que ser escrito.
//
// A emissão é assíncrona e a resposta imediata quase nunca é a nota. O POST
// devolve `processando_autorizacao` e a nota só existe de verdade quando a
// SEFAZ ou a prefeitura responde. Quem chama tem que aceitar isso: gravar o
// documento como "processando" e esperar o gatilho ou consultar depois.
//
// A referência é escolhida por quem chama e é única para sempre. Isso faz dela
// chave de idempotência: reenviar a mesma ref não duplica nota, devolve a que
// já existe com `nfe_ja_autorizada` ou equivalente. É o oposto de uma API que
// gera id no servidor, e é muito melhor para quem chama de um botão.
//
// O cancelamento é DELETE com corpo. Não é comum, mas é o que a API espera, e
// omitir a justificativa devolve erro que não parece erro de justificativa.
//
// E o token é da empresa, não da conta. Cada empresa emitente tem o seu par,
// homologação e produção, devolvido quando ela é criada. Duas consequências: o
// cliente é construído por empresa, e o cadastro de empresas fala com um token
// diferente do de emissão. Pior: a API de empresas só existe em produção, então
// mesmo com a emissão em homologação o cadastro sai pelo servidor de produção.

const BASES = {
  producao: 'https://api.focusnfe.com.br/v2',
  homologacao: 'https://homologacao.focusnfe.com.br/v2',
}

// O caminho de cada documento. A NFS-e municipal e a nacional são recursos
// diferentes de propósito: a reforma tributária está migrando município por
// município, e durante a transição as duas convivem.
const RECURSO = {
  nfse: 'nfse',
  nfse_nacional: 'nfsen',
  nfe: 'nfe',
  nfce: 'nfce',
  cte: 'cte',
  mdfe: 'mdfe',
}

// O nome do evento no cadastro de gatilho, que não é igual ao caminho em todos
// os casos.
export const EVENTO = {
  nfse: 'nfse',
  nfse_nacional: 'nfsen',
  nfe: 'nfe',
  nfce: 'nfce_contingencia',
  cte: 'cte',
  mdfe: 'mdfe',
  nfe_recebida: 'nfe_recebida',
  cte_recebida: 'cte_recebida',
}

export class ErroFocus extends Error {
  constructor(status, corpo, caminho) {
    const detalhe = corpo?.mensagem ?? corpo?.erros?.[0]?.mensagem ?? corpo?.codigo ?? 'sem detalhe'
    super(`Focus ${status} em ${caminho}: ${detalhe}`)
    this.name = 'ErroFocus'
    this.status = status
    this.codigo = corpo?.codigo ?? null
    this.corpo = corpo
    this.caminho = caminho
  }
  // Erro do documento, não da integração. Vale mostrar ao usuário e guardar no
  // documento; não vale tentar de novo sozinho.
  get doDocumento() {
    return this.status === 400 || this.status === 422
  }
}

export function focusCliente({ token, ambiente = 'homologacao', timeoutMs = 25000 } = {}) {
  if (!token) throw new Error('Faltou o token da Focus NFe')
  const base = BASES[ambiente]
  if (!base) throw new Error(`Ambiente desconhecido: ${ambiente}`)

  // Basic auth com o token no lugar do usuário e senha em branco. É o que a
  // documentação deles manda, e é por isso que o valor termina em dois pontos.
  const auth = 'Basic ' + Buffer.from(`${token}:`).toString('base64')

  let requisicoes = 0

  async function chamar(metodo, caminho, { corpo, query, emProducao = false } = {}) {
    const url = new URL((emProducao ? BASES.producao : base) + caminho)
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }

    const controle = AbortSignal.timeout(timeoutMs)
    requisicoes++
    const resposta = await fetch(url, {
      method: metodo,
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: controle,
    })

    const texto = await resposta.text()
    let dados = null
    try { dados = texto ? JSON.parse(texto) : null } catch { dados = { bruto: texto } }

    if (!resposta.ok) throw new ErroFocus(resposta.status, dados, `${metodo} ${caminho}`)
    return dados
  }

  const recurso = (tipo) => {
    const r = RECURSO[tipo]
    if (!r) throw new Error(`Tipo fiscal desconhecido: ${tipo}`)
    return r
  }

  return {
    provider: 'focusnfe',
    ambiente,
    get requisicoes() { return requisicoes },

    // ----------------------------------------------------------- empresas
    //
    // Sempre contra produção, mesmo quando o cliente está em homologação. Não
    // é escolha nossa: a API de empresas não tem ambiente de teste. Quem quer
    // ensaiar usa `simular`, que valida tudo e não grava.

    // O certificado chega aqui em base64 e sai daqui para a Focus. Não é
    // gravado, não é registrado em log, e o objeto é descartado quando a
    // função retorna. A senha idem.
    criarEmpresa(dados, { simular = false } = {}) {
      return chamar('POST', '/empresas', {
        corpo: dados, query: simular ? { dry_run: 1 } : {}, emProducao: true,
      })
    },
    atualizarEmpresa(id, dados, { simular = false } = {}) {
      return chamar('PUT', `/empresas/${id}`, {
        corpo: dados, query: simular ? { dry_run: 1 } : {}, emProducao: true,
      })
    },
    listarEmpresas(filtros = {}) {
      return chamar('GET', '/empresas', { query: filtros, emProducao: true })
    },
    consultarEmpresa(id) {
      return chamar('GET', `/empresas/${id}`, { emProducao: true })
    },

    // ---------------------------------------------------------- documento

    emitir(tipo, ref, payload) {
      return chamar('POST', `/${recurso(tipo)}`, { corpo: payload, query: { ref } })
    },
    // `completa=1` traz o XML e os caminhos dos arquivos junto. Sem isso a
    // consulta devolve só o status, e a tela ficaria sem link para o PDF.
    consultar(tipo, ref, { completa = true } = {}) {
      return chamar('GET', `/${recurso(tipo)}/${encodeURIComponent(ref)}`, {
        query: completa ? { completa: 1 } : {},
      })
    },
    cancelar(tipo, ref, justificativa) {
      // A justificativa tem mínimo de 15 caracteres na SEFAZ. Barrar aqui dá
      // uma mensagem que explica; deixar passar dá um 400 genérico.
      const texto = String(justificativa ?? '').trim()
      if (texto.length < 15) {
        throw new Error('A justificativa do cancelamento precisa de pelo menos 15 caracteres')
      }
      return chamar('DELETE', `/${recurso(tipo)}/${encodeURIComponent(ref)}`, {
        corpo: { justificativa: texto },
      })
    },

    // -------------------------------------------------------------- MDFe

    // Encerrar não é cancelar. Cancelar é desistir antes de sair; encerrar é
    // dizer que a carga chegou, e é obrigatório depois de toda viagem.
    encerrarMdfe(ref, { data, sigla_uf, nome_municipio }) {
      return chamar('POST', `/mdfe/${encodeURIComponent(ref)}/encerrar`, {
        corpo: { data, sigla_uf, nome_municipio },
      })
    },
    incluirCondutorMdfe(ref, { nome, cpf }) {
      return chamar('POST', `/mdfe/${encodeURIComponent(ref)}/incluir_condutor`, {
        corpo: { nome, cpf },
      })
    },

    // ---------------------------------------------------------- gatilhos

    // O gatilho aceita um cabeçalho de autorização escolhido por nós. É assim
    // que a nossa rota sabe que o aviso veio mesmo da Focus, sem precisar
    // colocar segredo na URL, que vaza em log de proxy.
    criarGatilho({ url, evento, cnpj, autorizacao, cabecalho = 'Authorization' }) {
      return chamar('POST', '/hooks', {
        corpo: {
          url,
          event: evento,
          ...(cnpj ? { cnpj } : {}),
          ...(autorizacao ? { authorization: autorizacao, authorization_header: cabecalho } : {}),
        },
      })
    },
    listarGatilhos() {
      return chamar('GET', '/hooks')
    },
    excluirGatilho(id) {
      return chamar('DELETE', `/hooks/${id}`)
    },

    // ------------------------------------------------------- recebidos
    //
    // O cursor é o campo `versao`, que cresce a cada alteração do documento e é
    // único por CNPJ. Guardar um número por empresa basta para nunca reprocessar
    // nada. É o mesmo CDC que a Conta Azul não tem, e por isso lá tivemos que
    // varrer por id.
    nfesRecebidas({ cnpj, versao = 0 }) {
      return chamar('GET', '/nfes_recebidas', { query: { cnpj, versao } })
    },
    ctesRecebidos({ cnpj, versao = 0 }) {
      return chamar('GET', '/ctes_recebidos', { query: { cnpj, versao } })
    },
  }
}

// ------------------------------------------------------------- tradução
//
// O status que a Focus devolve vira o nosso. Nomes diferentes para a mesma
// coisa aparecem conforme o documento, e sem esta tabela o mesmo evento
// gravaria status diferente dependendo de quem o viu.
const STATUS = {
  processando_autorizacao: 'processando',
  autorizado: 'autorizado',
  cancelado: 'cancelado',
  encerrado: 'encerrado',
  erro_autorizacao: 'erro',
  denegado: 'erro',
  nao_encontrado: 'erro',
}

export function statusInterno(bruto) {
  return STATUS[String(bruto ?? '').toLowerCase()] ?? 'processando'
}

// O retorno da Focus achatado no formato do nosso documento. Os nomes de campo
// mudam entre NFe, NFS-e e MDFe para a mesma informação, e é aqui que essa
// bagunça para de vazar para o resto do sistema.
export function doRetorno(r = {}) {
  const caminho = (v) => (v ? (String(v).startsWith('http') ? v : `https://api.focusnfe.com.br${v}`) : null)
  return {
    status: statusInterno(r.status),
    numero: r.numero ?? r.numero_nfse ?? r.numero_rps ?? null,
    serie: r.serie ?? r.serie_rps ?? null,
    chave: r.chave_nfe ?? r.chave_cte ?? r.chave_mdfe ?? r.codigo_verificacao ?? null,
    protocolo: r.protocolo ?? r.numero_protocolo ?? null,
    mensagem: r.mensagem_sefaz ?? r.mensagem ?? r.erros?.[0]?.mensagem ?? null,
    url_xml: caminho(r.caminho_xml_nota_fiscal ?? r.caminho_xml ?? r.caminho_xml_carta_correcao),
    url_pdf: caminho(r.caminho_danfe ?? r.caminho_pdf ?? r.caminho_danfse ?? r.caminho_damdfe),
  }
}
