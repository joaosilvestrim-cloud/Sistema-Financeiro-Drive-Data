// Gera um tenant de demonstração com dados sintéticos plausíveis.
//
//   npm run seed            cria/recria o tenant _demo
//   npm run seed -- --drop  só apaga
//
// Serve para dois propósitos. Agora, permite construir e validar os marts e o
// dashboard sem depender da conexão real com a Conta Azul. Depois, vira a base
// do modo demo para mostrar o produto a cliente sem expor dado de ninguém.
//
// Passa pelas mesmas funções de ingestão do worker, então também exercita o
// caminho de verdade.

import { pool, query } from '../src/db.mjs'
import { encrypt } from '../src/crypto.mjs'
import {
  ingestDimension, ingestInstallments, ingestSettlements, loadDimensionMaps, snapshotBalances,
} from '../src/ingest.mjs'

const SLUG = '_demo'
const args = new Set(process.argv.slice(2))

// Trava proposital. Dado sintetico e util para demonstracao comercial e para
// desenvolver sem depender do ERP, mas nao pode entrar por engano num ambiente
// que ja tem dado real. Precisa de --confirmo, e mesmo assim recusa quando
// existe conexao de ERP de verdade no banco.
if (!args.has('--drop') && !args.has('--confirmo')) {
  console.error('Este script cria dados ficticios no tenant _demo.')
  console.error('Se e isso mesmo que voce quer, rode com --confirmo.')
  await pool.end()
  process.exit(1)
}
if (!args.has('--drop')) {
  const { rows } = await query(`select count(*)::int c from core.connection where provider <> 'demo'`)
  if (rows[0].c > 0) {
    console.error(`Existem ${rows[0].c} conexao(oes) reais no banco. Recusando criar dado ficticio ao lado.`)
    await pool.end()
    process.exit(1)
  }
}

// Gerador determinístico. Rodar duas vezes produz o mesmo cenário.
let semente = 42
const rnd = () => {
  semente = (semente * 1103515245 + 12345) % 2147483648
  return semente / 2147483648
}
const entre = (a, b) => a + rnd() * (b - a)
const escolher = (arr) => arr[Math.floor(rnd() * arr.length)]
const iso = (d) => d.toISOString().slice(0, 10)

await query('delete from core.tenant where slug = $1', [SLUG])
if (args.has('--drop')) {
  console.log('tenant _demo removido')
  await pool.end()
  process.exit(0)
}

const { rows: [tenant] } = await query(
  `insert into core.tenant (nome, slug) values ('DriveData Demo', $1) returning *`, [SLUG],
)

const EMPRESAS = [
  { nome: 'DriveData Demo · Matriz', escala: 1.0 },
  { nome: 'DriveData Demo · Filial', escala: 0.45 },
]

const CATEGORIAS_RECEITA = [
  ['Consultoria de dados', 'RECEITA_BRUTA'],
  ['Licenca de software', 'RECEITA_BRUTA'],
  ['Treinamento', 'RECEITA_BRUTA'],
  ['Suporte mensal', 'RECEITA_BRUTA'],
]
const CATEGORIAS_DESPESA = [
  ['Folha de pagamento', 'DESPESAS_ADMINISTRATIVAS'],
  ['Infraestrutura de nuvem', 'CUSTOS_OPERACIONAIS'],
  ['Marketing', 'DESPESAS_COMERCIAIS'],
  ['Aluguel e condominio', 'DESPESAS_ADMINISTRATIVAS'],
  ['Impostos', 'IMPOSTOS'],
  ['Servicos de terceiros', 'CUSTOS_OPERACIONAIS'],
]
const CLIENTES = [
  'Unilever Brasil', 'Cooperativa Coferly', 'TV TEM', 'Grupo A2F', 'Vidah Prime',
  'Referency Corretora', 'Ayumana Saude', 'Prefeitura de Sorocaba', 'EPIC Consultoria',
  'Instituto PMI-SP',
]
const FORNECEDORES = ['AWS', 'Vercel', 'Supabase', 'Contabilidade Silva', 'Imobiliaria Centro', 'Google Ads']

let totalParcelas = 0
let totalBaixas = 0

