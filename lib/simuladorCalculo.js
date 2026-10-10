// A conta do simulador de caixa, pura, sem React.
//
// Mora fora do componente para poder ser testada contra o fluxo de caixa: o
// cenário Base tem que fechar, mês a mês, com o fluxo "com projeção". Duas
// telas do mesmo sistema mostrando saldos diferentes para o mesmo mês é o
// jeito mais rápido de perder a confiança de quem usa (scripts/caixateste.mjs).

export const NEUTRO = { atraso: 0, corte: 0, perda: 0, novos: 0, vencidos: 100, antecipar: 0, custoAntecipar: 2 }


export function calcular(base, c, movimentos) {
  const fatorNovos = 1 + c.novos / 100
  const fatorPerda = 1 - (c.perda / 100) * base.participacaoMaiorCliente
  const fatorCorte = 1 - c.corte / 100
  const fatorAtraso = c.atraso / 100

  const meses = base.linhas.map((l) => ({
    competencia: l.competencia,
    entradas: (l.carteiraEntradas * base.taxaNoPrazo + l.novosEntradas * base.taxaNoPrazo * fatorNovos) * fatorPerda,
    saidas: (l.carteiraSaidas + l.novosSaidas * fatorNovos) * fatorCorte,
  }))
  if (!meses.length) return []

  // Vencidos: entram no primeiro mês depois do corrente, na proporção que a
  // pessoa acredita. É a mesma regra do fluxo de caixa, conferida contra o
  // Conta Azul em 22/09 (o outubro dele trazia os vencidos de setembro). Antes
  // o simulador punha no mês corrente e as duas telas discordavam do mês.
  //
  // As obrigações vencidas saem inteiras, sem o corte de despesa: conta
  // atrasada já foi contraída e se paga. O código aplicava o corte nelas,
  // contra o que este comentário sempre disse.
  const alvo = meses[1] ?? meses[0]
  alvo.entradas += base.vencidosEntradas * (c.vencidos / 100)
  alvo.saidas += base.vencidosSaidas

  // Atraso: parte da entrada escorrega para o mês seguinte. O último mês
  // carrega o resto, senão o dinheiro sumiria do horizonte.
  const adiado = meses.map((m) => m.entradas * fatorAtraso)
  meses.forEach((m, i) => { m.entradas -= adiado[i] })
  adiado.forEach((v, i) => { meses[Math.min(i + 1, meses.length - 1)].entradas += v })

  // Antecipação: puxa parte dos dois meses seguintes para o primeiro, pagando
  // a taxa por mês de antecedência.
  for (let i = 1; i <= 2 && i < meses.length; i++) {
    const puxado = meses[i].entradas * (c.antecipar / 100)
    meses[i].entradas -= puxado
    meses[0].entradas += puxado * (1 - (c.custoAntecipar / 100) * i)
  }

  // Lançamentos hipotéticos, pontuais ou mensais a partir do mês escolhido.
  for (const mv of movimentos) {
    const valor = Number(mv.valor) || 0
    if (!valor) continue
    const ini = meses.findIndex((m) => m.competencia === mv.mes)
    if (ini === -1) continue
    for (let i = ini; i < meses.length; i++) {
      if (mv.tipo === 'entrada') meses[i].entradas += valor
      else meses[i].saidas += valor
      if (!mv.recorrente) break
    }
  }

  let saldo = base.saldoInicial
  return meses.map((m) => {
    saldo += m.entradas - m.saidas
    return { ...m, liquido: m.entradas - m.saidas, saldo }
  })
}

export function resumoDe(linhas, saldoInicial) {
  const menor = linhas.reduce((a, l) => (l.saldo < a.saldo ? l : a), { saldo: saldoInicial, competencia: null })
  const negativo = linhas.find((l) => l.saldo < 0)
  return { final: linhas.at(-1)?.saldo ?? saldoInicial, menor, negativo }
}

