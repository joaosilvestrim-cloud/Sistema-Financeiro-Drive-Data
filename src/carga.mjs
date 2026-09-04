import { query } from './db.mjs'
import { config } from './config.mjs'
import { clientFor } from './connections.mjs'
import { contaAzulProvider } from './providers/contaazul.mjs'
import { monthWindows } from './contaazul.mjs'
import {
  ingestInstallments, loadDimensionMaps, setWatermark,
} from './ingest.mjs'
import { sincronizarDimensoes, sincronizarBaixas, fotografarSaldos } from './sync.mjs'

// Carga inicial retomável.
//
// O backfill do sync.mjs faz tudo numa chamada só, o que serve para o worker e
// não serve para o navegador: são 36 meses de janela vezes dois tipos de
// parcela, e função serverless morre antes. Aqui o trabalho é fatiado. Cada
// chamada avança o que der dentro do orçamento de tempo, grava onde parou e
// devolve o progresso. A tela pergunta de novo.
//
// O efeito colateral bom é que a pessoa vê barra de progresso em vez de
// ampulheta, e é exatamente nesse minuto que ela decide se o produto é sério.

const providers = {
  contaazul: (connectionId) => contaAzulProvider(clientFor(connectionId)),
}

// Quanto tempo cada chamada trabalha antes de devolver o controle. Fica abaixo
// do limite da função de propósito: melhor voltar cedo e ser chamado de novo do
// que ser morto no meio de uma janela.
const ORCAMENTO_MS = 40_000

// Enquanto a trava vale, outra aba aberta na mesma tela não dispara a mesma
// janela em paralelo. Passa do prazo se a função morrer no meio, e aí a próxima
// chamada retoma. O ingest é idempotente, então repetir uma janela não duplica.
const TRAVA_MIN = 3

export async function criarCarga(tenantId, connectionId) {
  const { rows } = await query(
    `insert into core.onboarding_job (tenant_id, connection_id)
     values ($1, $2)
     on conflict (connection_id) do nothing
     returning id`,
    [tenantId, connectionId],
  )
  return rows[0] ?? null
}

export async function progressoCarga(connectionId) {
  const { rows } = await query(
    `select status, etapa, janela, janelas_total, itens, erro, atualizado_em
       from core.onboarding_job where connection_id = $1`,
    [connectionId],
  )
  return rows[0] ? comPercentual(rows[0]) : null
}

// As etapas não custam o mesmo, então uma régua linear mentiria. Estes pesos
// são grosseiros de propósito: o que importa é a barra andar sem parar e nunca
// voltar atrás.
const PESO = { dimensoes: 0, receivable: 0.08, payable: 0.52, saldos: 0.96, fim: 1 }

function comPercentual(job) {
  const base = PESO[job.etapa] ?? 0
  const proximo = job.etapa === 'receivable' ? PESO.payable
    : job.etapa === 'payable' ? PESO.saldos
    : job.etapa === 'dimensoes' ? PESO.receivable
    : 1
  const dentro = job.janelas_total > 0 ? Math.min(1, job.janela / job.janelas_total) : 0
  const fracao = job.status === 'concluido' ? 1 : base + (proximo - base) * dentro
  return {
    ...job,
    percentual: Math.round(fracao * 100),
    rotulo: ROTULO[job.etapa] ?? job.etapa,
  }
}

const ROTULO = {
  dimensoes: 'Trazendo contas, categorias e pessoas',
  receivable: 'Trazendo o que você tem a receber',
  payable: 'Trazendo o que você tem a pagar',
  saldos: 'Fotografando o saldo das contas',
  fim: 'Pronto',
}

