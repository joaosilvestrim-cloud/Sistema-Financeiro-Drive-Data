import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { q1 } from '@/lib/db'
import { avancarCarga, progressoCarga } from '@/src/carga.mjs'

export const dynamic = 'force-dynamic'
// Cada chamada trabalha por volta de 40 segundos e devolve o controle. O teto
// aqui é a folga para fechar a última janela e gravar o progresso.
export const maxDuration = 60

// Motor da carga inicial, dirigido pela tela.
//
// POST avança um pedaço e devolve onde parou. GET só olha. A tela chama o POST
// em sequência até o status virar concluido, e é isso que faz a barra andar sem
// depender de worker nenhum no ar.

async function daSessao(request) {
  const sessao = await requireSession()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('conexao')
  if (!id) return { erro: 'informe a conexao' }
  // Sem esta checagem, alguém logado poderia disparar carga na conexão de outro
  // cliente só trocando o id na URL.
  const dono = await q1(
    `select id from core.connection where id = $1 and tenant_id = $2`,
    [id, sessao.tenantId],
  )
  if (!dono) return { erro: 'conexao nao encontrada' }
  return { id }
}

export async function GET(request) {
  const { id, erro } = await daSessao(request)
  if (erro) return NextResponse.json({ erro }, { status: 400 })
  return NextResponse.json(await progressoCarga(id) ?? { status: 'ausente' })
}

export async function POST(request) {
  const { id, erro } = await daSessao(request)
  if (erro) return NextResponse.json({ erro }, { status: 400 })
  return NextResponse.json(await avancarCarga(id))
}
