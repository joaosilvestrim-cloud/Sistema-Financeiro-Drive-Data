const brlFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
})
const brlCentsFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
})

export const brl = (v) => brlFmt.format(Number(v ?? 0))
export const brlExato = (v) => brlCentsFmt.format(Number(v ?? 0))

// Em eixo e rótulo de barra, o valor cheio polui. 12,4 mil e 1,2 mi bastam.
export function compacto(v) {
  const n = Number(v ?? 0)
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (abs >= 1_000) return `${(n / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// 'YYYY-MM' -> 'set/26'
export function rotuloMes(competencia) {
  if (!competencia) return ''
  const [ano, mes] = competencia.split('-')
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`
}

export function dataCurta(d) {
  if (!d) return '—'
  const dt = d instanceof Date ? d : new Date(d)
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function desde(d) {
  if (!d) return 'nunca'
  const min = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}

export const pct = (v) => `${(Number(v ?? 0) * 100).toFixed(1)}%`
