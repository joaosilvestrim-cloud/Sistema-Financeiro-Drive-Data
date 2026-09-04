import 'server-only'
import { cache } from 'react'
import { q, q1 } from './db.js'
import { montarDossie } from './dossie.js'
import { conversar, REGRAS } from '../src/ia.mjs'

// Uma frase de leitura para cada indicador do sistema.
//
// Três decisões que sustentam isso:
//
// 1. Uma chamada só, para todos os indicadores. Um bullet por chamada seriam
//    mais de dez por tela, o que estoura o limite da conta e sai caro. Com uma
//    chamada os bullets também saem coerentes entre si: o modelo vê o conjunto
//    e não diz que o caixa está confortável num e apertado no outro.
//
// 2. Guardado por referência do dado. Enquanto o último sync e o dia não mudam,
//    o texto guardado continua valendo. Sem isso, o mesmo indicador ganharia
//    uma frase diferente a cada visita, o que destrói a confiança.
//
// 3. O modelo continua proibido de calcular. Ele recebe os números prontos e
//    devolve interpretação. Se o bullet cita um valor, o valor veio de nós.

// A ordem aqui é a ordem em que os bullets são pedidos, e as descrições dizem
// ao modelo o que cada indicador significa. Sem isso ele interpreta "ciclo
// financeiro" como qualquer coisa.
const INDICADORES = {
  saldo: 'Saldo somado das contas financeiras hoje.',
  a_receber: 'Total a receber em aberto, incluindo o que já venceu.',
  a_pagar: 'Total a pagar em aberto.',
  folego: 'Quantos meses de despesa o saldo de hoje cobre, sem contar receita futura.',
  saldo_projetado: 'Saldo previsto ao fim do horizonte de projeção.',
  menor_saldo: 'O ponto mais baixo do saldo dentro do horizonte projetado.',
  resultado_projetado: 'Entradas previstas menos saidas previstas no horizonte da projecao, o campo resultado_previsto.',
  prazo_receber: 'Dias médios entre a competência e o dinheiro entrar.',
  prazo_pagar: 'Dias médios entre a competência e o dinheiro sair.',
  // A descricao precisa dizer quem financia quem. Com "positivo significa
  // financiar o cliente" a IA escreveu "cliente financia a empresa", que e o
  // contrario. Ambiguidade na descricao vira inversao de sentido no bullet.
  ciclo: 'Prazo de receber menos prazo de pagar. Positivo significa que a empresa paga os fornecedores antes de receber dos clientes, ou seja, a empresa financia o cliente com o proprio caixa.',
  concentracao: 'Índice HHI de concentração da carteira de clientes. Acima de 0,25 é concentrada.',
  vencido: 'Valor já vencido e ainda não recebido.',
  margem: 'Margem do último mês fechado, resultado sobre receita.',
  crescimento: 'Variação da receita contra o mesmo mês do ano anterior.',
}

const PEDIDO = `Escreva uma frase curta de leitura para cada indicador listado.

FORMATO
Responda apenas um objeto JSON, sem texto antes ou depois, com uma chave por
indicador e uma string como valor.

CADA FRASE
- No máximo 14 palavras. Uma frase, sem ponto final duplo.
- Diga o que o número significa para a empresa, não o que ele é.
- Não repita o valor que já aparece no painel, a menos que a comparação com
  outro número seja o ponto.
- Se o número for confortável, diga isso em vez de inventar preocupação.
- Se faltar dado para interpretar um indicador, use exatamente: "sem base para
  interpretar".

Exemplos do tom certo:
"Cobre menos de dois meses de despesa, pouca folga para imprevisto"
"Recebe antes de pagar, o giro se financia sozinho"
"Carteira diluída, nenhum cliente derruba o faturamento sozinho"`

// Muda quando o dado muda: dia e último sync. Enquanto for a mesma, o texto
// guardado vale.
function referenciaDe(sessao, dossie) {
  const sync = sessao.conexoes
    .map((c) => c.last_sync_at)
    .filter(Boolean)
    .sort()
    .at(-1)
  const dia = new Date().toISOString().slice(0, 10)
  return `${dia}|${sync ?? 'sem-sync'}|${dossie.competencia}|${sessao.connectionId ?? 'todas'}`
}

async function gerar(sessao, dossie, referencia) {
  const { texto, modelo, tokens } = await conversar([
    { role: 'system', content: REGRAS },
    {
      role: 'user',
      content: `${PEDIDO}\n\nIndicadores a comentar:\n${JSON.stringify(INDICADORES, null, 1)}`
        + `\n\nDados apurados:\n${JSON.stringify(dossie, null, 1)}`,
    },
  ], { maxTokens: 2500 })

  // O modelo às vezes embrulha o JSON em cerca de código. Melhor limpar do que
  // perder a resposta inteira por causa de três crases.
  const limpo = texto.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const inicio = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (inicio === -1 || fim === -1) throw new Error('A IA não devolveu JSON')

  const bullets = JSON.parse(limpo.slice(inicio, fim + 1))
  // Só entram chaves que a gente pediu. Chave inventada não vira bullet.
  const filtrados = Object.fromEntries(
    Object.entries(bullets)
      .filter(([k, v]) => k in INDICADORES && typeof v === 'string' && v.trim())
      .map(([k, v]) => [k, v.trim()]),
  )

  const [salvo] = await q(
    `insert into core.ai_insight
       (tenant_id, connection_id, referencia, bullets, fatos, modelo, tokens)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (tenant_id, connection_id, referencia) do update
       set bullets = excluded.bullets, fatos = excluded.fatos,
           modelo = excluded.modelo, tokens = excluded.tokens, criado_em = now()
     returning *`,
    [
      sessao.tenantId, sessao.connectionId, referencia,
      JSON.stringify(filtrados), JSON.stringify(dossie), modelo, tokens,
    ],
  )
  return salvo
}

// Memoizado por requisição: as quatro telas que usam bullets chamam isto de
// forma independente e não podem disparar quatro chamadas à IA.
export const insights = cache(async function insights(sessao) {
  if (!process.env.GROQ_API_KEY) return {}
  try {
    const dossie = await montarDossie(sessao)
    if (!dossie) return {}

    const referencia = referenciaDe(sessao, dossie)
    const salvo = await q1(
      `select bullets from core.ai_insight
        where tenant_id = $1 and connection_id is not distinct from $2 and referencia = $3`,
      [sessao.tenantId, sessao.connectionId, referencia],
    )
    if (salvo) return salvo.bullets

    const novo = await gerar(sessao, dossie, referencia)
    return novo.bullets
  } catch {
    // A leitura da IA é um complemento. Se ela falhar, os indicadores continuam
    // na tela sem o bullet, e ninguém fica sem o número por causa disso.
    return {}
  }
})
