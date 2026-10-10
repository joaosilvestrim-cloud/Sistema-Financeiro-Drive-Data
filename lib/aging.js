import 'server-only'
import { q, q1 } from './db.js'
import { escopo } from './escopo.js'
import { hojeISO } from './hoje.js'

// Aging configurável.
//
// Pedido do João em 09/10: "várias opções de filtro e customização". O aging
// fixo (a vencer, 1-30, 31-60, 61-90, mais de 90) responde a pergunta média e
// erra as específicas: quem cobra toda semana quer faixas de 7 dias, quem
// provisiona perda quer 180 e 360, quem administra contrato quer ver por
// centro de custo ou por conta de recebimento.
//
// Tudo que vira SQL aqui passa por validação antes: as faixas são números
// inteiros limpos, os ids são uuid e o agrupamento vem de uma lista fechada.
// Nada da URL entra na consulta como texto livre.
//
// A data-base é o que o Conta Azul não tem. Com ela vazia ou igual a hoje, a
// consulta lê o estado atual. Com uma data passada, lê o estado que cada
// título tinha naquele dia, a partir do histórico versionado que guardamos
// desde a primeira sincronização. "Como estava a carteira no fechamento de
// setembro" vira um clique.

export const PRESETS = {
  padrao: { rotulo: '30, 60, 90 dias', limites: [30, 60, 90] },
  curto: { rotulo: 'Semanal: 7, 15, 30, 60', limites: [7, 15, 30, 60] },
  longo: { rotulo: 'Longo prazo: 30, 90, 180, 360', limites: [30, 90, 180, 360] },
  completo: { rotulo: 'Detalhado: 15, 30, 45, 60, 90, 120, 180', limites: [15, 30, 45, 60, 90, 120, 180] },
}

export const AGRUPAMENTOS = {
  pessoa: 'Cliente ou fornecedor',
  categoria: 'Categoria',
  centro: 'Centro de custo',
  conta: 'Conta financeira',
  faixa: 'Só as faixas',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const lista = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : [])
const uuids = (v) => lista(v).map((x) => x.trim()).filter((x) => UUID.test(x))

// Lê e valida tudo que vem da URL. O resto do arquivo só recebe o resultado.
export function lerFiltros(busca = {}) {
  const kind = busca.tipo === 'payable' ? 'payable' : 'receivable'

  let limites = PRESETS[busca.faixas]?.limites ?? null
  let preset = PRESETS[busca.faixas] ? busca.faixas : null
  if (!limites && busca.faixas) {
    const nums = [...new Set(lista(busca.faixas).map((x) => parseInt(x, 10)))]
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 2000)
      .sort((a, b) => a - b)
      .slice(0, 9)
    if (nums.length) { limites = nums; preset = 'personalizado' }
  }
  if (!limites) { limites = PRESETS.padrao.limites; preset = 'padrao' }

  const futuro = ['nao', 'junto', 'detalhado'].includes(busca.futuro) ? busca.futuro : 'junto'
  const agrupar = AGRUPAMENTOS[busca.agrupar] ? busca.agrupar : 'pessoa'

  const hoje = hojeISO()
  const dataBase = /^\d{4}-\d{2}-\d{2}$/.test(busca.data ?? '') && busca.data < hoje ? busca.data : null

  const valorMin = Number(String(busca.min ?? '').replace(',', '.'))

  return {
    kind,
    limites,
    preset,
    futuro,
    agrupar,
    dataBase,
    contas: uuids(busca.conta),
    centros: uuids(busca.centro),
    categorias: uuids(busca.categoria),
    pessoas: uuids(busca.pessoa),
    valorMin: Number.isFinite(valorMin) && valorMin > 0 ? valorMin : 0,
  }
}

