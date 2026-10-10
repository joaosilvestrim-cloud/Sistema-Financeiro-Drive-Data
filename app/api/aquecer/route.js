import { NextResponse } from 'next/server'
import { q1 } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Aquecedor. A Vercel chama a cada 5 minutos (vercel.json) para o servidor das
// telas não desligar entre um uso e outro.
//
// Medido em 09/10/2026: com o servidor aquecido, um clique no menu fica pronto
// em 300 a 470 ms; o primeiro clique depois de um período parado levou 7,4 s.
// Esta rota não declara maxDuration de propósito: assim ela fica no mesmo
// grupo de funções das telas, e manter ela viva mantém as telas vivas. A
// consulta ao banco mantém aberta também a conexão do pool, que é a outra
// metade da demora de partida.
//
// Mesma proteção do cron de sincronização: sem o segredo, nada roda.
export async function GET(request) {
  const segredo = process.env.CRON_SECRET
  if (!segredo || request.headers.get('authorization') !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: 'nao autorizado' }, { status: 401 })
  }
  const t0 = Date.now()
  await q1('select 1 as ok')
  return NextResponse.json({ ok: true, ms: Date.now() - t0 })
}
