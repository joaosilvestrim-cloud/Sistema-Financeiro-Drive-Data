import { NextResponse } from 'next/server'
import { receberLiquidacao } from '@/lib/tributostream'

export const dynamic = 'force-dynamic'
// Timeout curto de propósito. Esta rota só guarda o bruto; se ela demorar, o
// banco desiste e reenvia, e a fila só cresce. Tudo que é lento mora fora dela.
export const maxDuration = 10

// TributoStream: ingestão da liquidação bancária com split payment.
//
// O adquirente (ou o processador do retorno CNAB) avisa aqui que um Pix,
// boleto ou cartão liquidou, já com o imposto segregado na fonte. A rota faz
// três coisas e nenhuma a mais: valida o segredo, grava o payload na raw e
// devolve 200. A conciliação contra o título e contra a NFe é assíncrona.
//
// Sobre o acesso ao banco: este projeto NÃO usa o client Supabase com
// service role nas rotas. A SUPABASE_SERVICE_ROLE_KEY nunca vai para a
// Vercel, por decisão de segurança antiga do projeto. O app conecta direto
// no Postgres via pooler com role própria (lib/db.js), que já passa por cima
// da RLS do mesmo jeito que o worker. O efeito é o mesmo que o service role
// teria no PostgREST, sem expor uma chave que dá o banco inteiro a quem
// vazar o ambiente. A atribuição de tenant é responsabilidade nossa no
// código, pelo CNPJ do recebedor, e a lib/tributostream.js faz isso.
//
// O segredo vai em cabeçalho, nunca na URL. URL aparece em log de proxy, em
// histórico e em relatório de erro. Cabeçalho não. Sem BANK_WEBHOOK_SECRET
// configurado a rota se recusa a funcionar, porque aberta ela seria um jeito
// de qualquer um inventar liquidação para qualquer cliente.

function autorizado(request) {
  const segredo = process.env.BANK_WEBHOOK_SECRET
  if (!segredo) return false
  const enviado = request.headers.get('authorization') ?? ''
  // Comparação de tamanho igual antes do conteúdo evita vazar o tamanho do
  // segredo pelo tempo de resposta.
  if (enviado.length !== segredo.length) return false
  let diff = 0
  for (let i = 0; i < segredo.length; i++) diff |= enviado.charCodeAt(i) ^ segredo.charCodeAt(i)
  return diff === 0
}

export async function POST(request) {
  if (!autorizado(request)) {
    return NextResponse.json(
      { erro: process.env.BANK_WEBHOOK_SECRET ? 'nao autorizado' : 'BANK_WEBHOOK_SECRET ausente' },
      { status: 401 },
    )
  }

  // O corpo é lido como texto primeiro porque o hash de dedupe é dos bytes
  // que chegaram, não do objeto reinterpretado. Dois JSONs equivalentes com
  // espaços diferentes são reenvios diferentes aos olhos do banco.
  let corpoBruto = ''
  let corpo = null
  try {
    corpoBruto = await request.text()
    corpo = JSON.parse(corpoBruto)
  } catch {
    return NextResponse.json({ erro: 'corpo invalido' }, { status: 400 })
  }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return NextResponse.json({ erro: 'esperado um objeto JSON' }, { status: 400 })
  }

  // A fonte vem da query (?fonte=cnab) para o mesmo endpoint servir o
  // webhook do adquirente e o processador de retorno CNAB.
  const fonte = new URL(request.url).searchParams.get('fonte') === 'cnab' ? 'cnab' : 'adquirente'

  try {
    const r = await receberLiquidacao({ fonte, corpoBruto, corpo })
    // 200 sempre que o aviso foi guardado, incluindo o duplicado e o órfão.
    // O banco reenvia tudo que não for 200, e reenviar o que já está salvo
    // só gera trabalho repetido dos dois lados.
    return NextResponse.json(r)
  } catch (e) {
    // 500 de verdade: aqui o banco DEVE reenviar, porque não gravamos nada.
    return NextResponse.json({ erro: e.message }, { status: 500 })
  }
}
