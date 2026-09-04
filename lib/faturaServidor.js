import 'server-only'
import { q, q1 } from './db.js'
import { lerFatura, sugerirCategoria } from './fatura.js'
import { clientFor } from '../src/connections.mjs'

// Envia as compras da fatura para o Conta Azul como contas a pagar.
//
// Dois cuidados que a API impõe e que mudam o desenho:
//
// 1. Criar é assíncrono. O POST responde 202 com um protocolo, não com o
//    lançamento. O status real vem de uma segunda consulta, e sem ela a tela
//    diria "enviado" para algo que falhou.
//
// 2. Não existe endpoint para apagar um evento financeiro. Enviar duas vezes
//    cria despesa duplicada no ERP e o conserto é manual. Por isso toda linha
//    carrega uma impressão digital, gravada antes do envio, com chave única no
//    banco: subir o mesmo arquivo de novo não reenvia nada.

export async function prepararFatura(sessao, texto) {
  const conexao = await q1(
    `select id from core.connection
      where tenant_id = $1 and provider = 'contaazul' and status = 'connected'
      order by nome limit 1`,
    [sessao.tenantId],
  )
  if (!conexao) return { erro: 'Nenhuma conexão ativa com a Conta Azul.' }

  const { compras, pagamentos, vencimento, total } = lerFatura(texto)
  if (!compras.length) return { erro: 'Não encontrei nenhuma compra nesse arquivo.' }

  const [historico, categorias, contas, pessoas, jaImportadas] = await Promise.all([
    // Só o que já tem categoria serve de exemplo para sugerir.
    q(`select descricao, category_id from core.installment
        where connection_id = $1 and kind = 'payable' and category_id is not null
          and descricao is not null
        order by data_vencimento desc limit 400`, [conexao.id]),
    q(`select id, nome from core.category
        where connection_id = $1 and tipo = 'DESPESA' order by nome`, [conexao.id]),
    q(`select id, external_id, nome, tipo from core.account
        where connection_id = $1 and coalesce(ativo, true) order by nome`, [conexao.id]),
    q(`select id, external_id, nome from core.person
        where connection_id = $1 order by nome limit 500`, [conexao.id]),
    q(`select impressao, status from core.card_import where connection_id = $1`, [conexao.id]),
  ])

  const enviadas = new Map(jaImportadas.map((i) => [i.impressao, i.status]))

  const linhas = compras.map((c) => {
    const { categoria_id, motivo } = sugerirCategoria(c.descricao, historico, categorias)
    return {
      ...c,
      categoria_id,
      motivo,
      ja_importada: enviadas.has(c.impressao),
      status_anterior: enviadas.get(c.impressao) ?? null,
    }
  })

  return {
    conexaoId: conexao.id,
    vencimento,
    total,
    pagamentos,
    linhas,
    categorias,
    contas,
    pessoas,
    resumo: {
      compras: linhas.length,
      novas: linhas.filter((l) => !l.ja_importada).length,
      repetidas: linhas.filter((l) => l.ja_importada).length,
      soma: linhas.filter((l) => !l.ja_importada).reduce((a, l) => a + l.valor, 0),
      semCategoria: linhas.filter((l) => !l.ja_importada && !l.categoria_id).length,
    },
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

// O protocolo nasce PENDING. Consultamos algumas vezes para transformar
// "enviado" em "confirmado" ou "erro" antes de responder para a tela.
async function conferirProtocolo(api, protocolo, tentativas = 4) {
  for (let i = 0; i < tentativas; i++) {
    await dormir(700 * (i + 1))
    try {
      const r = await api.get(`/v1/protocolo/${protocolo}`)
      const status = String(r?.status ?? '').toUpperCase()
      if (status === 'SUCCESS') return { status: 'confirmado' }
      if (status === 'ERROR') return { status: 'erro', erro: r?.mensagem ?? r?.message ?? 'o ERP recusou o lançamento' }
    } catch (e) {
      if (e.status === 404) continue
      return { status: 'enviado', erro: e.message.slice(0, 200) }
    }
  }
  // Sem resposta conclusiva o lançamento fica como enviado. Marcar como erro
  // convidaria a reenviar algo que talvez tenha entrado.
  return { status: 'enviado' }
}

export async function enviarFatura(sessao, { conexaoId, vencimento, itens, contaExternalId, pessoaExternalId }) {
  if (!itens?.length) return { erro: 'Nenhuma linha selecionada.' }
  if (!contaExternalId) return { erro: 'Escolha a conta financeira do cartão.' }
  if (!pessoaExternalId) return { erro: 'Escolha o fornecedor padrão.' }

  const api = clientFor(conexaoId)
  const categorias = new Map(
    (await q(`select id, external_id from core.category where connection_id = $1`, [conexaoId]))
      .map((c) => [c.id, c.external_id]),
  )

  const resultados = []
  for (const item of itens) {
    // A trava é o insert: se a linha já foi enviada, a chave única barra aqui e
    // nada chega ao ERP. Gravar antes de enviar é de propósito.
    const [reserva] = await q(
      `insert into core.card_import
         (tenant_id, connection_id, impressao, data_compra, descricao, valor, categoria_id, criado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (connection_id, impressao) do nothing
       returning id`,
      [
        sessao.tenantId, conexaoId, item.impressao, item.data,
        item.descricao, item.valor, item.categoria_id ?? null, sessao.user?.id ?? null,
      ],
    )
    if (!reserva) {
      resultados.push({ ...item, status: 'repetida' })
      continue
    }

    const idCategoria = item.categoria_id ? categorias.get(item.categoria_id) : null
    const corpo = {
      data_competencia: item.data,
      valor: item.valor,
      descricao: item.descricao.slice(0, 120),
      observacao: `Importado da fatura do cartão com vencimento ${vencimento}`,
      contato: pessoaExternalId,
      conta_financeira: contaExternalId,
      ...(idCategoria ? { rateio: [{ id_categoria: idCategoria, valor: item.valor }] } : {}),
      condicao_pagamento: {
        parcelas: [{
          descricao: item.descricao.slice(0, 120),
          data_vencimento: item.vencimentoISO,
          nota: 'Fatura de cartão importada pelo DriveAzul',
          conta_financeira: contaExternalId,
          detalhe_valor: { valor_bruto: item.valor },
          metodo_pagamento: 'CARTAO_CREDITO',
        }],
      },
    }

    try {
      const r = await api.post('/v1/financeiro/eventos-financeiros/contas-a-pagar', corpo)
      const protocolo = r?.protocolo ?? null
      const conferido = protocolo ? await conferirProtocolo(api, protocolo) : { status: 'enviado' }
      await q(
        `update core.card_import set protocolo = $2, status = $3, erro = $4 where id = $1`,
        [reserva.id, protocolo, conferido.status, conferido.erro ?? null],
      )
      resultados.push({ ...item, status: conferido.status, protocolo, erro: conferido.erro ?? null })
    } catch (e) {
      const erro = e.message.slice(0, 300)
      await q(`update core.card_import set status = 'erro', erro = $2 where id = $1`, [reserva.id, erro])
      resultados.push({ ...item, status: 'erro', erro })
    }
  }

  return {
    resultados,
    resumo: {
      confirmadas: resultados.filter((r) => r.status === 'confirmado').length,
      enviadas: resultados.filter((r) => r.status === 'enviado').length,
      repetidas: resultados.filter((r) => r.status === 'repetida').length,
      erros: resultados.filter((r) => r.status === 'erro').length,
    },
  }
}

export async function historicoImportacoes(sessao, limite = 30) {
  return q(
    `select i.data_compra, i.descricao, i.valor, i.status, i.erro, i.criado_em, c.nome categoria
       from core.card_import i
       left join core.category c on c.id = i.categoria_id
      where i.tenant_id = $1
      order by i.criado_em desc, i.data_compra desc
      limit $2`,
    [sessao.tenantId, limite],
  )
}
