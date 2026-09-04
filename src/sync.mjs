import { query } from './db.mjs'
import { config } from './config.mjs'
import { clientFor, getConnection } from './connections.mjs'
import { contaAzulProvider } from './providers/contaazul.mjs'
import { monthWindows, dataHora } from './contaazul.mjs'
import {
  ingestDimension, ingestInstallments, ingestSettlements, loadDimensionMaps,
  snapshotBalances, getWatermark, setWatermark,
} from './ingest.mjs'

// Sobreposição na janela do CDC. Evita perder um evento salvo no exato segundo
// em que o watermark foi gravado.
const OVERLAP_MIN = 10

const providers = {
  contaazul: (connectionId) => contaAzulProvider(clientFor(connectionId)),
}

async function abrirRun(connectionId, kind) {
  const { rows } = await query(
    `insert into core.sync_run (connection_id, kind) values ($1, $2) returning id`,
    [connectionId, kind],
  )
  return rows[0].id
}

async function fecharRun(id, { status, requests, items, error, detail }) {
  await query(
    `update core.sync_run
        set status = $2, finished_at = now(), requests = $3, items = $4,
            error = $5, detail = $6
      where id = $1`,
    [id, status, requests, items, error?.slice(0, 2000) ?? null, detail ?? {}],
  )
}

export async function sincronizarDimensoes(ctx, api) {
  const [contas, categorias, dre, centros, pessoas] = await Promise.all([
    api.listAccounts(), api.listCategories(), api.listDreCategories(),
    api.listCostCenters(), api.listPeople(),
  ])
  await ingestDimension(ctx, 'account', ['nome', 'tipo', 'ativo', 'saldo_inicial'], contas)
  await ingestDimension(ctx, 'category',
    ['nome', 'tipo', 'parent_external_id', 'entrada_dre', 'considera_custo_dre'], categorias)
  await ingestDimension(ctx, 'dre_category', ['nome', 'ordem'], dre)
  await ingestDimension(ctx, 'cost_center', ['codigo', 'nome', 'ativo'], centros)
  await ingestDimension(ctx, 'person', ['nome', 'documento', 'tipo_pessoa', 'perfis', 'email'], pessoas)
  return { contas: contas.length, categorias: categorias.length, centros: centros.length, pessoas: pessoas.length }
}

// Busca as baixas das parcelas que têm valor pago. É o que dá o regime de caixa.
export async function sincronizarBaixas(ctx, api, maps, parcelas) {
  // Quando a parcela veio pelo detalhe, as baixas já estão no payload e não
  // custam uma requisição a mais. Isso corta a maior parte das chamadas do
  // caminho incremental.
  const comPagamento = parcelas.filter((p) => (p.pago ?? 0) > 0 || p.raw?.baixas?.length)
  let total = 0
  for (const p of comPagamento) {
    try {
      const baixas = await api.listSettlements(p.external_id, p.raw)
      await ingestSettlements(ctx, maps, baixas)
      total += baixas.length
    } catch (e) {
      if (e.status !== 404) throw e
    }
  }
  return total
}

export async function fotografarSaldos(ctx, api) {
  const { rows } = await query(
    'select id, external_id from core.account where connection_id = $1 and coalesce(ativo, true)',
    [ctx.connectionId],
  )
  const saldos = []
  for (const conta of rows) {
    try {
      saldos.push({ account_id: conta.id, saldo: await api.getBalance(conta.external_id) ?? 0 })
    } catch { /* conta sem saldo exposto não interrompe o sync */ }
  }
  return snapshotBalances(ctx, saldos)
}