// Avança um pedaço da carga. Devolve o progresso, sempre, inclusive em erro:
// quem chamou é uma tela, e tela precisa de algo para mostrar.
export async function avancarCarga(connectionId, orcamentoMs = ORCAMENTO_MS) {
  const limite = Date.now() + orcamentoMs

  // Pega a trava e o estado na mesma ida ao banco. Se outra chamada estiver
  // trabalhando, sai sem fazer nada e devolve o progresso de agora.
  const { rows: [job] } = await query(
    `update core.onboarding_job
        set status = 'rodando',
            lease_ate = now() + make_interval(mins => $2),
            atualizado_em = now()
      where connection_id = $1
        and status in ('pendente', 'rodando', 'erro')
        and (lease_ate is null or lease_ate < now())
      returning *`,
    [connectionId, TRAVA_MIN],
  )
  if (!job) return progressoCarga(connectionId)

  const { rows: [conn] } = await query(
    `select tenant_id, provider from core.connection where id = $1`, [connectionId],
  )
  const montar = providers[conn?.provider]
  if (!montar) return finalizarErro(connectionId, `provider ${conn?.provider} nao implementado`)

  const ctx = { tenantId: conn.tenant_id, connectionId }
  const api = montar(connectionId)
  const janelas = monthWindows(config.monthsBack, config.monthsForward)

  let { etapa, janela, itens } = job

  try {
    if (etapa === 'dimensoes') {
      await sincronizarDimensoes(ctx, api)
      etapa = 'receivable'
      janela = 0
      await salvar(connectionId, { etapa, janela, itens, janelas_total: janelas.length })
    }

    const maps = await loadDimensionMaps(ctx)

    for (const tipo of ['receivable', 'payable']) {
      if (etapa !== tipo) continue
      while (janela < janelas.length) {
        if (Date.now() > limite) return await soltar(connectionId, { etapa, janela, itens })
        const [de, ate] = janelas[janela]
        const parcelas = await api.listInstallments({ kind: tipo, dueFrom: de, dueTo: ate })
        const r = await ingestInstallments(ctx, maps, parcelas)
        await sincronizarBaixas(ctx, api, maps, r.mudaram)
        itens += parcelas.length
        janela += 1
        await salvar(connectionId, { etapa, janela, itens, janelas_total: janelas.length })
      }
      etapa = tipo === 'receivable' ? 'payable' : 'saldos'
      janela = 0
      await salvar(connectionId, { etapa, janela, itens, janelas_total: janelas.length })
    }

    if (etapa === 'saldos') {
      await fotografarSaldos(ctx, api)
      // O watermark começa agora. A partir daqui o incremental cuida.
      await setWatermark(connectionId, 'eventos', new Date().toISOString())
      await query(
        `update core.connection set last_sync_at = now(), last_error = null, updated_at = now()
          where id = $1`, [connectionId],
      )
      await query(
        `update core.onboarding_job
            set status = 'concluido', etapa = 'fim', itens = $2,
                lease_ate = null, erro = null, atualizado_em = now()
          where connection_id = $1`,
        [connectionId, itens],
      )
    }

    return progressoCarga(connectionId)
  } catch (e) {
    // O progresso fica onde parou. A próxima chamada retoma da mesma janela, e
    // repetir uma janela não duplica nada porque o ingest é idempotente.
    return finalizarErro(connectionId, e.message, { etapa, janela, itens })
  }
}

const salvar = (connectionId, campos) => query(
  `update core.onboarding_job
      set etapa = $2, janela = $3, itens = $4, janelas_total = $5, atualizado_em = now()
    where connection_id = $1`,
  [connectionId, campos.etapa, campos.janela, campos.itens, campos.janelas_total ?? 0],
)

// Solta a trava sem marcar erro: acabou o tempo, não o trabalho.
async function soltar(connectionId, campos) {
  await query(
    `update core.onboarding_job
        set status = 'pendente', etapa = $2, janela = $3, itens = $4,
            lease_ate = null, atualizado_em = now()
      where connection_id = $1`,
    [connectionId, campos.etapa, campos.janela, campos.itens],
  )
  return progressoCarga(connectionId)
}

async function finalizarErro(connectionId, mensagem, campos) {
  await query(
    `update core.onboarding_job
        set status = 'erro', erro = $2, lease_ate = null, atualizado_em = now(),
            etapa = coalesce($3, etapa), janela = coalesce($4, janela),
            itens = coalesce($5, itens)
      where connection_id = $1`,
    [connectionId, String(mensagem).slice(0, 500),
     campos?.etapa ?? null, campos?.janela ?? null, campos?.itens ?? null],
  )
  return progressoCarga(connectionId)
}
