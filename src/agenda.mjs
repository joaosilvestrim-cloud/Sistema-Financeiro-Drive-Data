import { query } from './db.mjs'
import { accessTokenFor } from './connections.mjs'
import { syncConnection, fecharRodadasOrfas } from './sync.mjs'
import { avancarCarga } from './carga.mjs'

// Agenda de manutenção, feita para rodar dentro de uma função serverless.
//
// O worker do pg-boss continua existindo e é melhor para volume, mas exige um
// processo de pé em algum host. Isto aqui roda na Vercel, no mesmo projeto, com
// um cron chamando a rota. Duas consequências que valem registrar:
//
// 1. Some a exigência de host no Brasil. A Conta Azul pode bloquear requisição
//    de fora do país, e o que importa é de onde a chamada sai, não quem apertou
//    o botão. A função roda em gru1, então qualquer cron do mundo pode disparar.
//
// 2. O tempo é curto. Por isso tudo aqui é fatiado e tem ordem de prioridade:
//    primeiro quem está esperando na tela, depois o token que vai morrer, e só
//    então a atualização de rotina.

const ORCAMENTO_MS = 45_000

// Renova com folga larga. O access token dura uma hora, mas o que mata conexão
// de cliente é o refresh token, que na Conta Azul vale duas semanas e rotaciona
// a cada uso. Tocar em toda conexão uma vez por dia mantém ele vivo para
// sempre, inclusive na conta que ninguém abre.
const RENOVAR_APOS_HORAS = 20

// Conexão de tenant bloqueado não gasta chamada de API. É aqui que a situação
// comercial vira efeito técnico.
const ATIVAS = `
  from core.connection c
  join core.tenant t on t.id = c.tenant_id
 where c.status = 'connected'
   and t.status = 'ativo'
   and (t.plano <> 'trial' or t.trial_ate is null or t.trial_ate > now())`

export async function rodarAgenda({ orcamentoMs = ORCAMENTO_MS } = {}) {
  const limite = Date.now() + orcamentoMs
  const feito = { cargas: [], tokens: [], syncs: [], erros: [] }
  const acabou = () => Date.now() > limite

  // Rodada morta no meio deixa a linha aberta e a tela diz rodando para
  // sempre. Fechar antes de comecar mantem o historico honesto.
  feito.orfas = await fecharRodadasOrfas()

  // 1. Carga inicial pendente. Alguém pode ter fechado a aba no meio, e essa é
  // a pessoa mais perto de desistir do produto.
  const { rows: cargas } = await query(
    `select c.id, c.nome ${ATIVAS}
       and exists (select 1 from core.onboarding_job j
                    where j.connection_id = c.id and j.status in ('pendente', 'erro')
                      and (j.lease_ate is null or j.lease_ate < now()))
     order by c.created_at limit 5`,
  )
  for (const c of cargas) {
    if (acabou()) break
    try {
      const p = await avancarCarga(c.id, Math.max(5_000, limite - Date.now()))
      feito.cargas.push({ nome: c.nome, etapa: p?.etapa, pct: p?.percentual })
    } catch (e) {
      feito.erros.push({ etapa: 'carga', nome: c.nome, erro: e.message.slice(0, 200) })
    }
  }

  // 2. Batimento do token. Barato, algumas chamadas, e é o que impede a conexão
  // de morrer sozinha depois de duas semanas parada.
  const { rows: velhas } = await query(
    `select c.id, c.nome ${ATIVAS}
       and (c.updated_at is null or c.updated_at < now() - make_interval(hours => ${RENOVAR_APOS_HORAS}))
     order by c.updated_at asc nulls first limit 20`,
  )
  for (const c of velhas) {
    if (acabou()) break
    try {
      await accessTokenFor(c.id)
      feito.tokens.push(c.nome)
    } catch (e) {
      // O accessTokenFor já marcou a conexão como expired ou error. Aqui só
      // registramos, porque uma conexão morta não pode derrubar a rodada das
      // outras.
      feito.erros.push({ etapa: 'token', nome: c.nome, erro: e.message.slice(0, 200) })
    }
  }

  // 3. Atualização de rotina, só quem venceu o próprio intervalo.
  const { rows: vencidas } = await query(
    `select c.id, c.nome ${ATIVAS}
       and (c.last_sync_at is null
            or c.last_sync_at < now() - make_interval(mins => c.sync_interval_minutes))
       and not exists (select 1 from core.onboarding_job j
                        where j.connection_id = c.id and j.status <> 'concluido')
     order by c.last_sync_at asc nulls first limit 20`,
  )
  for (const c of vencidas) {
    if (acabou()) break
    try {
      // O orcamento entra aqui dentro. Sem ele uma unica conexao grande
      // consumiria a funcao inteira e seria morta no meio, sem nunca terminar.
      const r = await syncConnection(c.id, 'incremental', { orcamentoMs: Math.max(5_000, limite - Date.now()) })
      feito.syncs.push({ nome: c.nome, itens: r.itens, incompleto: !!r.incompleto })
      if (r.incompleto) feito.pendenteSync = true
    } catch (e) {
      feito.erros.push({ etapa: 'sync', nome: c.nome, erro: e.message.slice(0, 200) })
    }
  }

  return {
    ...feito,
    // Sobrou fila. Quem chamou pode disparar de novo em vez de esperar o próximo
    // horário, o que importa quando há muitos clientes novos ao mesmo tempo.
    pendente: cargas.length > feito.cargas.length
      || vencidas.length > feito.syncs.length,
  }
}

// Marca como expirado quem passou do teste. Roda junto com a agenda porque não
// vale um cron próprio, e precisa existir mesmo antes do gateway: sem isso o
// teste nunca acaba e o produto é de graça para sempre.
export async function encerrarTestesVencidos() {
  const { rows } = await query(
    `update core.tenant
        set status = 'expirado'
      where plano = 'trial' and status = 'ativo'
        and trial_ate is not null and trial_ate < now()
      returning id, nome`,
  )
  return rows
}
