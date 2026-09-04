import 'server-only'
import { kpis, anomalias, indiceHhi } from './queries.js'
import { projecao } from './forecast.js'
import { brl, rotuloMes, indice } from './format.js'

// Alertas da visão geral.
//
// Só entra aqui o que pede uma decisão. Indicador que é apenas interessante
// fica na sua tela. Alerta demais treina o usuário a ignorar todos.
// Recebe os KPIs já buscados pela página quando existirem. Buscar de novo era
// uma ida e volta a mais no banco por carregamento, sem nada em troca.
export async function alertas(sessao, kpisJaBuscados = null) {
  const [k, base, desvios, hhi] = await Promise.all([
    kpisJaBuscados ?? kpis(sessao), projecao(sessao, 6), anomalias(sessao, 4, 3), indiceHhi(sessao),
  ])
  const lista = []

  // Saldo projetado negativo, no cenário sem estresse nenhum.
  let saldo = base.saldoInicial
  for (const l of base.linhas) {
    saldo += l.carteiraEntradas * base.taxaNoPrazo + l.novosEntradas * base.taxaNoPrazo
      - l.carteiraSaidas - l.novosSaidas
    if (saldo < 0) {
      lista.push({
        nivel: 'critical',
        titulo: `Caixa negativo previsto para ${rotuloMes(l.competencia)}`,
        texto: `A projeção chega a ${brl(saldo)} sem nenhum cenário de estresse aplicado.`,
        href: '/previsao',
      })
      break
    }
  }

  const vencido = Number(k?.receber_vencido ?? 0)
  const aReceber = Number(k?.a_receber ?? 0)
  if (vencido > 0 && aReceber > 0) {
    const fatia = vencido / aReceber
    if (fatia >= 0.2) {
      lista.push({
        nivel: fatia >= 0.35 ? 'critical' : 'warning',
        titulo: `${(fatia * 100).toFixed(0)}% da carteira está vencida`,
        texto: `${brl(vencido)} em títulos vencidos de um total de ${brl(aReceber)} a receber.`,
        href: '/recebiveis',
      })
    }
  }

  const pagarVencido = Number(k?.pagar_vencido ?? 0)
  if (pagarVencido > 0) {
    lista.push({
      nivel: 'warning',
      titulo: 'Contas a pagar em atraso',
      texto: `${brl(pagarVencido)} venceram e ainda não saíram do caixa.`,
      href: '/recebiveis',
    })
  }

  for (const d of desvios) {
    const acima = Number(d.escore) > 0
    if (d.kind === 'payable' && acima) {
      lista.push({
        nivel: 'warning',
        titulo: `${d.categoria} fora do padrão em ${rotuloMes(d.competencia)}`,
        texto: `${brl(d.valor)} contra ${brl(d.mediana)} de mediana dos 12 meses anteriores.`,
        href: '/indicadores',
      })
    }
  }

  if (hhi?.hhi !== null && Number(hhi?.hhi) >= 0.25) {
    lista.push({
      nivel: 'warning',
      titulo: 'Faturamento concentrado em poucos clientes',
      texto: `Índice HHI de ${indice(hhi.hhi)}, acima do limite usual de 0,25.`,
      href: '/indicadores',
    })
  }

  const paradas = sessao.conexoes.filter((c) => c.status !== 'connected')
  if (paradas.length) {
    lista.push({
      nivel: 'critical',
      titulo: `${paradas.length} conexão(ões) fora do ar`,
      texto: `${paradas.map((c) => c.nome).join(', ')}. Os números abaixo estão desatualizados.`,
      href: '/conexoes',
    })
  }

  const ordem = { critical: 0, warning: 1, info: 2 }
  return lista.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]).slice(0, 5)
}
