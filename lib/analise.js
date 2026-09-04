import 'server-only'
import { q, q1 } from './db.js'
import { escopo } from './escopo.js'
import { montarDossie } from './dossie.js'
import { mascarar, revelar } from './anonimo.js'
import { conversar, REGRAS, MODELO } from '../src/ia.mjs'

// Análise escrita pela IA sobre o dossiê de fatos.
//
// Guardada por mês. Mês fechado não muda, então gerar de novo a cada visita
// custaria dinheiro e daria um texto diferente para o mesmo fato, o que destrói
// a confiança mais rápido do que um número errado.

export async function analiseSalva(sessao, competencia = null) {
  const { where, params } = escopo(sessao)
  if (competencia) {
    return q1(
      `select * from core.ai_analysis
        where tenant_id = $1 and tipo = 'mensal' and competencia = $${params.length + 1}
          and connection_id is not distinct from $${params.length + 2}
        order by criado_em desc limit 1`,
      [...params.slice(0, 1), competencia, sessao.connectionId],
    )
  }
  return q1(
    `select * from core.ai_analysis
      where tenant_id = $1 and tipo = 'mensal'
        and connection_id is not distinct from $2
      order by competencia desc, criado_em desc limit 1`,
    [sessao.tenantId, sessao.connectionId],
  )
}

export async function gerarAnalise(sessao, competencia = null) {
  if (sessao.conta?.iaHabilitada === false) {
    return { erro: 'As análises de IA estão desligadas nas configurações desta conta.' }
  }

  const fatos = await montarDossie(sessao, competencia)
  if (!fatos) return { erro: 'Ainda não há mês fechado para analisar.' }

  // Nome proprio vira apelido antes de sair para a Groq, e volta ao normal
  // no texto que chega. Ver lib/anonimo.js.
  const { dossie: mascarado, mapa } = mascarar(fatos)

  const pedido = `Analise o mês de ${fatos.mes_analisado} desta empresa.

Escreva de 3 a 5 frases. Comece pelo fato mais importante do mês, compare com o
mês anterior e com o mesmo mês do ano passado quando fizer sentido, e termine
com o que merece atenção agora, olhando a posição de hoje.

Se houver desvio de categoria, inadimplência relevante ou concentração de
cliente que mude a leitura, mencione. Se não houver, não force.

Dados:
${JSON.stringify(mascarado, null, 1)}`

  try {
    const { texto: cru, modelo, tokens } = await conversar([
      { role: 'system', content: REGRAS },
      { role: 'user', content: pedido },
    ], { maxTokens: 2500 })

    // O nome real volta aqui, no servidor. A tela mostra "Coferly"; a Groq viu
    // "Cliente A".
    const texto = revelar(cru, mapa)

    const [salva] = await q(
      `insert into core.ai_analysis
         (tenant_id, connection_id, tipo, competencia, texto, fatos, modelo, tokens, criado_por)
       values ($1, $2, 'mensal', $3, $4, $5, $6, $7, $8)
       on conflict (tenant_id, connection_id, tipo, competencia) do update
         set texto = excluded.texto, fatos = excluded.fatos, modelo = excluded.modelo,
             tokens = excluded.tokens, criado_em = now(), criado_por = excluded.criado_por
       returning *`,
      [
        sessao.tenantId, sessao.connectionId, fatos.competencia, texto,
        JSON.stringify(fatos), modelo, tokens, sessao.user?.id ?? null,
      ],
    )
    return { analise: salva }
  } catch (e) {
    return { erro: e.message.slice(0, 300) }
  }
}

export const modeloEmUso = MODELO
