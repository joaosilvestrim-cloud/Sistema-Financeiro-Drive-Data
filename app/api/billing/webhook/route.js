import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  registrarEvento, marcarEventoAplicado, tenantPorAssinatura,
  ativarPlano, marcarInadimplente, cancelar,
} from '@/lib/assinaturaEstado'

export const dynamic = 'force-dynamic'

// Recebe o aviso do gateway de pagamento.
//
// O gateway ainda não foi escolhido, e esta rota já está pronta porque o que
// dá trabalho não é falar com o gateway, é acertar as três coisas abaixo. Elas
// valem para Asaas, Stripe, Pagar.me ou qualquer outro.
//
// 1. Conferir a assinatura antes de acreditar. Sem isso, qualquer um manda um
//    "pagamento aprovado" para esta URL e ganha o produto de graça.
//
// 2. Não aplicar o mesmo evento duas vezes. Todo gateway reenvia quando não
//    recebe confirmação. Um "pagamento aprovado" repetido viraria dois meses de
//    plano, e um "cancelado" atrasado desligaria quem já voltou.
//
// 3. Responder 200 mesmo no que a gente não entende. Erro faz o gateway tentar
//    de novo em loop, e um evento desconhecido não é falha nossa.
//
// Para ligar um gateway novo: escreva o tradutor em TRADUTORES e cadastre o
// segredo. Nada de regra comercial mora aqui, ela está em lib/assinaturaEstado.

// Cada gateway assina de um jeito. O que muda é o nome do cabeçalho e como o
// resumo é calculado, e é só isso que fica dentro do tradutor.
const TRADUTORES = {
  // Modelo. Ajuste os nomes de campo conforme a documentação do escolhido.
  generico: {
    cabecalhoAssinatura: 'x-signature',
    // Recebe o corpo cru e a chave, devolve a assinatura esperada.
    assinar: (cru, chave) => createHmac('sha256', chave).update(cru).digest('hex'),
    traduzir: (corpo) => ({
      eventoId: corpo.id ?? corpo.event_id ?? null,
      tipo: corpo.type ?? corpo.event ?? 'desconhecido',
      assinaturaId: corpo.subscription_id ?? corpo.subscription?.id ?? null,
      plano: corpo.plan ?? corpo.metadata?.plano ?? null,
      acessoAte: corpo.current_period_end ?? corpo.next_due_date ?? null,
      acao: mapearAcao(corpo.type ?? corpo.event),
    }),
  },
}

// Vocabulário mínimo. Só três coisas mudam o acesso de alguém.
function mapearAcao(tipo) {
  const t = String(tipo ?? '').toLowerCase()
  if (/(payment|invoice).*(succe|paid|confirm|received)|subscription.*(created|activ|renew)/.test(t)) return 'ativar'
  if (/(payment|invoice).*(fail|overdue|refus|declin)/.test(t)) return 'inadimplente'
  if (/subscription.*(cancel|delet|expir)/.test(t)) return 'cancelar'
  return null
}

function assinaturaConfere(tradutor, cru, recebida, chave) {
  if (!recebida) return false
  const esperada = tradutor.assinar(cru, chave)
  const a = Buffer.from(esperada)
  const b = Buffer.from(recebida)
  // Comparação de tempo constante. Comparar com === vaza o segredo aos poucos,
  // porque o tempo da comparação diz quantos caracteres bateram.
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request) {
  const gateway = process.env.BILLING_GATEWAY
  const chave = process.env.BILLING_WEBHOOK_SECRET
  if (!gateway || !chave) {
    return NextResponse.json({ erro: 'gateway de pagamento nao configurado' }, { status: 503 })
  }

  const tradutor = TRADUTORES[gateway]
  if (!tradutor) {
    return NextResponse.json({ erro: `gateway ${gateway} sem tradutor` }, { status: 501 })
  }

  // O corpo cru precisa ser lido antes de virar JSON: a assinatura é sobre os
  // bytes exatos que chegaram, e reserializar muda espaço e ordem de chave.
  const cru = await request.text()
  if (!assinaturaConfere(tradutor, cru, request.headers.get(tradutor.cabecalhoAssinatura), chave)) {
    return NextResponse.json({ erro: 'assinatura invalida' }, { status: 401 })
  }

  let corpo
  try { corpo = JSON.parse(cru) } catch { return NextResponse.json({ ok: true, ignorado: 'corpo invalido' }) }

  const e = tradutor.traduzir(corpo)
  if (!e.eventoId) return NextResponse.json({ ok: true, ignorado: 'evento sem id' })

  const tenant = e.assinaturaId ? await tenantPorAssinatura(gateway, e.assinaturaId) : null

  const linha = await registrarEvento({
    gateway, eventoId: e.eventoId, tipo: e.tipo, tenantId: tenant?.id, payload: corpo,
  })
  // Já tínhamos esse evento. Responder ok encerra o reenvio sem repetir o efeito.
  if (!linha) return NextResponse.json({ ok: true, repetido: true })

  if (!e.acao || !tenant) {
    await marcarEventoAplicado(linha.id, e.acao ? 'assinatura sem tenant conhecido' : null)
    return NextResponse.json({ ok: true, aplicado: false })
  }

  try {
    if (e.acao === 'ativar') {
      await ativarPlano(tenant.id, e.plano ?? 'profissional', {
        gateway, assinaturaId: e.assinaturaId, acessoAte: e.acessoAte,
      })
    } else if (e.acao === 'inadimplente') {
      await marcarInadimplente(tenant.id)
    } else if (e.acao === 'cancelar') {
      await cancelar(tenant.id, { acessoAte: e.acessoAte })
    }
    await marcarEventoAplicado(linha.id)
    return NextResponse.json({ ok: true, acao: e.acao })
  } catch (erro) {
    await marcarEventoAplicado(linha.id, erro.message)
    // 200 de propósito: o evento está gravado e pode ser reprocessado por nós.
    // Devolver erro só faria o gateway martelar a mesma falha.
    return NextResponse.json({ ok: true, aplicado: false, erro: erro.message })
  }
}
