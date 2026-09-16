import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { q, q1 } from './db.js'
import { encrypt, decrypt } from '../src/crypto.mjs'

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

// ------------------------------------------------------- credenciais

// Credencial por tenant, criada pelo próprio cliente na tela de conexões.
// O segredo só existe em claro no retorno desta função, uma vez. Depois,
// cifrado no banco e comparado em tempo constante na rota.
export async function criarCredencial(sessao, rotulo) {
  const idPublico = randomBytes(12).toString('hex')
  const segredo = 'whsec_' + randomBytes(24).toString('hex')
  await q(
    `insert into core.webhook_credencial (tenant_id, id_publico, segredo_cifrado, rotulo)
     values ($1, $2, $3, $4)`,
    [sessao.tenantId, idPublico, encrypt(segredo), (rotulo || 'Conexão bancária').slice(0, 60)],
  )
  return { idPublico, segredo }
}

export async function revogarCredencial(sessao, id) {
  await q(
    `update core.webhook_credencial set revogado_em = now()
      where id = $1 and tenant_id = $2 and revogado_em is null`,
    [id, sessao.tenantId],
  )
}

export async function credenciaisDoTenant(sessao) {
  return q(
    `select id, id_publico, rotulo, criado_em, ultimo_uso_em, revogado_em
       from core.webhook_credencial
      where tenant_id = $1
      order by criado_em desc`,
    [sessao.tenantId],
  )
}

// A rota chama com o id que veio na URL e o segredo que veio no cabeçalho.
// Devolve o tenant quando os dois batem, null quando não. A comparação é em
// tempo constante e acontece mesmo com credencial inexistente, para o tempo
// de resposta não contar a ninguém se um id_publico existe.
export async function autenticarCredencial(idPublico, segredoEnviado) {
  const c = await q1(
    `select id, tenant_id, segredo_cifrado from core.webhook_credencial
      where id_publico = $1 and revogado_em is null`,
    [idPublico ?? ''],
  )
  const esperado = c ? decrypt(c.segredo_cifrado) : 'whsec_' + '0'.repeat(48)
  const enviado = String(segredoEnviado ?? '')
  let diff = enviado.length === esperado.length ? 0 : 1
  const n = Math.max(enviado.length, esperado.length)
  for (let i = 0; i < n; i++) {
    diff |= (enviado.charCodeAt(i) || 0) ^ (esperado.charCodeAt(i) || 0)
  }
  if (diff !== 0 || !c) return null
  await q(`update core.webhook_credencial set ultimo_uso_em = now() where id = $1`, [c.id])
  return { tenantId: c.tenant_id, credencialId: c.id }
}

// O caminho inteiro da ingestão: dedupe, bruto, atribuição, normalização.
// Devolve o que a rota responde ao banco. Com credencial, o tenant vem dela
// e o CNPJ do payload vira conferência; sem credencial (rota antiga com env
// var), o CNPJ segue sendo o de-para.
export async function receberLiquidacao({ fonte, corpoBruto, corpo, tenantId: tenantDaCredencial = null }) {
  const hash = hashDoCorpo(corpoBruto)
  const lida = lerLiquidacao(corpo)
  const tenantId = tenantDaCredencial ?? await tenantDoCnpj(lida.cnpj)

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
