import { config } from './config.mjs'
import { ensureFreshToken } from './tokens.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Balde de vazao simples. A API aceita 10 req/s e 600 req/min por empresa conectada.
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

export const stats = { requests: 0, retries: 0, bytes: 0, ms: 0 }

export class ContaAzul {
  constructor() {
    this.limiter = new RateLimiter(config.requestsPerSecond)
  }

  async get(path, params = {}, attempt = 0) {
    const token = await ensureFreshToken()
    const url = new URL(config.apiUrl + path)
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item))
      else url.searchParams.set(k, String(v))
    }

    await this.limiter.take()
    const started = Date.now()
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
    })
    const text = await res.text()
    stats.requests++
    stats.bytes += text.length
    stats.ms += Date.now() - started

    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) throw new Error(`${res.status} em ${path} apos 5 tentativas: ${text.slice(0, 300)}`)
      const retryAfter = Number(res.headers.get('retry-after'))
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 1000 + Math.random() * 500
      stats.retries++
      console.warn(`  ${res.status} em ${path}, tentando de novo em ${Math.round(wait)}ms`)
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

  // Percorre todas as paginas de um recurso que responde { itens_totais, itens }.
  async getAll(path, params = {}) {
    const itens = []
    let pagina = 1
    let total = null
    for (;;) {
      const page = await this.get(path, { ...params, pagina, tamanho_pagina: config.pageSize })
      const lote = page?.itens ?? []
      if (total === null) total = page?.itens_totais ?? lote.length
      itens.push(...lote)
      if (lote.length === 0 || itens.length >= total || pagina > 500) break
      pagina++
    }
    return { itens, itens_totais: total ?? itens.length, paginas: pagina }
  }
}

// Gera janelas mensais [inicio, fim] em ISO date. A busca de contas a pagar e a
// receber exige faixa de data_vencimento, entao a carga precisa ser fatiada.
export function monthWindows(monthsBack, monthsForward) {
  const windows = []
  const now = new Date()
  for (let i = -monthsBack; i <= monthsForward; i++) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 0))
    windows.push([start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)])
  }
  return windows
}
