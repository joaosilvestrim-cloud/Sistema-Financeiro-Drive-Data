import { SITUACOES } from './razao.js'
import { hojeUTC } from './hoje.js'

// O recorte da tela de Contas lido da URL. Mora fora da página porque a
// exportação usa exatamente o mesmo: se a tela e o arquivo lessem a URL cada
// um do seu jeito, um dia o arquivo sairia com outro recorte e ninguém notaria.

export const PERIODOS = [
  ['vencidos', 'vencidos'],
  ['mes', 'este mês'],
  ['30', 'próximos 30 dias'],
  ['90', 'próximos 90 dias'],
  ['tudo', 'tudo'],
]

// Traduz o período escolhido em duas datas. Fica aqui e não no SQL porque o
// rótulo e o intervalo precisam ser a mesma coisa: se a tela diz "próximos 30
// dias" e a consulta faz outra conta, ninguém descobre.
//
// Dia de Brasília, com aritmética em UTC: independe do fuso do servidor.
function intervalo(periodo) {
  const hoje = hojeUTC()
  const iso = (d) => d.toISOString().slice(0, 10)
  const mais = (n) => { const d = new Date(hoje); d.setUTCDate(d.getUTCDate() + n); return d }
  if (periodo === 'vencidos') return { ate: iso(mais(-1)) }
  if (periodo === 'mes') {
    return {
      de: iso(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1))),
      ate: iso(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0))),
    }
  }
  if (periodo === '30') return { de: iso(hoje), ate: iso(mais(30)) }
  if (periodo === '90') return { de: iso(hoje), ate: iso(mais(90)) }
  return {}
}

const DATA = /^\d{4}-\d{2}-\d{2}$/

export function filtrosDaUrl(busca = {}) {
  const tipo = ['receivable', 'payable'].includes(busca?.tipo) ? busca.tipo : 'receivable'
  const situacao = SITUACOES.some(([v]) => v === busca?.situacao) ? busca.situacao : 'aberto'
  const periodo = PERIODOS.some(([v]) => v === busca?.periodo) ? busca.periodo : 'tudo'
  const termo = String(busca?.q ?? '').slice(0, 80)
  const pessoa = busca?.pessoa || null
  const categoria = busca?.categoria || null
  const ordem = busca?.ordem ?? 'vencimento'
  const pagina = Math.max(0, Number(busca?.pagina) || 0)
  const contasSel = String(busca?.conta ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x))

  // O intervalo do período convive com datas soltas na URL, que é como o fluxo
  // de caixa manda para cá: ele conhece o mês exato e não um preset.
  const doPeriodo = intervalo(periodo)
  const de = DATA.test(busca?.de ?? '') ? busca.de : doPeriodo.de
  const ate = DATA.test(busca?.ate ?? '') ? busca.ate : doPeriodo.ate

  return {
    tipo, situacao, periodo, termo, pessoa, categoria, ordem, pagina, contasSel,
    f: { kind: tipo, situacao, busca: termo, pessoa, categoria, ordem, contas: contasSel, de, ate },
  }
}

// As colunas do arquivo, iguais para o botão da tela e para a rota.
export const colunasContas = (tipo) => [
  ['data_vencimento', 'Vencimento', 'data'],
  ['data_competencia', 'Competência', 'data'],
  ['pessoa', tipo === 'receivable' ? 'Cliente' : 'Fornecedor', 'texto'],
  ['pessoa_documento', 'CPF ou CNPJ', 'texto'],
  ['descricao', 'Descrição', 'texto'],
  ['categoria', 'Categoria', 'texto'],
  ['total', 'Total', 'dinheiro'],
  ['pago', 'Pago', 'dinheiro'],
  ['nao_pago', 'Em aberto', 'dinheiro'],
  ['situacao', 'Situação', 'texto'],
  ['dias', 'Dias do vencimento', 'inteiro'],
]
