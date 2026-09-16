import { NextResponse } from 'next/server'
import { autenticarCredencial, receberLiquidacao } from '@/lib/tributostream'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

// TributoStream, endpoint por tenant.
//
// Este é o endereço que o cliente cadastra no banco ou no adquirente, gerado
// por ele mesmo na tela de conexões, sem ninguém da plataforma no meio. O
// segmento da URL é o id público da credencial: ele só identifica qual
// credencial usar, não autentica nada. Quem autentica é o segredo, que vai
// no cabeçalho authorization e é comparado em tempo constante contra o valor
// cifrado no banco.
//
// A diferença para a rota irmã (../route.js, segredo global em env var) é a
// atribuição de tenant: aqui ela vem da credencial, então funciona para
// qualquer cliente sem cadastro fiscal prévio e sem deploy. O CNPJ do
// payload vira conferência, não requisito.

export async function POST(request, { params }) {
  const { credencial } = await params
  const segredo = request.headers.get('authorization') ?? ''
  const auth = await autenticarCredencial(credencial, segredo)
  if (!auth) {
    // Mesma resposta para credencial inexistente, revogada ou segredo
    // errado. Detalhar qual dos três seria um oráculo de enumeração.
    return NextResponse.json({ erro: 'nao autorizado' }, { status: 401 })
  }

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

  const fonte = new URL(request.url).searchParams.get('fonte') === 'cnab' ? 'cnab' : 'adquirente'

  try {
    const r = await receberLiquidacao({ fonte, corpoBruto, corpo, tenantId: auth.tenantId })
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json({ erro: e.message }, { status: 500 })
  }
}
