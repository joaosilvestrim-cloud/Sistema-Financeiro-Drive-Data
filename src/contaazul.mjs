import { config } from './config.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Balde de vazao. A API aceita 10 req/s e 600 req/min por empresa conectada.
// Cada conexao tem o seu proprio balde, entao duas empresas nao disputam cota.
class RateLimiter {
  constructor(rps) {
    this.intervalMs = 1000 / rps
    this.next = 0
  }
  async take() {
    const now = Date.now()
    const at = Math.max(now, this.next)
    this.next = at + this.intervalMs
    if (at > now) await sleep(at - now)
  }
}

export class ContaAzulClient {
  // getToken devolve o access_token valido. Quem cuida da renovacao e de quem
  // constroi o cliente: em Fase 0 e o arquivo local, na Fase 1 e o banco com lock.
  constructor({ getToken, rps = config.requestsPerSecond } = {}) {
    if (typeof getToken !== 'function') throw new Error('getToken e obrigatorio')
    this.getToken = getToken
    this.limiter = new RateLimiter(rps)
    this.stats = { requests: 0, retries: 0, bytes: 0, ms: 0 }
  }

  async get(path, params = {}, attempt = 0) {
    const token = await this.getToken()
    const url = new URL(config.apiUrl + path)
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item))
      else url.searchParams.set(k, String(v))
    }

    await this.limiter.take()
    const started = Date.now()
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    const text = await res.text()
    this.stats.requests++
    this.stats.bytes += text.length
    this.stats.ms += Date.now() - started

    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) throw new Error(`${res.status} em ${path} apos 5 tentativas: ${text.slice(0, 300)}`)
      const retryAfter = Number(res.headers.get('retry-after'))
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 1000 + Math.random() * 500
      this.stats.retries++
      await sleep(wait)
      return this.get(path, params, attempt + 1)
    }

    if (!res.ok) {
      const err = new Error(`${res.status} em ${path}: ${text.slice(0, 400)}`)
      err.status = res.status
      err.body = text
      throw err
    }

    return text ? JSON.parse(text) : null
  }

  // Escrita. Mesma vazao e mesmo backoff da leitura, porque o limite da API e
  // por conta conectada e nao separa um do outro.
  //
  // Sem retry automatico no 5xx, ao contrario do GET: repetir uma criacao que
  // talvez tenha entrado no ERP duplicaria despesa, e nao existe endpoint para
  // apagar. Erro aqui sobe para quem chamou decidir.
  async post(path, corpo, attempt = 0) {
    const token = await this.getToken()
    await this.limiter.take()
    const started = Date.now()

    const res = await fetch(config.apiUrl + path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(corpo),
    })
    const text = await res.text()
    this.stats.requests++
    this.stats.bytes += text.length
    this.stats.ms += Date.now() - started

    // Só o 429 é seguro repetir: nele a requisicao foi recusada antes de
    // produzir efeito.
    if (res.status === 429 && attempt < 4) {
      const retryAfter = Number(res.headers.get('retry-after'))
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 1000 + Math.random() * 400
      this.stats.retries++
      await sleep(wait)
      return this.post(path, corpo, attempt + 1)
    }

    if (!res.ok) {
      const err = new Error(`${res.status} em ${path}: ${text.slice(0, 400)}`)
      err.status = res.status
      err.body = text
      throw err
    }

    return text ? JSON.parse(text) : null
  }

  // Percorre todas as paginas.
  //
  // A API nao tem uma convencao unica de envelope. Ate agora apareceram tres:
  //   { itens_totais, itens }   financeiro, categorias, centro de custo
  //   { totalItems, items }     pessoas
  //   { total_itens, itens }    vendas
  // e categorias-dre devolve um array puro, sem envelope nenhum.
  // Ler so uma delas faz o recurso parecer vazio em vez de dar erro, que e o
  // pior tipo de bug: silencioso e com cara de "o cliente nao tem dado".
  async getAll(path, params = {}) {
    const itens = []
    let pagina = 1
    let total = null
    for (;;) {
      const page = await this.get(path, { ...params, pagina, tamanho_pagina: config.pageSize })

      if (Array.isArray(page)) return { itens: page, itens_totais: page.length, paginas: 1 }

      const lote = page?.itens ?? page?.items ?? []
      if (total === null) total = page?.itens_totais ?? page?.total_itens ?? page?.totalItems ?? lote.length
      itens.push(...lote)
      if (lote.length === 0 || itens.length >= total || pagina > 500) break
      pagina++
    }
    return { itens, itens_totais: total ?? itens.length, paginas: pagina }
  }
}

// A API recusa data-hora com fuso ou milissegundo. Quer exatamente
// YYYY-MM-DDTHH:mm:ss, e a mensagem de erro fala de ISO 8601, o que leva a
// pessoa a tentar justamente o toISOString() que ela nao aceita.
export const dataHora = (d) => new Date(d).toISOString().slice(0, 19)

// Janelas mensais [inicio, fim] em ISO date. A busca de contas a pagar e a
// receber exige faixa de data_vencimento, entao a carga precisa ser fatiada.
export function monthWindows(monthsBack, monthsForward, ref = new Date()) {
  const windows = []
  for (let i = -monthsBack; i <= monthsForward; i++) {
    const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + i, 1))
    const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + i + 1, 0))
    windows.push([start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)])
  }
  return windows
}
