// Teste de ponta a ponta da ingestão, sem depender da API da Conta Azul.
//
// Usa um provider falso com payload no mesmo formato do real e verifica o que
// mais importa e mais quebra: idempotência por hash, versionamento SCD2 e
// resolução das dimensões por (connection_id, external_id).
//
// Cria um tenant _selftest e apaga tudo no fim.

import { pool, query } from '../src/db.mjs'
import { encrypt, decrypt } from '../src/crypto.mjs'
import {
  ingestDimension, ingestInstallments, ingestSettlements, loadDimensionMaps,
} from '../src/ingest.mjs'

let falhas = 0
const checar = (nome, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${nome}${extra ? '  ' + extra : ''}`)
  if (!ok) falhas++
}
const contar = async (sql, params) => Number((await query(sql, params)).rows[0].c)

// ---------------------------------------------------------------- cripto
const segredo = 'refresh-token-de-mentira-123'
checar('cripto ida e volta', decrypt(encrypt(segredo)) === segredo)
checar('cifra nao vaza o valor', !encrypt(segredo).includes(segredo))

// ------------------------------------------------------------ preparação
const { rows: [tenant] } = await query(
  `insert into core.tenant (nome, slug) values ('Selftest', '_selftest')
   on conflict (slug) do update set nome = excluded.nome returning *`,
)
await query(`delete from core.connection where tenant_id = $1`, [tenant.id])
const { rows: [conn] } = await query(
  `insert into core.connection (tenant_id, provider, nome, access_token_enc, refresh_token_enc, token_expires_at)
   values ($1, 'fake', 'Empresa de teste', $2, $3, now() + interval '1 hour') returning *`,
  [tenant.id, encrypt('a'), encrypt('r')],
)
const ctx = { tenantId: tenant.id, connectionId: conn.id }

// ------------------------------------------------------------ dimensões
await ingestDimension(ctx, 'account', ['nome', 'tipo', 'ativo'], [
  { external_id: 'acc-1', nome: 'Banco Principal', tipo: 'CONTA_CORRENTE', ativo: true, raw: { id: 'acc-1', nome: 'Banco Principal' } },
])
await ingestDimension(ctx, 'category', ['nome', 'tipo', 'entrada_dre'], [
  { external_id: 'cat-1', nome: 'Consultoria', tipo: 'RECEITA', entrada_dre: 'RECEITA_BRUTA', raw: { id: 'cat-1', nome: 'Consultoria' } },
])
await ingestDimension(ctx, 'person', ['nome', 'documento'], [
  { external_id: 'per-1', nome: 'Cliente Teste', documento: '12345678000199', raw: { id: 'per-1', nome: 'Cliente Teste' } },
])

const maps = await loadDimensionMaps(ctx)
checar('dimensoes resolvidas', maps.account.size === 1 && maps.category.size === 1 && maps.person.size === 1)

// Reingestão da mesma dimensão não pode duplicar linha.
await ingestDimension(ctx, 'account', ['nome', 'tipo', 'ativo'], [
  { external_id: 'acc-1', nome: 'Banco Principal', tipo: 'CONTA_CORRENTE', ativo: true, raw: { id: 'acc-1', nome: 'Banco Principal' } },
])
checar('dimensao nao duplica', await contar('select count(*) c from core.account where connection_id = $1', [conn.id]) === 1)

// ------------------------------------------------------------- parcelas
const parcela = (id, over = {}) => {
  const raw = {
    id, descricao: `Parcela ${id}`, data_vencimento: '2026-09-15', data_competencia: '2026-09-01',
    status: 'EM_ABERTO', status_traduzido: 'EM_ABERTO', total: 1000, pago: 0, nao_pago: 1000,
    data_criacao: '2026-09-01T10:00:00Z', data_alteracao: '2026-09-01T10:00:00Z',
    categorias: [{ id: 'cat-1', nome: 'Consultoria' }], id_cliente: 'per-1', id_conta_financeira: 'acc-1',
    ...over,
  }
  return {
    external_id: id, event_external_id: `ev-${id}`, kind: 'receivable',
    descricao: raw.descricao, data_vencimento: raw.data_vencimento, data_competencia: raw.data_competencia,
    status: raw.status, status_traduzido: raw.status_traduzido,
    total: raw.total, pago: raw.pago, nao_pago: raw.nao_pago,
    person_external_id: 'per-1', account_external_id: 'acc-1', category_external_id: 'cat-1',
    cost_center_external_id: null, data_criacao: raw.data_criacao, data_alteracao: raw.data_alteracao, raw,
  }
}

const r1 = await ingestInstallments(ctx, maps, [parcela('p-1'), parcela('p-2')])
checar('primeira carga insere', r1.novos === 2 && r1.alterados === 0, JSON.stringify(r1))
checar('uma versao por parcela',
  await contar('select count(*) c from core.installment_version where connection_id = $1', [conn.id]) === 2)

const r2 = await ingestInstallments(ctx, maps, [parcela('p-1'), parcela('p-2')])
checar('reingestao igual nao versiona', r2.inalterados === 2 && r2.alterados === 0, JSON.stringify(r2))
checar('continua com duas versoes',
  await contar('select count(*) c from core.installment_version where connection_id = $1', [conn.id]) === 2)

const r3 = await ingestInstallments(ctx, maps, [
  parcela('p-1', { pago: 1000, nao_pago: 0, status: 'RECEBIDO', status_traduzido: 'RECEBIDO', data_alteracao: '2026-09-20T09:00:00Z' }),
])
checar('mudanca gera versao nova', r3.alterados === 1, JSON.stringify(r3))
checar('agora sao tres versoes',
  await contar('select count(*) c from core.installment_version where connection_id = $1', [conn.id]) === 3)
checar('so uma versao aberta por parcela',
  await contar(`select count(*) c from core.installment_version v
                 join core.installment i on i.id = v.installment_id
                where i.external_id = 'p-1' and v.connection_id = $1 and v.valid_to is null`, [conn.id]) === 1)

const { rows: [hist] } = await query(
  `select v.total, v.pago, v.status from core.installment_version v
     join core.installment i on i.id = v.installment_id
    where i.external_id = 'p-1' and v.valid_to is not null`,
)
checar('versao antiga guarda o estado anterior', hist.pago === 0 && hist.status === 'EM_ABERTO',
  `pago=${hist.pago} status=${hist.status}`)

const { rows: [atual] } = await query(
  `select pago, status, person_id, account_id, category_id from core.installment
    where connection_id = $1 and external_id = 'p-1'`, [conn.id])
checar('parcela atual reflete a mudanca', atual.pago === 1000 && atual.status === 'RECEBIDO')
checar('chaves das dimensoes ligadas', !!atual.person_id && !!atual.account_id && !!atual.category_id)

// -------------------------------------------------------------- baixas
await ingestSettlements(ctx, maps, [{
  external_id: 'bx-1', installment_external_id: 'p-1', data_pagamento: '2026-09-20',
  valor: 1000, juros: 0, desconto: 0, account_external_id: 'acc-1',
  raw: { id: 'bx-1', valor: 1000 },
}])
const { rows: [baixa] } = await query(
  `select s.valor, i.external_id from core.settlement s
     join core.installment i on i.id = s.installment_id where s.connection_id = $1`, [conn.id])
checar('baixa ligada na parcela certa', baixa?.external_id === 'p-1' && baixa.valor === 1000)

// ----------------------------------------------------------------- raw
const raws = await contar('select count(*) c from raw.api_payload where connection_id = $1', [conn.id])
checar('raw guarda versao por hash, sem duplicar', raws === 7, `${raws} payloads`)

// ------------------------------------------------------------- limpeza
await query('delete from core.tenant where id = $1', [tenant.id])
checar('limpeza removeu tudo em cascata',
  await contar('select count(*) c from core.installment where connection_id = $1', [conn.id]) === 0)

await pool.end()
console.log(falhas ? `\n${falhas} verificacao(oes) falhou(aram).` : '\nTudo passou.')
process.exit(falhas ? 1 : 0)
