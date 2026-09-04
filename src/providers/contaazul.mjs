// Adaptador da Conta Azul para o formato interno.
//
// Só este arquivo conhece nomes de campo da Conta Azul. Ingestão, marts e
// dashboard falam o formato interno. Quando entrar Omie ou Bling, basta um
// arquivo irmão aqui com a mesma superfície.
//
// Os mapeamentos foram conferidos contra respostas reais da API, guardadas em
// data/amostras. Duas armadilhas que só aparecem com payload de verdade:
//
// 1. A busca e o detalhe da parcela devolvem formatos diferentes. A busca traz
//    `pago` e `total`, não traz o id do evento nem a conta financeira. O detalhe
//    traz `valor_pago`, o evento com rateio, e as baixas embutidas.
// 2. Centro de custo vem em `centros_de_custo`, no plural e como lista, e não
//    no singular como a documentação sugere.

// A mesma parcela volta com status diferente conforme o endpoint: a busca diz
// PENDING, o detalhe diz PENDENTE. Sem normalizar, o status oscilaria na tela
// e nos indicadores conforme o caminho do sync.
const STATUS = {
  PENDING: 'EM_ABERTO', PENDENTE: 'EM_ABERTO', EM_ABERTO: 'EM_ABERTO', OPEN: 'EM_ABERTO',
  OVERDUE: 'ATRASADO', ATRASADO: 'ATRASADO', VENCIDO: 'ATRASADO',
  RECEIVED: 'RECEBIDO', RECEBIDO: 'RECEBIDO',
  PAID: 'PAGO', PAGO: 'PAGO',
  PARTIALLY_RECEIVED: 'PARCIAL', RECEBIDO_PARCIAL: 'PARCIAL',
  PARTIALLY_PAID: 'PARCIAL', PAGO_PARCIAL: 'PARCIAL', PARCIAL: 'PARCIAL',
  RENEGOTIATED: 'RENEGOCIADO', RENEGOCIADO: 'RENEGOCIADO',
  LOST: 'PERDIDO', PERDIDO: 'PERDIDO',
  CANCELED: 'CANCELADO', CANCELLED: 'CANCELADO', CANCELADO: 'CANCELADO',
}
const statusCanonico = (...candidatos) => {
  for (const c of candidatos) {
    const chave = String(c ?? '').toUpperCase()
    if (STATUS[chave]) return STATUS[chave]
  }
  return candidatos.find((c) => c) ?? null
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
const first = (...vals) => vals.find((v) => v !== undefined && v !== null)
const id = (v) => (v === null || v === undefined || v === '' ? null : String(v))

export function contaAzulProvider(client) {
  const dim = (path, map, params) => async () => {
    const { itens } = await client.getAll(path, params)
    return itens.map((raw) => ({ ...map(raw), raw }))
  }

  return {
    provider: 'contaazul',
    // exposto para o sync poder ler contadores de requisicao no fim da rodada
    _client: client,

    listAccounts: dim('/v1/conta-financeira', (r) => ({
      external_id: id(r.id),
      nome: first(r.nome, r.apelido, r.name) ?? null,
      tipo: first(r.tipo, r.tipo_conta) ?? null,
      ativo: first(r.ativo, r.ativa, true),
      saldo_inicial: num(first(r.saldo_inicial, r.saldoInicial)),
    })),

    listCategories: dim('/v1/categorias', (r) => ({
      external_id: id(r.id),
      nome: r.nome ?? null,
      tipo: r.tipo ?? null,
      parent_external_id: id(r.categoria_pai),
      entrada_dre: r.entrada_dre ?? null,
      considera_custo_dre: r.considera_custo_dre ?? null,
    }), { permite_apenas_filhos: false }),

    // Vem como árvore, sem envelope de paginação. Achatamos aqui para caber na
    // dimensão, guardando a posição de cada nível para reconstruir a ordem do DRE.
    async listDreCategories() {
      const { itens } = await client.getAll('/v1/financeiro/categorias-dre')
      const plano = []
      const percorrer = (nos, prefixo = 0) => {
        for (const n of nos ?? []) {
          plano.push({
            external_id: id(n.id),
            nome: first(n.descricao, n.nome) ?? null,
            ordem: num(first(n.posicao, n.ordem)) ?? prefixo,
            raw: n,
          })
          percorrer(n.subitens, prefixo + 1)
        }
      }
      percorrer(itens)
      return plano
    },

    listCostCenters: dim('/v1/centro-de-custo', (r) => ({
      external_id: id(r.id),
      codigo: first(r.codigo, r.code) ?? null,
      nome: r.nome ?? null,
      ativo: first(r.ativo, true),
    })),

    listPeople: dim('/v1/pessoas', (r) => ({
      external_id: id(r.id),
      nome: first(r.nome, r.nome_fantasia, r.razao_social) ?? null,
      documento: first(r.documento, r.cpf, r.cnpj) || null,
      tipo_pessoa: first(r.tipo_pessoa, r.tipo) ?? null,
      perfis: Array.isArray(r.perfis)
        ? r.perfis.map((p) => (typeof p === 'string' ? p : first(p.tipo, p.perfil, p.nome)))
        : null,
      email: first(r.email, r.emails?.[0]) || null,
    })),

    // kind: 'receivable' | 'payable'. A busca exige faixa de vencimento.
    async listInstallments({ kind, dueFrom, dueTo, changedFrom, changedTo }) {
      const alvo = kind === 'receivable' ? 'receber' : 'pagar'
      const { itens } = await client.getAll(
        `/v1/financeiro/eventos-financeiros/contas-a-${alvo}/buscar`,
        {
          data_vencimento_de: dueFrom,
          data_vencimento_ate: dueTo,
          data_alteracao_de: changedFrom,
          data_alteracao_ate: changedTo,
        },
      )
      return itens.map((r) => daBusca(r, kind))
    },

    // O CDC da plataforma. Devolve só os ids dos eventos tocados no período.
    async listChangedEventIds({ from, to }) {
      const { itens } = await client.getAll('/v1/financeiro/eventos-financeiros/alteracoes', {
        data_inicio: from,
        data_fim: to,
      })
      return itens.map((r) => String(r.id))
    },

    async listInstallmentsByEvent(eventId, kind = null) {
      const { itens } = await client.getAll(
        `/v1/financeiro/eventos-financeiros/${eventId}/parcelas`,
      )
      return itens.map((r) => ({
        ...(r.evento ? doDetalhe(r) : daBusca(r, kind)),
        event_external_id: String(eventId),
      }))
    },

    // Detalhe traz rateio, centro de custo, conta financeira e as baixas.
    async getInstallment(idParcela) {
      const r = await client.get(`/v1/financeiro/eventos-financeiros/parcelas/${idParcela}`)
      return r ? doDetalhe(r) : null
    },

    // As baixas já vêm dentro do detalhe da parcela. O endpoint separado existe
    // e devolve uma lista pura, sem envelope.
    async listSettlements(installmentId, detalhe = null) {
      const lista = detalhe?.baixas
        ?? await client.get(`/v1/financeiro/eventos-financeiros/parcelas/${installmentId}/baixa`)
      const baixas = Array.isArray(lista) ? lista : lista?.itens ?? (lista ? [lista] : [])
      return baixas.map(mapBaixa(installmentId))
    },

    async getBalance(accountId) {
      const r = await client.get(`/v1/conta-financeira/${accountId}/saldo-atual`)
      return num(first(r?.saldo, r?.saldo_atual, r?.valor))
    },
  }
}

// A baixa nao tem valor no topo. Tudo o que e dinheiro mora em
// `valor_composicao`, e o liquido e o que de fato entrou ou saiu da conta.
// Ler `b.valor` devolve indefinido sem erro nenhum, e o efeito e um fluxo de
// caixa realizado zerado com as datas todas certas, que parece problema de
// periodo e nao de mapeamento.
export const mapBaixa = (installmentId) => (b) => {
  const v = b.valor_composicao ?? {}
  return {
    external_id: id(first(b.id, b.baixa_id)) ?? `${installmentId}-baixa`,
    installment_external_id: String(first(b.id_parcela, installmentId)),
    data_pagamento: first(b.data_pagamento, b.data_baixa, b.data) ?? null,
    // Liquido move a conta financeira, bruto quita a parcela, e a diferenca e
    // a taxa do meio de pagamento. Guardar so um dos dois faz o pago da parcela
    // nunca fechar com a soma das baixas.
    valor: num(first(v.valor_liquido, v.valor_bruto, b.valor, b.valor_pago, b.total)),
    valor_bruto: num(first(v.valor_bruto, v.valor_liquido, b.valor, b.total)),
    taxa: num(first(v.taxa, b.taxa)),
    juros: num(first(v.juros, b.juros)) + num(first(v.multa, b.multa)) || null,
    desconto: num(first(v.desconto, b.desconto)),
    account_external_id: id(first(b.id_conta_financeira, b.conta_financeira?.id)),
    // Preenchido quer dizer casado com o extrato do banco. Nulo quer dizer que
    // o lancamento existe no ERP e ninguem conferiu contra o banco ainda.
    reconciliacao_external_id: id(first(b.id_reconciliacao, b.reconciliacao?.id)),
    raw: b,
  }
}

// Formato da busca. Enxuto, sem evento e sem conta financeira.
function daBusca(r, kind) {
  return {
    external_id: id(r.id),
    event_external_id: id(first(r.id_evento, r.evento?.id)),
    kind,
    descricao: r.descricao ?? null,
    data_vencimento: r.data_vencimento ?? null,
    data_competencia: r.data_competencia ?? null,
    status: statusCanonico(r.status_traduzido, r.status),
    status_traduzido: r.status_traduzido ?? r.status ?? null,
    total: num(r.total),
    pago: num(r.pago),
    nao_pago: num(r.nao_pago),
    person_external_id: id(first(r.cliente?.id, r.fornecedor?.id, r.pessoa?.id, r.id_cliente)),
    account_external_id: id(first(r.id_conta_financeira, r.conta_financeira?.id)),
    category_external_id: id(r.categorias?.[0]?.id ?? r.categoria?.id),
    cost_center_external_id: id(r.centros_de_custo?.[0]?.id ?? r.centro_de_custo?.id),
    data_criacao: r.data_criacao ?? null,
    data_alteracao: r.data_alteracao ?? null,
    raw: r,
  }
}

// Formato do detalhe. Traz o evento, o rateio e as baixas.
function doDetalhe(r) {
  const rateio = r.evento?.rateio?.[0]
  const bruto = first(r.valor_composicao?.valor_bruto, r.valor_composicao?.valor_liquido, r.valor_total_liquido)
  const pago = num(first(r.valor_pago, r.pago)) ?? 0
  const naoPago = num(first(r.nao_pago, bruto !== undefined ? Number(bruto) - pago : null))
  const total = num(bruto) ?? (naoPago !== null ? naoPago + pago : null)

  return {
    external_id: id(r.id),
    event_external_id: id(r.evento?.id),
    // O tipo do evento é a fonte confiável. A busca só sabe pelo endpoint usado.
    kind: r.evento?.tipo === 'RECEITA' ? 'receivable' : r.evento?.tipo === 'DESPESA' ? 'payable' : null,
    descricao: r.descricao ?? null,
    data_vencimento: r.data_vencimento ?? null,
    data_competencia: first(r.evento?.data_competencia, r.data_competencia) ?? null,
    status: statusCanonico(r.status_traduzido, r.status),
    status_traduzido: r.status_traduzido ?? r.status ?? null,
    total,
    pago,
    nao_pago: naoPago,
    person_external_id: id(first(r.cliente?.id, r.fornecedor?.id, r.pessoa?.id)),
    account_external_id: id(first(r.id_conta_financeira, r.conta_financeira?.id)),
    category_external_id: id(first(rateio?.id_categoria, r.categorias?.[0]?.id)),
    cost_center_external_id: id(first(
      rateio?.rateio_centro_custo?.[0]?.id_centro_custo,
      rateio?.rateio_centro_custo?.[0]?.id,
      r.centros_de_custo?.[0]?.id,
    )),
    data_criacao: r.data_criacao ?? null,
    data_alteracao: r.data_alteracao ?? null,
    raw: r,
  }
}
