// Reprocessa a camada core a partir dos payloads crus já guardados.
//
//   npm run reprocess -- --recurso settlement
//   npm run reprocess -- --recurso installment
//
// É para isso que a camada raw existe. Quando um mapeamento sai errado, e sai,
// a correção não precisa de uma nova varredura na API: o payload de origem está
// no banco, com o hash dele, e basta passá-lo pelo mapeador novo.
//
// Sem isso, corrigir um campo custaria uma carga inteira, minutos de espera e
// milhares de chamadas na cota do cliente.

import { pool, query } from '../src/db.mjs'
import { mapBaixa, daBusca, doDetalhe } from '../src/providers/contaazul.mjs'
import { ingestSettlements, ingestInstallments, loadDimensionMaps } from '../src/ingest.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]])
    return acc
  }, []),
)

const recurso = args.recurso || 'settlement'
const LOTE = 300

const { rows: conexoes } = await query(
  `select id, tenant_id, nome from core.connection where provider = 'contaazul'`,
)
if (!conexoes.length) {
  console.error('nenhuma conexao Conta Azul cadastrada')
  await pool.end()
  process.exit(1)
}

for (const conn of conexoes) {
  const ctx = { tenantId: conn.tenant_id, connectionId: conn.id }
  const maps = await loadDimensionMaps(ctx)

  // A versao mais recente de cada registro, que e o estado que vale.
  const { rows } = await query(
    `select distinct on (external_id) external_id, payload
       from raw.api_payload
      where connection_id = $1 and resource = $2
      order by external_id, fetched_at desc`,
    [conn.id, recurso],
  )
  console.log(`${conn.nome}: ${rows.length} payload(s) de ${recurso}`)

  let feitos = 0
  for (let i = 0; i < rows.length; i += LOTE) {
    const fatia = rows.slice(i, i + LOTE)

    if (recurso === 'settlement') {
      const baixas = fatia.map((r) => mapBaixa(r.payload.id_parcela)(r.payload))
      await ingestSettlements(ctx, maps, baixas)
    } else if (recurso === 'installment') {
      // O payload da busca e o do detalhe têm formatos diferentes, e só o
      // detalhe traz o evento com o rateio. A presença de `evento` é o que
      // separa os dois, e usar o mapeador errado perderia categoria e centro de
      // custo em silêncio.
      //
      // O `kind` da busca não vem no payload, então ele é deduzido pelo que já
      // está gravado. Parcela cujo tipo não dá para determinar fica de fora, o
      // que é melhor que gravar do lado errado do DRE.
      const tipos = new Map(
        (await query(
          `select external_id, kind from core.installment where connection_id = $1`,
          [conn.id],
        )).rows.map((x) => [x.external_id, x.kind]),
      )
      const parcelas = fatia
        .map((x) => (x.payload.evento
          ? doDetalhe(x.payload)
          : daBusca(x.payload, tipos.get(String(x.payload.id)))))
        .filter((p) => p.kind)
      await ingestInstallments(ctx, maps, parcelas)
    } else {
      console.error(`recurso ${recurso} ainda nao tem reprocessamento`)
      await pool.end()
      process.exit(1)
    }

    feitos += fatia.length
    process.stdout.write(`  ${feitos}/${rows.length}\r`)
  }
  console.log(`  ${feitos}/${rows.length} reprocessado(s)`)
}

await pool.end()
