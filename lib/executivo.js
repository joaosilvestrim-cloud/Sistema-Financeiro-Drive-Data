import 'server-only'
import { q, q1 } from './db.js'
import { escopo } from './escopo.js'

// O resumo executivo, do jeito que o Diogo descreveu na reunião de 04/09.
//
// A lógica dele é diferente da nossa. A gente montou o painel em torno do mês e
// do ano. Ele disse: "ninguém vai olhar 2 meses para frente para tomar
// decisão", "a ação das pessoas é uma ação de 2 semanas". E antes de olhar
// qualquer número ele quer saber se pode confiar nele, o que se responde pela
// conciliação bancária.
//
// Daí a ordem desta tela: dá para confiar, o que está atrasado, o que acontece
// nestas duas semanas, e com quem.

// Quanto do que já foi pago ainda não foi casado com o extrato do banco.
//
// É a primeira pergunta de quem opera BPO, e o Conta Azul não responde. Enquanto
// há baixa sem conciliar, o saldo do painel é promessa, não fato.
export async function conciliacao(sessao) {
  const { where, params } = escopo(sessao, 's')
  const resumo = await q1(
    `select
       count(*) filter (where s.reconciliacao_external_id is null)      as pendentes,
       coalesce(sum(s.valor) filter (where s.reconciliacao_external_id is null), 0) as valor_pendente,
       count(*) filter (where s.reconciliacao_external_id is not null)  as conciliadas,
       max(s.data_pagamento) filter (where s.reconciliacao_external_id is not null) as ultima_conciliacao,
       max(s.data_pagamento)                                            as ultimo_pagamento,
       min(s.data_pagamento) filter (where s.reconciliacao_external_id is null)     as mais_antiga_pendente
     from core.settlement s
     where ${where}`,
    params,
  )

  const faixas = await q(
    `select
       case
         when current_date - s.data_pagamento <= 7  then 'ate_7'
         when current_date - s.data_pagamento <= 15 then 'd8_15'
         when current_date - s.data_pagamento <= 30 then 'd16_30'
         else 'mais_30'
       end                        as faixa,
       count(*)                   as titulos,
       coalesce(sum(s.valor), 0)  as valor
     from core.settlement s
     where ${where} and s.reconciliacao_external_id is null and s.data_pagamento is not null
     group by 1`,
    params,
  )

  const total = Number(resumo?.pendentes ?? 0) + Number(resumo?.conciliadas ?? 0)
  return {
    ...resumo,
    faixas,
    // Dois números diferentes, e confundir os dois dá leitura errada.
    //
    // O primeiro diz se a equipe está em dia: quantos dias faz desde o último
    // pagamento que alguém conferiu. O segundo diz o tamanho do passivo antigo:
    // há quanto tempo está parada a baixa mais velha sem conciliar. Uma equipe
    // pode estar em dia com o mês e ainda arrastar dois anos de sujeira.
    diasDesdeUltima: resumo?.ultima_conciliacao
      ? Math.floor((Date.now() - new Date(resumo.ultima_conciliacao)) / 86400000)
      : null,
    diasDaMaisAntiga: resumo?.mais_antiga_pendente
      ? Math.floor((Date.now() - new Date(resumo.mais_antiga_pendente)) / 86400000)
      : 0,
    percentualConciliado: total > 0
      ? Math.round((Number(resumo.conciliadas) / total) * 100)
      : null,
  }
}

// Aging dos dois lados na mesma consulta. A tela põe a receber à esquerda e a
// pagar à direita, e é assim que ele lê: o que me devem contra o que eu devo.
export async function agingDuplo(sessao) {
  const { where, params } = escopo(sessao)
  const linhas = await q(
    `select kind, faixa, sum(valor) as valor, sum(titulos) as titulos
       from mart.aging_snapshot
      where ${where}
      group by 1, 2`,
    params,
  )
  const porTipo = (kind) => linhas.filter((l) => l.kind === kind)
  return { receber: porTipo('receivable'), pagar: porTipo('payable') }
}