// Sincroniza uma conexão.
//
// `orcamentoMs` existe porque isto roda em função serverless, que morre em
// segundos. A auditoria mediu 213 segundos numa rodada incremental da DriveData
// contra um teto de 60. Sem orçamento, a falha seria a pior possível: toda
// rodada morreria no meio, o watermark nunca avançaria, a próxima refaria o
// mesmo trabalho, e a conexão nunca mais sincronizaria.
//
// Quando o tempo acaba, o que falta processar fica em core.sync_cursor e a
// rodada devolve `incompleto`. A próxima chamada retoma da mesma lista, sem
// perguntar de novo à API o que mudou.
export async function syncConnection(connectionId, kind = 'incremental', { orcamentoMs = null } = {}) {
  const limite = orcamentoMs ? Date.now() + orcamentoMs : null
  const semTempo = () => limite !== null && Date.now() > limite
  const conn = await getConnection(connectionId)
  const ctx = { tenantId: conn.tenant_id, connectionId }
  const montarProvider = providers[conn.provider]
  if (!montarProvider) throw new Error(`provider ${conn.provider} nao implementado`)

  const api = montarProvider(connectionId)
  const runId = await abrirRun(connectionId, kind)
  const inicio = new Date()
  const detail = {}
  let itens = 0

  try {
    // O cursor é lido antes de qualquer chamada de API. Numa rodada que só está
    // retomando a fila, sincronizar dimensão de novo é trabalho jogado fora:
    // conta, categoria e pessoa não mudam no meio de uma janela. Nas fatias
    // curtas esse custo fixo chegava a dominar a rodada inteira.
    const retomada = kind === 'backfill' ? null : await lerCursor(connectionId)

    if (retomada) detail.dimensoes = 'puladas, rodada de retomada'
    else detail.dimensoes = await sincronizarDimensoes(ctx, api)
    const maps = await loadDimensionMaps(ctx)

    if (kind === 'backfill') {
      const janelas = monthWindows(config.monthsBack, config.monthsForward)
      detail.janelas = janelas.length
      for (const tipo of ['receivable', 'payable']) {
        let doTipo = 0
        for (const [de, ate] of janelas) {
          const parcelas = await api.listInstallments({ kind: tipo, dueFrom: de, dueTo: ate })
          const r = await ingestInstallments(ctx, maps, parcelas)
          await sincronizarBaixas(ctx, api, maps, r.mudaram)
          doTipo += parcelas.length
        }
        detail[tipo] = doTipo
        itens += doTipo
      }
    } else {
      // Incremental e reconcile compartilham o caminho: descobrir os eventos
      // tocados no período e rebuscar cada um por inteiro. A API só informa que
      // o evento mudou, nunca qual campo mudou.
      // Se sobrou lista da rodada anterior, é dela que se continua. Perguntar de
      // novo à API o que mudou traria uma resposta diferente e o pedaço já
      // processado voltaria para a fila.
      const desde = retomada
        ? new Date(retomada.janela_inicio)
        : kind === 'reconcile'
          ? new Date(Date.now() - 90 * 86400e3)
          : new Date(new Date(await getWatermark(connectionId, 'eventos') ?? inicio).getTime() - OVERLAP_MIN * 60_000)
      const ate = retomada ? new Date(retomada.janela_fim) : inicio

      detail.desde = desde.toISOString()
      detail.retomada = !!retomada

      // A API recusa data com fuso ou milissegundo neste endpoint.
      let pendentes = retomada
        ? retomada.pendentes
        : await api.listChangedEventIds({ from: dataHora(desde), to: dataHora(ate) })
      detail.eventos_alterados = pendentes.length + (retomada?.processados ?? 0)

      let processados = retomada?.processados ?? 0
      while (pendentes.length) {
        if (semTempo()) break
        const eventId = pendentes[0]
        const parcelas = await api.listInstallmentsByEvent(eventId)
        const r = await ingestInstallments(ctx, maps, parcelas)
        await sincronizarBaixas(ctx, api, maps, r.mudaram)
        itens += parcelas.length
        detail.novos = (detail.novos ?? 0) + r.novos
        detail.alterados = (detail.alterados ?? 0) + r.alterados
        detail.inalterados = (detail.inalterados ?? 0) + r.inalterados
        pendentes = pendentes.slice(1)
        processados += 1
      }

      if (pendentes.length) {
        // Acabou o tempo, não o trabalho. O watermark fica onde está.
        await salvarCursor(connectionId, desde, ate, pendentes, processados)
        detail.faltam = pendentes.length
        await fecharRun(runId, {
          status: 'ok', requests: api._client?.stats?.requests ?? 0, items: itens, detail,
        })
        return { runId, itens, detail, incompleto: true }
      }
      await limparCursor(connectionId)
    }

    detail.saldos = (await fotografarSaldos(ctx, api)).total

    // Watermark só avança depois que tudo entrou. Se cair no meio, a próxima
    // rodada refaz o período e o hash evita gravar versão duplicada.
    await setWatermark(connectionId, 'eventos', inicio.toISOString())
    await query(
      `update core.connection set last_sync_at = now(), last_error = null, updated_at = now() where id = $1`,
      [connectionId],
    )

    const stats = api._client?.stats
    await fecharRun(runId, {
      status: 'ok', requests: stats?.requests ?? 0, items: itens, detail,
    })
    return { runId, itens, detail }
  } catch (e) {
    await fecharRun(runId, { status: 'error', requests: 0, items: itens, error: e.message, detail })
    await query(
      'update core.connection set last_error = $2, updated_at = now() where id = $1',
      [connectionId, e.message.slice(0, 500)],
    )
    throw e
  }
}

// ------------------------------------------------- cursor do incremental

async function lerCursor(connectionId) {
  const { rows } = await query(
    `select janela_inicio, janela_fim, pendentes, processados
       from core.sync_cursor where connection_id = $1`,
    [connectionId],
  )
  return rows[0] ?? null
}

const salvarCursor = (connectionId, inicio, fim, pendentes, processados) => query(
  `insert into core.sync_cursor
     (connection_id, janela_inicio, janela_fim, pendentes, processados)
   values ($1, $2, $3, $4, $5)
   on conflict (connection_id) do update
     set janela_inicio = excluded.janela_inicio, janela_fim = excluded.janela_fim,
         pendentes = excluded.pendentes, processados = excluded.processados,
         atualizado_em = now()`,
  [connectionId, inicio, fim, pendentes, processados],
)

const limparCursor = (connectionId) =>
  query('delete from core.sync_cursor where connection_id = $1', [connectionId])

// Rodada que ficou aberta porque a função foi morta no meio. Sem isto a tela de
// Conexões mostraria "rodando" para sempre e ninguém saberia que algo caiu.
export async function fecharRodadasOrfas(minutos = 20) {
  const { rows } = await query(
    `update core.sync_run
        set status = 'error', finished_at = now(),
            error = 'rodada interrompida, provavelmente por limite de tempo da funcao'
      where status = 'running' and started_at < now() - make_interval(mins => $1)
      returning id`,
    [minutos],
  )
  return rows.length
}