// As faixas na ordem de leitura: futuro primeiro (do mais distante ao mais
// perto), depois o vencido do mais novo ao mais velho.
export function faixasDe(f) {
  const out = []
  if (f.futuro === 'junto') out.push({ chave: 'f_tudo', rotulo: 'A vencer', futuro: true })
  if (f.futuro === 'detalhado') {
    const ls = f.limites
    out.push({ chave: `f_${ls.at(-1)}_mais`, rotulo: `Vence em mais de ${ls.at(-1)} dias`, futuro: true })
    for (let k = ls.length - 1; k >= 0; k--) {
      const de = k === 0 ? 0 : ls[k - 1] + 1
      out.push({ chave: `f_${ls[k]}`, rotulo: de === 0 ? `Vence em até ${ls[k]} dias` : `Vence em ${de} a ${ls[k]} dias`, futuro: true })
    }
  }
  f.limites.forEach((l, k) => {
    const de = k === 0 ? 1 : f.limites[k - 1] + 1
    out.push({ chave: `v_${l}`, rotulo: `${de} a ${l} dias`, futuro: false })
  })
  out.push({ chave: `v_${f.limites.at(-1)}_mais`, rotulo: `Mais de ${f.limites.at(-1)} dias`, futuro: false })
  return out
}

// A expressão CASE da faixa. Os limites já são inteiros validados, por isso
// podem entrar como literal; a data-base entra por parâmetro.
function casoFaixa(f, dias) {
  const partes = []
  const ls = f.limites
  if (f.futuro === 'junto') partes.push(`when ${dias} <= 0 then 'f_tudo'`)
  if (f.futuro === 'detalhado') {
    ls.forEach((l) => partes.push(`when ${dias} <= 0 and -${dias} <= ${l} then 'f_${l}'`))
    partes.push(`when ${dias} <= 0 then 'f_${ls.at(-1)}_mais'`)
  }
  ls.forEach((l) => partes.push(`when ${dias} >= 1 and ${dias} <= ${l} then 'v_${l}'`))
  partes.push(`when ${dias} > ${ls.at(-1)} then 'v_${ls.at(-1)}_mais'`)
  return `case ${partes.join(' ')} end`
}

const CHAVE_GRUPO = {
  pessoa: ["coalesce(p.nome, 'Sem cadastro')", 'p.id'],
  categoria: ["coalesce(c.nome, 'Sem categoria')", 'c.id'],
  centro: ["coalesce(cc.nome, 'Sem centro de custo')", 'cc.id'],
  conta: ["coalesce(a.nome, 'Sem conta prevista')", 'a.id'],
  faixa: ["'Total'", 'null::uuid'],
}

// Monta a fonte (estado atual ou estado na data-base) e o filtro. Uma função
// só para os números e para a lista de títulos, pelo mesmo motivo da razão: dois
// filtros escritos duas vezes divergem, e o total deixa de bater com a soma.
function montar(sessao, f) {
  const { where, params } = escopo(sessao, 'i')
  const p = [...params]
  const add = (v) => { p.push(v); return `$${p.length}` }

  // Estado na data-base: a versão válida no fim daquele dia.
  let fonte = 'i'
  let dataRef = 'core.hoje()'
  let juntaVersao = ''
  if (f.dataBase) {
    const fim = add(f.dataBase)
    dataRef = `${fim}::date`
    juntaVersao = `join core.installment_version v on v.installment_id = i.id
       and v.valid_from < ((${fim}::date + 1)::timestamp at time zone 'America/Sao_Paulo')
       and (v.valid_to is null or v.valid_to >= (${fim}::date + 1))`
    fonte = 'v'
  }

  const cond = [where, `i.kind = ${add(f.kind)}`, `coalesce(${fonte}.nao_pago, 0) > 0.009`,
    `${fonte}.data_vencimento is not null`]
  if (!f.dataBase) cond.push('i.deleted_at is null')
  if (f.futuro === 'nao') cond.push(`${fonte}.data_vencimento < ${dataRef}`)
  if (f.contas.length) cond.push(`i.account_id = any(${add(f.contas)}::uuid[])`)
  if (f.centros.length) cond.push(`i.cost_center_id = any(${add(f.centros)}::uuid[])`)
  if (f.categorias.length) cond.push(`i.category_id = any(${add(f.categorias)}::uuid[])`)
  if (f.pessoas.length) cond.push(`i.person_id = any(${add(f.pessoas)}::uuid[])`)
  if (f.valorMin) cond.push(`${fonte}.nao_pago >= ${add(f.valorMin)}`)

  const dias = `(${dataRef} - ${fonte}.data_vencimento)`
  const de = `
     from core.installment i
     ${juntaVersao}
     left join core.person p       on p.id = i.person_id
     left join core.category c     on c.id = i.category_id
     left join core.cost_center cc on cc.id = i.cost_center_id
     left join core.account a      on a.id = i.account_id
    where ${cond.join('\n      and ')}`

  return { de, p, dias, fonte, faixa: casoFaixa(f, dias) }
}

