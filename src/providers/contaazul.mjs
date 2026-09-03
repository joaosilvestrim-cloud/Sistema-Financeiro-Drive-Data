// Adaptador da Conta Azul para o formato interno.
//
// Só este arquivo conhece nomes de campo da Conta Azul. Ingestão, marts e
// dashboard falam o formato interno. Quando entrar Omie ou Bling, basta um
// arquivo irmão aqui com a mesma superfície.
//
// Os mapeamentos das dimensões estão defensivos de propósito. A documentação
// não expõe o corpo completo de todos os recursos, então cada campo tem
// alternativa e o payload cru vai inteiro para raw.api_payload. Depois da
// primeira carga real dá para apertar isso com os nomes confirmados.

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
const first = (...vals) => vals.find((v) => v !== undefined && v !== null)

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
      external_id: String(r.id),
      nome: first(r.nome, r.name, r.apelido) ?? null,
      tipo: first(r.tipo, r.tipo_conta) ?? null,
      ativo: first(r.ativo, r.ativa, true),
      saldo_inicial: num(first(r.saldo_inicial, r.saldoInicial)),
    })),

    listCategories: dim('/v1/categorias', (r) => ({
      external_id: String(r.id),
      nome: r.nome ?? null,
      tipo: r.tipo ?? null,
      parent_external_id: r.categoria_pai ? String(r.categoria_pai) : null,
      entrada_dre: r.entrada_dre ?? null,
      considera_custo_dre: r.considera_custo_dre ?? null,
    }), { permite_apenas_filhos: false }),

    listDreCategories: dim('/v1/financeiro/categorias-dre', (r) => ({
      external_id: String(r.id),
      nome: first(r.nome, r.descricao) ?? null,
      ordem: num(first(r.ordem, r.posicao)),
    })),

    listCostCenters: dim('/v1/centro-de-custo', (r) => ({
      external_id: String(r.id),
      codigo: first(r.codigo, r.code) ?? null,
      nome: r.nome ?? null,
      ativo: first(r.ativo, true),
    })),

    listPeople: dim('/v1/pessoas', (r) => ({
      external_id: String(r.id),
      nome: first(r.nome, r.nome_fantasia, r.razao_social) ?? null,
      documento: first(r.documento, r.cpf, r.cnpj) ?? null,
      tipo_pessoa: first(r.tipo_pessoa, r.tipo) ?? null,
      perfis: Array.isArray(r.perfis)
        ? r.perfis.map((p) => (typeof p === 'string' ? p : first(p.tipo, p.perfil, p.nome)))
        : null,
      email: first(r.email, r.emails?.[0]) ?? null,
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
      return itens.map((r) => mapInstallment(r, kind))
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
      return itens.map((r) => ({ ...mapInstallment(r, kind), event_external_id: String(eventId) }))
    },

    // Detalhe traz rateio, categoria e centro de custo.
    async getInstallment(id) {
      const r = await client.get(`/v1/financeiro/eventos-financeiros/parcelas/${id}`)
      return r ? mapInstallment(r, null) : null
    },

    async listSettlements(installmentId) {
      const r = await client.get(
        `/v1/financeiro/eventos-financeiros/parcelas/${installmentId}/baixa`,
      )
      const lista = Array.isArray(r) ? r : r?.itens ?? (r ? [r] : [])
      return lista.map((b) => ({
        external_id: String(first(b.id, b.baixa_id, `${installmentId}-baixa`)),
        installment_external_id: String(installmentId),
        data_pagamento: first(b.data_pagamento, b.data, b.data_baixa) ?? null,
        valor: num(first(b.valor, b.valor_pago, b.total)),
        juros: num(first(b.juros, b.acrescimo)),
        desconto: num(b.desconto),
        account_external_id: first(b.id_conta_financeira, b.conta_financeira?.id) ?? null,
        raw: b,
      }))
    },

    async getBalance(accountId) {
      const r = await client.get(`/v1/conta-financeira/${accountId}/saldo-atual`)
      return num(first(r?.saldo, r?.saldo_atual, r?.valor))
    },
  }
}

function mapInstallment(r, kind) {
  const categoria = Array.isArray(r.categorias) ? r.categorias[0] : r.categoria
  return {
    external_id: String(r.id),
    event_external_id: first(r.id_evento, r.evento?.id, r.id_evento_financeiro)
      ? String(first(r.id_evento, r.evento?.id, r.id_evento_financeiro))
      : null,
    kind,
    descricao: r.descricao ?? null,
    data_vencimento: r.data_vencimento ?? null,
    data_competencia: r.data_competencia ?? null,
    status: r.status ?? null,
    status_traduzido: r.status_traduzido ?? null,
    total: num(r.total),
    pago: num(r.pago),
    nao_pago: num(r.nao_pago),
    person_external_id: first(r.id_cliente, r.cliente?.id, r.id_fornecedor, r.fornecedor?.id, r.pessoa?.id)
      ? String(first(r.id_cliente, r.cliente?.id, r.id_fornecedor, r.fornecedor?.id, r.pessoa?.id))
      : null,
    account_external_id: first(r.id_conta_financeira, r.conta_financeira?.id)
      ? String(first(r.id_conta_financeira, r.conta_financeira?.id))
      : null,
    category_external_id: categoria?.id ? String(categoria.id) : null,
    cost_center_external_id: first(r.id_centro_de_custo, r.centro_de_custo?.id)
      ? String(first(r.id_centro_de_custo, r.centro_de_custo?.id))
      : null,
    data_criacao: r.data_criacao ?? null,
    data_alteracao: r.data_alteracao ?? null,
    raw: r,
  }
}
