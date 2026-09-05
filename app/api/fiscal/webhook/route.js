import { NextResponse } from 'next/server'
import { registrarEvento } from '@/lib/fiscal'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Gatilho da Focus NFe.
//
// A emissão é assíncrona: o POST devolve "processando" e a nota só existe
// quando a prefeitura ou a SEFAZ responde, o que leva de segundos a minutos. Ou
// a gente fica perguntando de tempos em tempos, ou eles avisam. Eles avisam, e
// isso é a diferença mais importante entre esta integração e a da Conta Azul,
// que não tem webhook nenhum e obrigou o sistema inteiro a varrer.
//
// A Focus manda o cabeçalho de autorização que escolhemos no cadastro do
// gatilho. É por isso que o segredo não vai na URL: URL aparece em log de
// proxy, em histórico de navegador e em relatório de erro. Cabeçalho não.
//
// Sem FOCUS_WEBHOOK_SECRET a rota se recusa a funcionar. Aberta, ela seria um
// jeito de qualquer um marcar nota de qualquer cliente como autorizada.

function autorizado(request) {
  const segredo = process.env.FOCUS_WEBHOOK_SECRET
  if (!segredo) return false
  const enviado = request.headers.get('authorization') ?? ''
  // Comparação de tamanho igual antes do conteúdo evita vazar o tamanho do
  // segredo pelo tempo de resposta. É barato e tira a discussão da mesa.
  if (enviado.length !== segredo.length) return false
  let diff = 0
  for (let i = 0; i < segredo.length; i++) diff |= enviado.charCodeAt(i) ^ segredo.charCodeAt(i)
  return diff === 0
}

export async function POST(request) {
  if (!autorizado(request)) {
    return NextResponse.json(
      { erro: process.env.FOCUS_WEBHOOK_SECRET ? 'nao autorizado' : 'FOCUS_WEBHOOK_SECRET ausente' },
      { status: 401 },
    )
  }

  let corpo = null
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'corpo invalido' }, { status: 400 })
  }

  // A referência vem no corpo em `ref`, e é ela que liga o aviso ao documento.
  // Sem ref o aviso ainda é gravado, sem dono, porque perder aviso é pior que
  // guardar aviso órfão: o órfão a gente investiga depois, o perdido não.
  const ref = corpo?.ref ?? corpo?.referencia ?? null

  try {
    const r = await registrarEvento({ ref, corpo })
    // 200 sempre que o aviso foi guardado. A Focus reenvia o que falhou, e
    // reenvio de aviso que já foi processado só gera trabalho repetido.
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ erro: e.message }, { status: 500 })
  }
}
