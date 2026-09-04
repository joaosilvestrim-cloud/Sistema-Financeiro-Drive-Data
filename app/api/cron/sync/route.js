import { NextResponse } from 'next/server'
import { rodarAgenda, encerrarTestesVencidos } from '@/src/agenda.mjs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Motor de manutenção. Substitui o worker de processo contínuo.
//
// A Vercel manda `Authorization: Bearer $CRON_SECRET` nos crons dela. Qualquer
// outro agendador serve, desde que mande o mesmo cabeçalho, porque a chamada
// para a Conta Azul sai daqui de dentro, de gru1, e não de quem apertou o
// botão. Isso resolve a restrição de IP fora do Brasil sem precisar de host
// novo.
//
// Sem CRON_SECRET a rota se recusa a rodar. Aberta, ela seria um jeito de
// qualquer um queimar a cota de API de todos os clientes.

function autorizado(request) {
  const segredo = process.env.CRON_SECRET
  if (!segredo) return false
  const cabecalho = request.headers.get('authorization') ?? ''
  return cabecalho === `Bearer ${segredo}`
}

async function executar(request) {
  if (!autorizado(request)) {
    const motivo = process.env.CRON_SECRET
      ? 'segredo invalido'
      : 'CRON_SECRET nao esta configurado no ambiente'
    return NextResponse.json({ erro: motivo }, { status: 401 })
  }

  const t0 = Date.now()
  const encerrados = await encerrarTestesVencidos()
  const r = await rodarAgenda()
  return NextResponse.json({
    ...r,
    testes_encerrados: encerrados.map((t) => t.nome),
    ms: Date.now() - t0,
  })
}

export const GET = executar
export const POST = executar