for (const [idxEmpresa, empresa] of EMPRESAS.entries()) {
  const { rows: [conn] } = await query(
    `insert into core.connection
       (tenant_id, provider, nome, external_company_id, access_token_enc, refresh_token_enc, token_expires_at)
     values ($1, 'demo', $2, $3, $4, $5, now() + interval '1 hour') returning *`,
    [tenant.id, empresa.nome, `demo-${idxEmpresa}`, encrypt('demo'), encrypt('demo')],
  )
  const ctx = { tenantId: tenant.id, connectionId: conn.id }
  const pref = `e${idxEmpresa}`

  await ingestDimension(ctx, 'account', ['nome', 'tipo', 'ativo', 'saldo_inicial'], [
    { external_id: `${pref}-acc-1`, nome: 'Banco Inter', tipo: 'CONTA_CORRENTE', ativo: true, saldo_inicial: 50000, raw: { id: `${pref}-acc-1` } },
    { external_id: `${pref}-acc-2`, nome: 'Caixa interno', tipo: 'CAIXA', ativo: true, saldo_inicial: 3000, raw: { id: `${pref}-acc-2` } },
  ])

  await ingestDimension(ctx, 'category', ['nome', 'tipo', 'entrada_dre'],
    [...CATEGORIAS_RECEITA.map(([nome, dre], i) => ({
      external_id: `${pref}-cat-r${i}`, nome, tipo: 'RECEITA', entrada_dre: dre, raw: { id: `${pref}-cat-r${i}`, nome },
    })),
    ...CATEGORIAS_DESPESA.map(([nome, dre], i) => ({
      external_id: `${pref}-cat-d${i}`, nome, tipo: 'DESPESA', entrada_dre: dre, raw: { id: `${pref}-cat-d${i}`, nome },
    }))],
  )

  await ingestDimension(ctx, 'cost_center', ['codigo', 'nome', 'ativo'], [
    { external_id: `${pref}-cc-1`, codigo: 'OPS', nome: 'Operacoes', ativo: true, raw: { id: `${pref}-cc-1` } },
    { external_id: `${pref}-cc-2`, codigo: 'COM', nome: 'Comercial', ativo: true, raw: { id: `${pref}-cc-2` } },
  ])

  await ingestDimension(ctx, 'person', ['nome', 'documento', 'tipo_pessoa'],
    [...CLIENTES, ...FORNECEDORES].map((nome, i) => ({
      external_id: `${pref}-per-${i}`,
      nome,
      documento: String(10000000000000 + i * 7919 + idxEmpresa).slice(0, 14),
      tipo_pessoa: 'JURIDICA',
      raw: { id: `${pref}-per-${i}`, nome },
    })),
  )

  const maps = await loadDimensionMaps(ctx)

  const hoje = new Date()
  const parcelas = []
  const baixas = []
  let seq = 0

  for (let m = -23; m <= 6; m++) {
    const mesRef = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + m, 1))
    // Crescimento leve ao longo do tempo mais sazonalidade de fim de ano.
    const tendencia = 1 + (m + 23) * 0.012
    const sazonal = 1 + 0.25 * Math.sin(((mesRef.getUTCMonth() + 9) / 12) * 2 * Math.PI)
    const fator = empresa.escala * tendencia * sazonal

    const receitas = Math.round(entre(6, 11))
    for (let i = 0; i < receitas; i++) {
      const dia = Math.floor(entre(1, 28))
      const venc = new Date(Date.UTC(mesRef.getUTCFullYear(), mesRef.getUTCMonth(), dia))
      const total = Math.round(entre(1800, 14000) * fator)
      const catIdx = Math.floor(rnd() * CATEGORIAS_RECEITA.length)
      const clienteIdx = Math.floor(rnd() * CLIENTES.length)
      const passado = venc < hoje

      // Inadimplência sobe um pouco nos títulos mais recentes, como na vida real.
      const pagou = passado && rnd() > (m > -4 ? 0.28 : 0.08)
      const parcial = passado && !pagou && rnd() > 0.75
      const pago = pagou ? total : parcial ? Math.round(total * entre(0.3, 0.7)) : 0

      const id = `${pref}-r-${seq++}`
      parcelas.push(montar({
        id, kind: 'receivable', total, pago, venc, mesRef,
        categoria: `${pref}-cat-r${catIdx}`, pessoa: `${pref}-per-${clienteIdx}`,
        conta: `${pref}-acc-1`, centro: `${pref}-cc-${1 + (i % 2)}`,
        descricao: `${CATEGORIAS_RECEITA[catIdx][0]} · ${CLIENTES[clienteIdx]}`,
      }))

      if (pago > 0) {
        const atraso = pagou ? Math.round(entre(-3, 18)) : Math.round(entre(0, 25))
        const dataPg = new Date(venc.getTime() + atraso * 86400e3)
        if (dataPg <= hoje) {
          baixas.push({
            external_id: `${id}-bx`, installment_external_id: id, data_pagamento: iso(dataPg),
            valor: pago, juros: atraso > 5 ? Math.round(pago * 0.01) : 0, desconto: 0,
            account_external_id: `${pref}-acc-1`, raw: { id: `${id}-bx`, valor: pago },
          })
        }
      }
    }

    const despesas = Math.round(entre(7, 12))
    for (let i = 0; i < despesas; i++) {
      const dia = Math.floor(entre(1, 28))
      const venc = new Date(Date.UTC(mesRef.getUTCFullYear(), mesRef.getUTCMonth(), dia))
      const catIdx = Math.floor(rnd() * CATEGORIAS_DESPESA.length)
      const fixa = catIdx === 0 || catIdx === 3
      const total = Math.round((fixa ? entre(4000, 9000) : entre(400, 5200)) * fator)
      const fornIdx = Math.floor(rnd() * FORNECEDORES.length)
      const passado = venc < hoje
      const pago = passado && rnd() > 0.05 ? total : 0

      const id = `${pref}-p-${seq++}`
      parcelas.push(montar({
        id, kind: 'payable', total, pago, venc, mesRef,
        categoria: `${pref}-cat-d${catIdx}`, pessoa: `${pref}-per-${CLIENTES.length + fornIdx}`,
        conta: `${pref}-acc-1`, centro: `${pref}-cc-${1 + (i % 2)}`,
        descricao: `${CATEGORIAS_DESPESA[catIdx][0]} · ${FORNECEDORES[fornIdx]}`,
      }))

      if (pago > 0) {
        const dataPg = new Date(venc.getTime() + Math.round(entre(-2, 4)) * 86400e3)
        if (dataPg <= hoje) {
          baixas.push({
            external_id: `${id}-bx`, installment_external_id: id, data_pagamento: iso(dataPg),
            valor: pago, juros: 0, desconto: 0,
            account_external_id: `${pref}-acc-1`, raw: { id: `${id}-bx`, valor: pago },
          })
        }
      }
    }
  }

  // Em lotes, como o worker faz janela a janela.
  for (let i = 0; i < parcelas.length; i += 200) {
    await ingestInstallments(ctx, maps, parcelas.slice(i, i + 200))
  }
  for (let i = 0; i < baixas.length; i += 200) {
    await ingestSettlements(ctx, maps, baixas.slice(i, i + 200))
  }

  // Saldo coerente com o caixa realizado, para o runway não sair absurdo.
  const { rows: [caixa] } = await query(
    `select coalesce(sum(liquido), 0) as liquido from mart.cashflow_realized_daily where connection_id = $1`,
    [conn.id],
  )
  const { rows: contas } = await query(
    'select id, external_id from core.account where connection_id = $1 order by external_id', [conn.id],
  )
  const saldoTotal = 53000 + Number(caixa.liquido)
  await snapshotBalances(ctx, [
    { account_id: contas[0].id, saldo: Math.round(saldoTotal * 0.92) },
    { account_id: contas[1].id, saldo: Math.round(saldoTotal * 0.08) },
  ])

  await query('update core.connection set last_sync_at = now() where id = $1', [conn.id])
  totalParcelas += parcelas.length
  totalBaixas += baixas.length
  console.log(`${empresa.nome}: ${parcelas.length} parcelas, ${baixas.length} baixas`)
}