export async function aging(sessao, f) {
  const { de, p, dias, fonte, faixa } = montar(sessao, f)
  const [rotulo, id] = CHAVE_GRUPO[f.agrupar]

  const [celulas, resumo, titulos] = await Promise.all([
    q(`select ${rotulo} as chave, ${id} as chave_id, ${faixa} as faixa,
              sum(${fonte}.nao_pago) as valor, count(*)::int as titulos
         ${de}
        group by 1, 2, 3`, p),
    q1(`select coalesce(sum(${fonte}.nao_pago), 0) as aberto,
               coalesce(sum(${fonte}.nao_pago) filter (where ${dias} >= 1), 0) as vencido,
               count(*)::int as titulos,
               count(*) filter (where ${dias} >= 1)::int as titulos_vencidos,
               round((sum(${fonte}.nao_pago * ${dias}) filter (where ${dias} >= 1)
                 / nullif(sum(${fonte}.nao_pago) filter (where ${dias} >= 1), 0))::numeric, 0) as atraso_medio
          ${de}`, p),
    q(`select ${rotulo} as chave, ${faixa} as faixa, i.descricao,
              ${fonte}.data_vencimento, ${fonte}.nao_pago, coalesce(p.nome, 'Sem cadastro') as pessoa,
              greatest(${dias}, 0) as dias_atraso
         ${de}
        order by ${fonte}.nao_pago desc
        limit 600`, p),
  ])

  // Matriz: uma linha por chave, uma coluna por faixa. Montada aqui para a
  // tela só desenhar, e com o total de cada linha para ordenar.
  const faixas = faixasDe(f)
  const porChave = new Map()
  for (const c of celulas) {
    if (!porChave.has(c.chave)) porChave.set(c.chave, { chave: c.chave, total: 0, titulos: 0, faixas: {} })
    const l = porChave.get(c.chave)
    l.faixas[c.faixa] = Number(c.valor)
    l.total += Number(c.valor)
    l.titulos += c.titulos
  }
  const linhas = [...porChave.values()].sort((a, b) => b.total - a.total)
  const totalFaixa = Object.fromEntries(faixas.map((x) => [x.chave,
    linhas.reduce((s, l) => s + (l.faixas[x.chave] ?? 0), 0)]))

  return { faixas, linhas, totalFaixa, resumo, titulos }
}

// O que os seletores oferecem. Só o que existe no escopo, e com o nome da
// empresa ao lado da conta quando há mais de uma empresa na visão, porque
// duas contas "Inter - Conta Corrente" de empresas diferentes são contas
// diferentes.
export async function opcoesAging(sessao, kind) {
  const { where, params } = escopo(sessao, 'x')
  const multi = !sessao.connectionId && (sessao.conexoes?.length ?? 0) > 1
  const [contas, centros, categorias, pessoas, inicio] = await Promise.all([
    q(`select x.id, x.nome, x.tipo, x.ativo, cn.nome as empresa
         from core.account x join core.connection cn on cn.id = x.connection_id
        where ${where}
        order by x.ativo desc nulls last, x.nome`, params),
    q(`select x.id, x.nome from core.cost_center x where ${where} order by x.nome`, params),
    q(`select distinct c.id, c.nome
         from core.installment x join core.category c on c.id = x.category_id
        where ${where} and x.kind = $${params.length + 1} and x.deleted_at is null
          and coalesce(x.nao_pago, 0) > 0.009
        order by c.nome`, [...params, kind]),
    q(`select distinct pe.id, pe.nome
         from core.installment x join core.person pe on pe.id = x.person_id
        where ${where} and x.kind = $${params.length + 1} and x.deleted_at is null
          and coalesce(x.nao_pago, 0) > 0.009
        order by pe.nome limit 400`, [...params, kind]),
    q1(`select (min(valid_from) at time zone 'America/Sao_Paulo')::date as desde from core.installment_version x where ${where}`, params),
  ])
  return {
    contas: contas.map((c) => ({ ...c, rotulo: multi ? `${c.nome} · ${c.empresa}` : c.nome })),
    centros, categorias, pessoas,
    historicoDesde: inicio?.desde ?? null,
  }
}
