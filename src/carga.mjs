import { query } from './db.mjs'
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

// As opções de histórico que a tela oferece, e o horizonte para frente, que é
// fixo: o que vence nos próximos 24 meses vem sempre, em qualquer opção, porque
// é barato (pouco lançamento por mês) e é o que alimenta o fluxo de caixa.
export const PERIODOS = [6, 12, 24, 36]
export const MESES_FRENTE = 24

// Vazão usada na estimativa de tempo. Medida, não chutada: cada lançamento
// já pago custa uma chamada para trazer as baixas, a API aceita 10 por
// segundo e a ida e volta come parte disso. Conservadora de propósito: é
// melhor a carga acabar antes do prometido do que depois.
const LANCAMENTOS_POR_SEGUNDO = 3
const SEGUNDOS_POR_JANELA = 1.2

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
    `select status, etapa, janela, janelas_total, itens, erro, atualizado_em,
            meses_atras, meses_frente
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
  if (job.meses_atras == null) {
    return { ...job, status: 'aguardando_periodo', percentual: 0, rotulo: 'Escolha o período para começar' }
  }
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
        and meses_atras is not null
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
  // A lista de janelas sai do período gravado na carga, nunca do ambiente.
  // A posição "janela N" só vale contra a lista que a gerou.
  const janelas = monthWindows(job.meses_atras, job.meses_frente ?? MESES_FRENTE)

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

// A escolha do período, feita pela pessoa na tela de carga. Só vale para carga
// que ainda não começou: trocar no meio mudaria a lista de janelas e a posição
// gravada deixaria de corresponder a ela.
export async function definirPeriodo(connectionId, tenantId, meses) {
  if (!PERIODOS.includes(Number(meses))) throw new Error('Período inválido.')
  const { rows } = await query(
    `update core.onboarding_job
        set meses_atras = $3, meses_frente = $4, janela = 0, atualizado_em = now()
      where connection_id = $1 and tenant_id = $2 and meses_atras is null
      returning id`,
    [connectionId, tenantId, Number(meses), MESES_FRENTE],
  )
  if (!rows.length) throw new Error('Esta carga já começou ou não existe.')
}

// Trazer mais passado depois da carga pronta. Reabre a carga com o período
// maior e refaz as janelas desde o começo; o ingest é idempotente, então o
// que já estava no banco não duplica, só é conferido de novo.
export async function ampliarHistorico(connectionId, tenantId, meses) {
  if (!PERIODOS.includes(Number(meses))) throw new Error('Período inválido.')
  const { rows } = await query(
    `update core.onboarding_job
        set meses_atras = $3, meses_frente = $4, status = 'pendente', etapa = 'dimensoes',
            janela = 0, lease_ate = null, erro = null, atualizado_em = now()
      where connection_id = $1 and tenant_id = $2
        and status = 'concluido' and meses_atras < $3
      returning id`,
    [connectionId, tenantId, Number(meses), MESES_FRENTE],
  )
  if (!rows.length) throw new Error('Não há carga concluída com período menor que esse.')
}

// Estimativa de tempo de cada opção, com o volume real da empresa. Duas
// chamadas baratas (uma página de cada tipo, só para ler o total) nos últimos
// três meses fechados dão a média mensal. Se a API não responder, a tela
// mostra as opções sem minutos em vez de travar.
export async function estimarCarga(connectionId) {
  try {
    const client = clientFor(connectionId)
    const hoje = new Date()
    const ini = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 3, 1))
    const fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 0))
    const d = (x) => x.toISOString().slice(0, 10)
    let total = 0
    for (const alvo of ['receber', 'pagar']) {
      const page = await client.get(`/v1/financeiro/eventos-financeiros/contas-a-${alvo}/buscar`, {
        data_vencimento_de: d(ini), data_vencimento_ate: d(fim), pagina: 1, tamanho_pagina: 10,
      })
      total += Number(page?.itens_totais ?? page?.total_itens ?? 0)
    }
    const porMes = total / 3
    const minutos = (meses) => {
      const janelas = (meses + MESES_FRENTE + 1) * 2
      const segundos = (porMes * meses) / LANCAMENTOS_POR_SEGUNDO + janelas * SEGUNDOS_POR_JANELA
      return Math.max(1, Math.ceil(segundos / 60))
    }
    return {
      porMes: Math.round(porMes),
      minutos: Object.fromEntries(PERIODOS.map((m) => [m, minutos(m)])),
    }
  } catch {
    return null
  }
}
