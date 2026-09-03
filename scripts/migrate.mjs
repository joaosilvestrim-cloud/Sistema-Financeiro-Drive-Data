// Aplica as migrations de migrations/ em ordem, uma por transação.
// Registra o que já rodou em core._migration.

import { readdir, readFile } from 'node:fs/promises'
import { pool, tx } from '../src/db.mjs'

const dir = new URL('../migrations/', import.meta.url)

await pool.query(`
  create schema if not exists core;
  create table if not exists core._migration (
    name        text primary key,
    applied_at  timestamptz not null default now()
  );
`)

const { rows } = await pool.query('select name from core._migration')
const aplicadas = new Set(rows.map((r) => r.name))

const arquivos = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
let novas = 0

for (const nome of arquivos) {
  if (aplicadas.has(nome)) {
    console.log(`ja aplicada  ${nome}`)
    continue
  }
  const sql = await readFile(new URL(nome, dir), 'utf8')
  const t0 = Date.now()
  try {
    await tx(async (client) => {
      await client.query(sql)
      await client.query('insert into core._migration (name) values ($1)', [nome])
    })
    novas++
    console.log(`aplicada     ${nome} (${Date.now() - t0}ms)`)
  } catch (e) {
    console.error(`FALHOU       ${nome}\n${e.message}`)
    await pool.end()
    process.exit(1)
  }
}

console.log(novas ? `\n${novas} migration(s) aplicada(s).` : '\nBanco ja estava atualizado.')
await pool.end()
