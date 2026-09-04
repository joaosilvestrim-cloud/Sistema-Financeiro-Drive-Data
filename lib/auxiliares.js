import 'server-only'
import { q, q1 } from './db'
import { escopo } from './session'
export { lerCsv } from './csv'

// Séries auxiliares: números que o ERP não tem mas que o financeiro precisa
// cruzar com ele. Meta, headcount, horas, pipeline, índice econômico.
//
// O arquivo não se chama aux.js porque `aux` é nome de dispositivo reservado no
// Windows, junto com con, prn e nul. O git nem consegue abrir um arquivo com
// esse nome, e o erro que aparece é "No such file or directory" para um arquivo
// que está ali na frente.

export const TIPOS = [
  { chave: 'meta_receita', nome: 'Meta de receita', unidade: 'BRL',
    ajuda: 'habilita a comparação de realizado contra orçado na receita' },
  { chave: 'meta_despesa', nome: 'Meta de despesa', unidade: 'BRL',
    ajuda: 'mesma comparação do lado da despesa' },
  { chave: 'meta_resultado', nome: 'Meta de resultado', unidade: 'BRL',
    ajuda: 'meta de sobra no mês' },
  { chave: 'headcount', nome: 'Número de pessoas', unidade: 'pessoas',
    ajuda: 'habilita receita e custo por colaborador' },
  { chave: 'horas_faturaveis', nome: 'Horas faturáveis', unidade: 'horas',
    ajuda: 'habilita receita por hora' },
  { chave: 'horas_disponiveis', nome: 'Horas disponíveis', unidade: 'horas',
    ajuda: 'com as faturáveis, habilita a taxa de utilização' },
  { chave: 'pipeline', nome: 'Pipeline comercial', unidade: 'BRL',
    ajuda: 'valor ponderado em negociação, para comparar com a projeção' },
  { chave: 'indice_economico', nome: 'Índice econômico', unidade: 'indice',
    ajuda: 'IPCA, CDI ou câmbio, para ler a receita em termos reais' },
  { chave: 'livre', nome: 'Série livre', unidade: 'numero',
    ajuda: 'qualquer número mensal que você queira acompanhar' },
]

export const UNIDADES = ['BRL', 'numero', 'pessoas', 'horas', 'percentual', 'indice']

export async function listarSeries(sessao) {
  return q(
    `select d.id, d.chave, d.nome, d.tipo, d.unidade, d.descricao,
            count(v.dataset_id)::int as pontos,
            -- Formatado no banco de proposito: a coluna volta como Date e o
            -- String() dela no JavaScript vira "Tue Aug 01 2026", que quebra o
            -- rotulo de mes sem dar erro nenhum.
            to_char(min(v.competencia), 'YYYY-MM') as de,
            to_char(max(v.competencia), 'YYYY-MM') as ate
       from core.aux_dataset d
       left join core.aux_value v on v.dataset_id = d.id
      where d.tenant_id = $1
      group by d.id
      order by d.nome`,
    [sessao.tenantId],
  )
}

export async function valoresDaSerie(sessao, datasetId) {
  return q(
    `select to_char(competencia, 'YYYY-MM') as competencia, dimensao, valor, origem
       from core.aux_value
      where tenant_id = $1 and dataset_id = $2
      order by competencia`,
    [sessao.tenantId, datasetId],
  )
}

export async function serie(sessao, datasetId) {
  return q1(
    `select * from core.aux_dataset where tenant_id = $1 and id = $2`,
    [sessao.tenantId, datasetId],
  )
}

const slug = (texto) => String(texto ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)

export async function criarSerie(sessao, { nome, tipo, unidade, descricao }) {
  const chave = slug(nome) || `serie_${Date.now()}`
  return q1(
    `insert into core.aux_dataset (tenant_id, chave, nome, tipo, unidade, descricao)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (tenant_id, chave) do update
       set nome = excluded.nome, tipo = excluded.tipo,
           unidade = excluded.unidade, descricao = excluded.descricao
     returning *`,
    [sessao.tenantId, chave, nome, tipo, unidade, descricao || null],
  )
}

export async function apagarSerie(sessao, datasetId) {
  await q(`delete from core.aux_dataset where tenant_id = $1 and id = $2`, [sessao.tenantId, datasetId])
}

// Grava vários pontos de uma vez. Valor vazio apaga o ponto, que é como a
// pessoa espera que uma célula limpa se comporte numa planilha.
export async function gravarValores(sessao, datasetId, pontos, origem = 'manual') {
  const validos = pontos.filter((p) => p.competencia)
  if (!validos.length) return { gravados: 0, apagados: 0 }

  const paraApagar = validos.filter((p) => p.valor === null || p.valor === undefined || p.valor === '')
  const paraGravar = validos.filter((p) => !paraApagar.includes(p))

  for (const p of paraApagar) {
    await q(
      `delete from core.aux_value where tenant_id = $1 and dataset_id = $2
        and competencia = ($3 || '-01')::date and dimensao = $4`,
      [sessao.tenantId, datasetId, p.competencia, p.dimensao ?? ''],
    )
  }

  for (const p of paraGravar) {
    await q(
      `insert into core.aux_value (dataset_id, tenant_id, competencia, dimensao, valor, origem)
       values ($1, $2, ($3 || '-01')::date, $4, $5, $6)
       on conflict (dataset_id, competencia, dimensao) do update
         set valor = excluded.valor, origem = excluded.origem, atualizado_em = now()`,
      [datasetId, sessao.tenantId, p.competencia, p.dimensao ?? '', p.valor, origem],
    )
  }

  return { gravados: paraGravar.length, apagados: paraApagar.length }
}

// Junta as séries de meta com o realizado, para a tela de orçado contra feito.
export async function realizadoContraMeta(sessao, meses = 12) {
  const { where, params } = escopo(sessao)
  return q(
    `with realizado as (
       select mes,
              sum(competencia) filter (where kind = 'receivable') as receita,
              sum(competencia) filter (where kind = 'payable')    as despesa
         from mart.monthly_series
        where ${where}
          and mes >= date_trunc('month', current_date) - make_interval(months => ${meses})
          and mes <= date_trunc('month', current_date)
        group by 1
     ),
     metas as (
       select competencia, tipo, sum(valor) as valor
         from mart.aux_mensal
        where tenant_id = $1 and tipo in ('meta_receita', 'meta_despesa', 'meta_resultado')
        group by 1, 2
     )
     select to_char(r.mes, 'YYYY-MM') as competencia,
            r.receita, r.despesa, r.receita - r.despesa as resultado,
            max(m.valor) filter (where m.tipo = 'meta_receita')   as meta_receita,
            max(m.valor) filter (where m.tipo = 'meta_despesa')   as meta_despesa,
            max(m.valor) filter (where m.tipo = 'meta_resultado') as meta_resultado
       from realizado r
       left join metas m on m.competencia = r.mes
      group by 1, 2, 3
      order by 1`,
    params,
  )
}
