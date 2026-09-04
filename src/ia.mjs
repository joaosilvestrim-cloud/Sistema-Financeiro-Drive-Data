// Cliente da Groq.
//
// Fica em src para o worker poder gerar análise de madrugada com o mesmo código
// que a tela usa quando alguém clica em gerar.

const URL = 'https://api.groq.com/openai/v1/chat/completions'

// gpt-oss-120b é o mais capaz disponível na conta e tem 131k de contexto, folga
// de sobra para o dossiê inteiro. Fica configurável porque catálogo de modelo
// muda sozinho e não queremos redeploy por causa disso.
export const MODELO = process.env.GROQ_MODEL || 'openai/gpt-oss-120b'

// max_tokens inclui os tokens de raciocinio do modelo, nao so a resposta. Com
// teto curto ele gasta o orcamento pensando e devolve conteudo vazio, sem erro
// nenhum: a chamada volta 200 e o texto some. Por isso o teto e folgado.
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

// O plano gratuito da Groq limita tokens por minuto, e cada analise consome
// alguns milhares. Duas perguntas seguidas ja estouram. A propria resposta do
// 429 diz quanto esperar, entao esperamos e tentamos de novo uma vez: para
// quem clicou, isso vira uma pausa de alguns segundos em vez de um erro.
function segundosDeEspera(corpo) {
  const m = /try again in ([\d.]+)s/i.exec(corpo)
  const s = m ? Number(m[1]) : 0
  return Number.isFinite(s) && s > 0 ? Math.min(s + 0.5, 30) : 0
}

export async function conversar(mensagens, { temperatura = 0.2, maxTokens = 2500 } = {}) {
  const chave = process.env.GROQ_API_KEY
  if (!chave) throw new Error('Falta GROQ_API_KEY no ambiente')

  const chamar = () => fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO,
      temperature: temperatura,
      max_tokens: maxTokens,
      messages: mensagens,
    }),
  })

  let res = await chamar()
  let corpo = await res.text()

  if (res.status === 429) {
    const espera = segundosDeEspera(corpo)
    if (espera) {
      await dormir(espera * 1000)
      res = await chamar()
      corpo = await res.text()
    }
  }

  if (res.status === 429) {
    const espera = segundosDeEspera(corpo)
    const err = new Error(
      'A conta da IA atingiu o limite de uso por minuto.'
      + (espera ? ` Tente de novo em ${Math.ceil(espera)} segundos.` : ' Tente de novo em instantes.'),
    )
    err.status = 429
    throw err
  }

  if (!res.ok) {
    const err = new Error(`Groq ${res.status}: ${corpo.slice(0, 300)}`)
    err.status = res.status
    throw err
  }

  const j = JSON.parse(corpo)
  const escolha = j.choices?.[0]
  const texto = escolha?.message?.content?.trim()
  if (!texto) {
    const motivo = escolha?.finish_reason === 'length'
      ? 'o modelo gastou o limite de tokens raciocinando e nao sobrou resposta'
      : `finish_reason ${escolha?.finish_reason ?? 'desconhecido'}`
    throw new Error(`A IA respondeu vazio: ${motivo}`)
  }
  return { texto, modelo: j.model ?? MODELO, tokens: j.usage?.total_tokens ?? null }
}

// A regra que sustenta tudo: o modelo nunca calcula, só interpreta.
//
// Todo número que aparece no texto já vem formatado no dossiê. O modelo é
// proibido de fazer conta, de citar valor que não esteja lá e de atribuir causa
// que os dados não mostrem. Sem isso, um relatório financeiro escrito por
// modelo de linguagem é uma armadilha: soa convincente e erra o número.
export const REGRAS = `Você é um analista financeiro escrevendo para o dono de uma empresa pequena.

REGRAS INEGOCIÁVEIS
- Use somente os números do JSON. Todos já vêm formatados: copie exatamente como estão, incluindo "R$" e a pontuação.
- Nunca faça conta. Nunca estime. Nunca cite um valor que não esteja no JSON.
- Nunca invente causa. Se o dado não explica o porquê, diga o que aconteceu sem inventar o motivo.
- Se algo relevante não estiver no JSON, diga que o dado não está disponível.
- Não repita a lista de números. Quem lê já vê os painéis. Diga o que eles significam juntos.

COMO ESCREVER
- Português do Brasil, direto, sem jargão de consultoria e sem entusiasmo artificial.
- Frases curtas. Nada de "é importante notar" ou "vale ressaltar".
- Comece pelo que mais importa, não por um resumo geral.
- Aponte no máximo três coisas. Análise que aponta dez não é lida.
- Quando sugerir uma ação, que seja específica e da alçada de quem lê.`