// Esta semana e a próxima, dia a dia, com o saldo correndo junto.
//
// O saldo acumulado é o ponto. Ver que sexta-feira fica negativo vale mais que
// qualquer total do mês, e é a informação que ele chamou de fuga de caixa: não
// saber se na semana que vem tem dinheiro para pagar quem está na fila.
export async function duasSemanas(sessao) {
  const { where, params } = escopo(sessao)

  const saldo = await q1(
    `select coalesce(sum(saldo_atual), 0) as saldo from mart.kpi_overview where ${where}`,
    params,
  )

  const dias = await q(
    `select
       dia,
       coalesce(entradas_realizadas, 0) + coalesce(entradas_previstas, 0) as entradas,
       coalesce(saidas_realizadas, 0)   + coalesce(saidas_previstas, 0)   as saidas,
       coalesce(entradas_realizadas, 0) + coalesce(saidas_realizadas, 0)  as realizado
     from mart.cashflow_daily
     where ${where}
       and dia >= date_trunc('week', current_date)
       and dia <  date_trunc('week', current_date) + interval '14 days'
     order by dia`,
    params,
  )

  // Preenche o calendário inteiro. Dia sem lançamento também precisa aparecer,
  // senão a linha do saldo pula buracos e o gráfico mente sobre o tempo.
  const inicio = new Date()
  inicio.setHours(0, 0, 0, 0)
  inicio.setDate(inicio.getDate() - ((inicio.getDay() + 6) % 7))

  const mapa = new Map(dias.map((d) => [new Date(d.dia).toISOString().slice(0, 10), d]))
  let corrente = Number(saldo?.saldo ?? 0)
  const hoje = new Date().toISOString().slice(0, 10)
  const serie = []

  for (let i = 0; i < 14; i++) {
    const d = new Date(inicio)
    d.setDate(inicio.getDate() + i)
    const iso = d.toISOString().slice(0, 10)
    const linha = mapa.get(iso)
    const entradas = Number(linha?.entradas ?? 0)
    const saidas = Number(linha?.saidas ?? 0)
    // O saldo de hoje já contém o que passou. Só o futuro move a curva, senão a
    // gente contaria duas vezes o que já entrou na conta.
    if (iso > hoje) corrente += entradas - saidas
    serie.push({
      dia: iso,
      semana: i < 7 ? 'atual' : 'proxima',
      entradas, saidas,
      liquido: entradas - saidas,
      saldo: corrente,
      passado: iso < hoje,
      hoje: iso === hoje,
    })
  }

  const menor = serie.reduce((a, d) => (d.saldo < a.saldo ? d : a), serie[0])
  return {
    saldoHoje: Number(saldo?.saldo ?? 0),
    serie,
    menor,
    // O alarme que ele quer: em que dia o caixa vira, se virar.
    diaNegativo: serie.find((d) => !d.passado && d.saldo < 0) ?? null,
  }
}

// Os dez maiores de cada lado, pelo que está em aberto agora. Ele pediu os dois:
// "meus 10 principais fornecedores, meus 10 principais clientes".
export async function dezMaiores(sessao, kind) {
  const { where, params } = escopo(sessao, 'i')
  return q(
    `select coalesce(p.nome, 'Sem cadastro') as nome,
            sum(i.nao_pago)                                                      as em_aberto,
            sum(i.nao_pago) filter (where i.data_vencimento < current_date)       as vencido,
            min(i.data_vencimento) filter (where i.data_vencimento >= current_date) as proximo_vencimento,
            count(*)                                                             as titulos
       from core.installment i
       left join core.person p on p.id = i.person_id
      where ${where} and i.kind = $${params.length + 1}
        and i.deleted_at is null and coalesce(i.nao_pago, 0) > 0
      group by 1
      order by 2 desc
      limit 10`,
    [...params, kind],
  )
}