function montar({ id, kind, total, pago, venc, mesRef, categoria, pessoa, conta, centro, descricao }) {
  const raw = {
    id, descricao, data_vencimento: iso(venc), data_competencia: iso(mesRef),
    status: pago >= total ? (kind === 'receivable' ? 'RECEIVED' : 'PAID') : 'OPEN',
    status_traduzido: pago >= total
      ? (kind === 'receivable' ? 'RECEBIDO' : 'PAGO')
      : pago > 0 ? 'RECEBIDO_PARCIAL' : (venc < new Date() ? 'ATRASADO' : 'EM_ABERTO'),
    total, pago, nao_pago: total - pago,
  }
  return {
    external_id: id, event_external_id: `${id}-ev`, kind,
    descricao, data_vencimento: raw.data_vencimento, data_competencia: raw.data_competencia,
    status: raw.status, status_traduzido: raw.status_traduzido,
    total, pago, nao_pago: total - pago,
    person_external_id: pessoa, account_external_id: conta,
    category_external_id: categoria, cost_center_external_id: centro,
    data_criacao: raw.data_competencia, data_alteracao: new Date().toISOString(), raw,
  }
}

console.log(`\ntenant _demo pronto: ${totalParcelas} parcelas, ${totalBaixas} baixas, ${EMPRESAS.length} empresas`)
await pool.end()
