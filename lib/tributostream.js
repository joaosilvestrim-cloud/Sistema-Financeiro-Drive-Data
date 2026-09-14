import 'server-only'
import { createHash } from 'node:crypto'
import { q, q1 } from './db.js'

// TributoStream: a parte do módulo que a rota do webhook chama.
//
// O contrato com a rota é curto. Ela valida o segredo, lê o corpo e entrega
// aqui. Este arquivo grava o bruto, tenta atribuir o tenant e, quando o
// payload dá, já normaliza a liquidação. Tudo o que for lento ou incerto
// (casar com título, casar com nota, calcular divergência) fica para o
// processamento assíncrono, porque o banco que chama o webhook tem timeout
// curto e reenvia o que falhou.
//
// Formatos de payload variam por adquirente. A leitura aqui é best-effort
// sobre os nomes mais comuns; o que não for entendido fica na raw intacto e
// vira caso de reprocessamento, nunca de perda.

/**
 * @typedef {Object} LiquidacaoLida
 * @property {string|null} idRepasse   chave transacional de segregação
 * @property {string|null} cnpj        CNPJ do recebedor, só dígitos
 * @property {number|null} valorBruto
 * @property {number|null} valorLiquido
 * @property {number|null} valorRetido
 * @property {string|null} tipoSplit   'inteligente' | 'simplificado' | null
 * @property {string|null} meio        'pix' | 'boleto' | 'cartao' | ...
 * @property {string|null} liquidadoEm ISO
 */

export function hashDoCorpo(corpoBruto) {
  return createHash('sha256').update(corpoBruto).digest('hex')
}

// Lê os campos que interessam, tolerando os nomes que cada adquirente usa.
// Devolver null é resposta válida: o bruto fica guardado do mesmo jeito.
/** @returns {LiquidacaoLida} */
export function lerLiquidacao(corpo) {
  const pega = (...chaves) => {
    for (const c of chaves) {
      const v = c.split('.').reduce((o, k) => o?.[k], corpo)
      if (v !== undefined && v !== null && v !== '') return v
    }
    return null
  }
  const num = (v) => {
    if (v === null) return null
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }

  const cnpjCru = pega('recebedor.cnpj', 'recebedor.documento', 'cnpj_recebedor', 'cnpj')
  const tipoCru = String(pega('tipo_split', 'split.tipo', 'tipoSplit') ?? '').toLowerCase()

  return {
    idRepasse: pega('idRepasse', 'id_repasse', 'repasse.id', 'splitId'),
    cnpj: cnpjCru ? String(cnpjCru).replace(/\D/g, '') : null,
    valorBruto: num(pega('valor_bruto', 'valorBruto', 'valores.bruto', 'amount')),
    valorLiquido: num(pega('valor_liquido', 'valorLiquido', 'valores.liquido', 'netAmount')),
    valorRetido: num(pega('valor_retido', 'valorRetido', 'valores.retido', 'taxAmount')),
    tipoSplit: ['inteligente', 'simplificado'].includes(tipoCru) ? tipoCru : null,
    meio: pega('meio_pagamento', 'meioPagamento', 'metodo', 'paymentMethod'),
    liquidadoEm: pega('liquidado_em', 'liquidadoEm', 'data_liquidacao', 'settledAt'),
  }
}

// O tenant sai do CNPJ do recebedor. O cadastro fiscal já guarda o CNPJ de
// cada emitente por tenant, então ele é o de-para natural. Não achou, o aviso
// entra órfão e a tela de pendências cobra alguém de olhar.
async function tenantDoCnpj(cnpj) {
  if (!cnpj) return null
  const r = await q1(
    `select tenant_id from core.fiscal_emitente where cnpj = $1 limit 1`,
    [cnpj],
  )
  return r?.tenant_id ?? null
}

// O caminho inteiro da ingestão: dedupe, bruto, atribuição, normalização.
// Devolve o que a rota responde ao banco.
export async function receberLiquidacao({ fonte, corpoBruto, corpo }) {
  const hash = hashDoCorpo(corpoBruto)
  const lida = lerLiquidacao(corpo)
  const tenantId = await tenantDoCnpj(lida.cnpj)

  // O bruto entra primeiro e entra sempre. on conflict devolve vazio quando o
  // banco reenviou o mesmo payload, e reenvio ganha 200 sem efeito nenhum.
  const bruto = await q1(
    `insert into raw.split_webhook (tenant_id, fonte, id_repasse, hash, payload)
     values ($1, $2, $3, $4, $5)
     on conflict (fonte, hash) do nothing
     returning id`,
    [tenantId, fonte, lida.idRepasse, hash, JSON.stringify(corpo)],
  )
  if (!bruto) return { ok: true, duplicado: true }

  // Normaliza já, mas só quando o payload tem o mínimo. Sem idRepasse, sem
  // tenant ou sem os três valores fechando, o bruto fica marcado com o motivo
  // e o reprocessamento resolve depois, com calma e fora do timeout.
  const completo = tenantId && lida.idRepasse
    && lida.valorBruto !== null && lida.valorLiquido !== null && lida.valorRetido !== null
    && Math.abs(lida.valorBruto - (lida.valorLiquido + lida.valorRetido)) < 0.005

  if (!completo) {
    const motivo = !tenantId ? 'tenant nao identificado pelo cnpj'
      : !lida.idRepasse ? 'payload sem idRepasse'
      : 'valores ausentes ou que nao fecham'
    await q(`update raw.split_webhook set erro = $2 where id = $1`, [bruto.id, motivo])
    return { ok: true, id: bruto.id, pendente: motivo }
  }

  await q(
    `insert into core.split_liquidacao
       (tenant_id, raw_id, id_repasse, meio_pagamento,
        valor_bruto, valor_liquido, valor_retido, tipo_split, liquidado_em)
     values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now()))
     on conflict (tenant_id, id_repasse) do update set
       raw_id = excluded.raw_id,
       valor_bruto = excluded.valor_bruto,
       valor_liquido = excluded.valor_liquido,
       valor_retido = excluded.valor_retido,
       tipo_split = excluded.tipo_split,
       atualizado_em = now()`,
    [tenantId, bruto.id, lida.idRepasse, lida.meio,
     lida.valorBruto, lida.valorLiquido, lida.valorRetido,
     lida.tipoSplit ?? 'desconhecido', lida.liquidadoEm],
  )
  await q(`update raw.split_webhook set processado_em = now() where id = $1`, [bruto.id])

  return { ok: true, id: bruto.id }
}
