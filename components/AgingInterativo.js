'use client'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { brl, dataCurta } from '@/lib/format'
import Exportar from '@/components/Exportar'
import Multi from '@/components/MultiSelecao'
import s from './aging.module.css'
import { hojeISO } from '@/lib/hoje'

// O aging inteiro como uma superfície de exploração. Cada clique em filtro vira
// URL na hora (a visão é compartilhável e sobrevive ao F5), sem botão de
// aplicar, e a tela antiga fica apagada enquanto a nova chega.

const PRESETS = [
  ['padrao', '30 · 60 · 90'],
  ['curto', '7 · 15 · 30 · 60'],
  ['longo', '30 · 90 · 180 · 360'],
  ['completo', 'Detalhado'],
]
const FUTURO = [['junto', 'Junto'], ['detalhado', 'Detalhado'], ['nao', 'Ocultar']]
const AGRUPAR = [['pessoa', 'Cliente'], ['categoria', 'Categoria'], ['centro', 'Centro de custo'], ['conta', 'Conta'], ['faixa', 'Só faixas']]

// Cor de cada faixa: o futuro em azuis, o vencido do âmbar ao vermelho,
// ficando mais quente quanto mais velho. A mesma cor pinta a barra, a
// legenda e o calor da matriz, para o olho ligar as três sem ler.
function corDaFaixa(faixa, iVencida, nVencidas, iFutura, nFuturas) {
  if (faixa.futuro) {
    const t = nFuturas <= 1 ? 0.5 : iFutura / (nFuturas - 1)
    return `color-mix(in srgb, #86b6ef ${Math.round(100 - t * 60)}%, #1c5cab)`
  }
  const t = nVencidas <= 1 ? 1 : iVencida / (nVencidas - 1)
  return `color-mix(in srgb, var(--critical) ${Math.round(25 + t * 75)}%, var(--warning))`
}

// Número que conta até o valor ao aparecer. Curto, e desligado para quem
// pediu menos movimento ao sistema.
function useContagem(alvo) {
  const [v, setV] = useState(alvo)
  const anterior = useRef(alvo)
  useEffect(() => {
    const de = anterior.current
    anterior.current = alvo
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || de === alvo) { setV(alvo); return }
    let raf
    const ini = performance.now()
    const passo = (t) => {
      const k = Math.min(1, (t - ini) / 650)
      const e = 1 - Math.pow(1 - k, 3)
      setV(de + (alvo - de) * e)
      if (k < 1) raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(raf)
  }, [alvo])
  return v
}

function Tile({ rotulo, valor, formato = 'brl', nota, tom }) {
  const v = useContagem(Number(valor) || 0)
  const texto = formato === 'brl' ? brl(v)
    : formato === 'pct' ? `${v.toFixed(0)}%`
      : formato === 'num' ? `${Math.round(v)}`
        : `${Math.round(v)} dias`
  return (
    <div className="card tile">
      <div className="label">{rotulo}</div>
      <div className="value">{texto}</div>
      {nota && <div className={`note${tom ? ' ' + tom : ''}`}>{nota}</div>}
    </div>
  )
}

function Segmento({ opcoes, valor, aoMudar, rotulo }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    const b = ref.current?.querySelector('[aria-pressed="true"]')
    if (b) setPos({ left: b.offsetLeft, width: b.offsetWidth })
  }, [valor, opcoes])
  return (
    <div className={s.segmento} ref={ref} role="group" aria-label={rotulo}>
      {pos && <span className={s.indicador} style={{ left: pos.left, width: pos.width }} />}
      {opcoes.map(([k, r]) => (
        <button key={k} type="button" aria-pressed={valor === k} onClick={() => aoMudar(k)}>{r}</button>
      ))}
    </div>
  )
}

export default function AgingInterativo({ filtros: f, opcoes, dados }) {
  const router = useRouter()
  const caminho = usePathname()
  const [pendente, iniciar] = useTransition()
  const [faixaAtiva, setFaixaAtiva] = useState(null)
  const [ordem, setOrdem] = useState('total')
  const [abertas, setAbertas] = useState(() => new Set())
  const [personalizado, setPersonalizado] = useState(f.preset === 'personalizado' ? f.limites.join(', ') : '')
  const [minimo, setMinimo] = useState(f.valorMin ? String(f.valorMin) : '')
  const [copiado, setCopiado] = useState(false)

  // Estado atual da URL, de onde toda mudança parte.
  const atual = useMemo(() => ({
    tipo: f.kind,
    faixas: f.preset === 'personalizado' ? f.limites.join(',') : f.preset,
    futuro: f.futuro,
    agrupar: f.agrupar,
    data: f.dataBase ?? '',
    conta: f.contas.join(','),
    centro: f.centros.join(','),
    categoria: f.categorias.join(','),
    pessoa: f.pessoas.join(','),
    min: f.valorMin ? String(f.valorMin) : '',
  }), [f])

  function mudar(campos) {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...atual, ...campos })) if (v) p.set(k, v)
    // Valores padrão não poluem o link.
    if (p.get('tipo') === 'receivable') p.delete('tipo')
    if (p.get('faixas') === 'padrao') p.delete('faixas')
    if (p.get('futuro') === 'junto') p.delete('futuro')
    if (p.get('agrupar') === 'pessoa') p.delete('agrupar')
    iniciar(() => router.replace(`${caminho}${p.size ? `?${p}` : ''}`, { scroll: false }))
    setAbertas(new Set())
  }

  // Valor mínimo aplica sozinho, depois que a pessoa para de digitar.
  useEffect(() => {
    if (minimo === atual.min) return
    const t = setTimeout(() => mudar({ min: minimo.replace(/\D/g, '') }), 600)
    return () => clearTimeout(t)
  }, [minimo]) // eslint-disable-line react-hooks/exhaustive-deps

  const contas = opcoes.contas.map((c) => ({ id: c.id, rotulo: c.rotulo, extra: c.ativo === false ? 'inativa' : null }))
  const nomes = {
    conta: Object.fromEntries(opcoes.contas.map((c) => [c.id, c.rotulo])),
    centro: Object.fromEntries(opcoes.centros.map((c) => [c.id, c.nome])),
    categoria: Object.fromEntries(opcoes.categorias.map((c) => [c.id, c.nome])),
    pessoa: Object.fromEntries(opcoes.pessoas.map((c) => [c.id, c.nome])),
  }
  const ativos = [
    ...['conta', 'centro', 'categoria', 'pessoa'].flatMap((campo) => {
      const ids = atual[campo] ? atual[campo].split(',') : []
      return ids.map((id) => ({
        chave: `${campo}-${id}`, texto: nomes[campo][id] ?? 'item removido',
        remover: () => mudar({ [campo]: ids.filter((x) => x !== id).join(',') }),
      }))
    }),
    ...(f.valorMin ? [{ chave: 'min', texto: `a partir de ${brl(f.valorMin)}`, remover: () => { setMinimo(''); mudar({ min: '' }) } }] : []),
    ...(f.dataBase ? [{ chave: 'data', texto: `em ${dataCurta(f.dataBase)}`, remover: () => mudar({ data: '' }) }] : []),
  ]

  const { faixas, linhas, totalFaixa, resumo, titulos } = dados
  const vencidas = faixas.filter((x) => !x.futuro)
  const futuras = faixas.filter((x) => x.futuro)
  const cor = Object.fromEntries(faixas.map((x) => [x.chave,
    corDaFaixa(x, vencidas.indexOf(x), vencidas.length, futuras.indexOf(x), futuras.length)]))
  const total = Number(resumo?.aberto ?? 0)
  const maiorCelula = Math.max(1, ...linhas.flatMap((l) => Object.values(l.faixas)))

  const ordenadas = [...linhas].sort((a, b) =>
    ordem === 'total' ? b.total - a.total
      : ordem === 'nome' ? a.chave.localeCompare(b.chave, 'pt-BR')
        : (b.faixas[ordem] ?? 0) - (a.faixas[ordem] ?? 0))

  const pctVencido = total > 0 ? (Number(resumo.vencido) / total) * 100 : 0
  const topo = ordenadas[0]
  const concentracao = total > 0 && topo && f.agrupar !== 'faixa' ? (topo.total / total) * 100 : null

  const linhasExport = ordenadas.map((l) => ({
    chave: l.chave, total: l.total, titulos: l.titulos,
    ...Object.fromEntries(faixas.map((x) => [x.chave, l.faixas[x.chave] ?? 0])),
  }))
  const colunasExport = [
    ['chave', ROTULO_GRUPO[f.agrupar], 'texto'],
    ...faixas.map((x) => [x.chave, x.rotulo, 'dinheiro']),
    ['total', 'Total', 'dinheiro'],
    ['titulos', 'Títulos', 'inteiro'],
  ]

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch { /* navegador sem permissão de área de transferência */ }
  }

  const hoje = hojeISO()

  return (
    <>
      <div className={s.filtros}>
        <div className={s.linha}>
          <div className={s.campo}>
            <span className={s.rotuloCampo}>Carteira</span>
            <Segmento rotulo="Carteira" valor={f.kind}
              opcoes={[['receivable', 'A receber'], ['payable', 'A pagar']]}
              aoMudar={(v) => mudar({ tipo: v, categoria: '', pessoa: '' })} />
          </div>
          <div className={s.campo}>
            <span className={s.rotuloCampo}>Faixas de atraso</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Segmento rotulo="Faixas" valor={f.preset}
                opcoes={[...PRESETS, ['personalizado', 'Minhas faixas']]}
                aoMudar={(v) => (v === 'personalizado'
                  ? setPersonalizado(personalizado || f.limites.join(', '))
                  : (setPersonalizado(''), mudar({ faixas: v })))} />
              {(f.preset === 'personalizado' || personalizado) && (
                <form onSubmit={(e) => { e.preventDefault(); mudar({ faixas: personalizado.replace(/[^\d,]/g, '') }) }}
                  style={{ display: 'flex', gap: 6 }}>
                  <input value={personalizado} onChange={(e) => setPersonalizado(e.target.value)}
                    placeholder="ex.: 10, 45, 120" aria-label="Limites das faixas em dias, separados por vírgula"
                    style={{ width: 150, borderRadius: 9999 }} />
                  <button className="toggle" type="submit">Usar</button>
                </form>
              )}
            </div>
          </div>
          <div className={s.campo}>
            <span className={s.rotuloCampo}>A vencer</span>
            <Segmento rotulo="A vencer" valor={f.futuro} opcoes={FUTURO} aoMudar={(v) => mudar({ futuro: v })} />
          </div>
        </div>

        <div className={s.linha}>
          <div className={s.campo}>
            <span className={s.rotuloCampo}>Agrupar por</span>
            <Segmento rotulo="Agrupar" valor={f.agrupar} opcoes={AGRUPAR} aoMudar={(v) => mudar({ agrupar: v })} />
          </div>
          <div className={s.campo}>
            <span className={s.rotuloCampo}>Filtrar</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Multi rotulo="Contas" opcoes={contas} selecionados={f.contas} aoMudar={(ids) => mudar({ conta: ids.join(',') })} />
              <Multi rotulo="Centros de custo" opcoes={opcoes.centros.map((c) => ({ id: c.id, rotulo: c.nome }))}
                selecionados={f.centros} aoMudar={(ids) => mudar({ centro: ids.join(',') })} />
              <Multi rotulo="Categorias" opcoes={opcoes.categorias.map((c) => ({ id: c.id, rotulo: c.nome }))}
                selecionados={f.categorias} aoMudar={(ids) => mudar({ categoria: ids.join(',') })} />
              <Multi rotulo={f.kind === 'payable' ? 'Fornecedores' : 'Clientes'}
                opcoes={opcoes.pessoas.map((c) => ({ id: c.id, rotulo: c.nome }))}
                selecionados={f.pessoas} aoMudar={(ids) => mudar({ pessoa: ids.join(',') })} />
            </div>
          </div>
          <div className={s.campo}>
            <span className={s.rotuloCampo}>Valor mínimo</span>
            <input inputMode="numeric" placeholder="R$ 0" value={minimo}
              onChange={(e) => setMinimo(e.target.value.replace(/[^\d]/g, ''))} style={{ width: 120, borderRadius: 9999 }} />
          </div>
          <div className={s.campo}>
            <span className={s.rotuloCampo}>Data-base</span>
            <input type="date" value={f.dataBase ?? hoje} min={opcoes.historicoDesde ?? undefined} max={hoje}
              onChange={(e) => mudar({ data: e.target.value === hoje ? '' : e.target.value })}
              style={{ borderRadius: 9999 }} />
          </div>
        </div>

        {(ativos.length > 0) && (
          <div className={s.ativos}>
            {ativos.map((a) => (
              <span key={a.chave} className={s.etiqueta}>
                {a.texto}
                <button type="button" aria-label={`Remover ${a.texto}`} onClick={a.remover}>×</button>
              </span>
            ))}
            <button type="button" className={s.limpar}
              onClick={() => { setMinimo(''); setPersonalizado(''); iniciar(() => router.replace(caminho, { scroll: false })) }}>
              Limpar tudo
            </button>
          </div>
        )}
      </div>

      {f.dataBase && (
        <div className={s.aviso}>
          <span>
            Carteira como o DriveAzul a via em <strong>{dataCurta(f.dataBase)}</strong>, a partir do histórico
            que guardamos de cada título. O Conta Azul não mostra o passado assim.
          </span>
          <button type="button" className="toggle" onClick={() => mudar({ data: '' })}>Voltar para hoje</button>
        </div>
      )}

      <div className={`${s.resultado} ${pendente ? s.carregando : ''}`} aria-busy={pendente}>
        <div className="grid cols-4" style={{ marginBottom: 14 }}>
          <Tile rotulo={f.kind === 'payable' ? 'A pagar em aberto' : 'A receber em aberto'} valor={total}
            nota={`${resumo?.titulos ?? 0} títulos`} />
          <Tile rotulo="Vencido" valor={resumo?.vencido ?? 0}
            nota={`${pctVencido.toFixed(0)}% da carteira · ${resumo?.titulos_vencidos ?? 0} títulos`}
            tom={Number(resumo?.vencido) > 0 ? 'bad' : 'good'} />
          <Tile rotulo="Atraso médio" valor={resumo?.atraso_medio ?? 0} formato="dias"
            nota="ponderado pelo valor, só o vencido" />
          {concentracao !== null
            ? <Tile rotulo="Maior concentração" valor={concentracao} formato="pct"
                nota={topo.chave} tom={concentracao > 40 ? 'warn' : null} />
            : <Tile rotulo="Títulos vencidos" valor={resumo?.titulos_vencidos ?? 0} formato="num" nota="na visão atual" />}
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Como a carteira se distribui</h2>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>passe o mouse numa faixa para destacá-la na tabela</span>
          </div>
          <div className={s.distribuicao} onMouseLeave={() => setFaixaAtiva(null)}>
            {faixas.map((x) => {
              const v = totalFaixa[x.chave] ?? 0
              if (!v) return null
              return (
                <span key={x.chave} className={s.segmentoBarra}
                  data-ativa={faixaAtiva === x.chave}
                  style={{ width: `${(v / Math.max(total, 1)) * 100}%`, background: cor[x.chave] }}
                  title={`${x.rotulo}: ${brl(v)} (${((v / Math.max(total, 1)) * 100).toFixed(1)}%)`}
                  onMouseEnter={() => setFaixaAtiva(x.chave)}
                  onClick={() => setOrdem(x.chave)} />
              )
            })}
          </div>
          <div className={s.legenda}>
            {faixas.map((x) => (
              <span key={x.chave} onMouseEnter={() => setFaixaAtiva(x.chave)} onMouseLeave={() => setFaixaAtiva(null)}
                onClick={() => setOrdem(x.chave)}>
                <i style={{ background: cor[x.chave] }} />
                {x.rotulo} · <strong style={{ color: 'var(--text-primary)' }}>{brl(totalFaixa[x.chave] ?? 0)}</strong>
              </span>
            ))}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <h2 style={{ margin: 0 }}>{f.agrupar === 'faixa' ? 'Por faixa' : `Por ${ROTULO_GRUPO[f.agrupar].toLowerCase()}`}</h2>
              <p className="sub" style={{ margin: '2px 0 0' }}>
                Clique numa linha para ver os títulos. Clique no título de uma coluna para ordenar por ela.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className="toggle" onClick={copiarLink}>{copiado ? 'Link copiado' : 'Copiar link desta visão'}</button>
              <Exportar linhas={linhasExport} colunas={colunasExport} arquivo={`aging-${f.kind === 'payable' ? 'pagar' : 'receber'}`} />
            </div>
          </div>

          {linhas.length === 0 ? (
            <p className="empty">Nada em aberto com esses filtros.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className={s.matriz}>
                <thead>
                  <tr>
                    <th onClick={() => setOrdem('nome')} data-ordem={ordem === 'nome' ? '' : undefined}>
                      {ROTULO_GRUPO[f.agrupar]}
                    </th>
                    {faixas.map((x) => (
                      <th key={x.chave} onClick={() => setOrdem(x.chave)}
                        data-ordem={ordem === x.chave ? '' : undefined}
                        data-coluna-ativa={faixaAtiva === x.chave}
                        onMouseEnter={() => setFaixaAtiva(x.chave)} onMouseLeave={() => setFaixaAtiva(null)}>
                        {x.rotulo}
                      </th>
                    ))}
                    <th onClick={() => setOrdem('total')} data-ordem={ordem === 'total' ? '' : undefined}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenadas.map((l) => {
                    const aberta = abertas.has(l.chave)
                    const dela = aberta ? titulos.filter((t) => t.chave === l.chave) : []
                    return [
                      <tr key={l.chave} className={aberta ? s.aberta : ''}
                        onClick={() => setAbertas((a) => { const n = new Set(a); n.has(l.chave) ? n.delete(l.chave) : n.add(l.chave); return n })}>
                        <td title={l.chave}><span className={s.seta}>›</span>{l.chave}</td>
                        {faixas.map((x) => {
                          const v = l.faixas[x.chave] ?? 0
                          const forca = v / maiorCelula
                          return (
                            <td key={x.chave} data-coluna-ativa={faixaAtiva === x.chave}
                              className={v ? '' : s.celulaVazia}
                              style={v ? { background: `color-mix(in srgb, ${cor[x.chave]} ${Math.round(8 + forca * 52)}%, transparent)` } : undefined}>
                              {v ? brl(v) : '—'}
                            </td>
                          )
                        })}
                        <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{brl(l.total)}</td>
                      </tr>,
                      aberta && (
                        <tr key={`${l.chave}-d`} className={s.detalhe}>
                          <td colSpan={faixas.length + 2}>
                            <div className={s.detalheConteudo}>
                              <table>
                                <tbody>
                                  {dela.slice(0, 15).map((t, k) => (
                                    <tr key={k}>
                                      <td>{dataCurta(t.data_vencimento)}</td>
                                      <td style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {f.agrupar === 'pessoa' ? t.descricao : `${t.pessoa} · ${t.descricao ?? ''}`}
                                      </td>
                                      <td style={{ color: Number(t.dias_atraso) > 0 ? 'var(--critical)' : 'var(--text-muted)' }}>
                                        {Number(t.dias_atraso) > 0 ? `${t.dias_atraso} dias` : 'a vencer'}
                                      </td>
                                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{brl(t.nao_pago)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {dela.length > 15 && (
                                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
                                  Os 15 maiores de {dela.length}. A lista completa está em Contas a pagar e receber.
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      ),
                    ]
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    {faixas.map((x) => <td key={x.chave} data-coluna-ativa={faixaAtiva === x.chave}>{brl(totalFaixa[x.chave] ?? 0)}</td>)}
                    <td>{brl(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

const ROTULO_GRUPO = {
  pessoa: 'Cliente ou fornecedor',
  categoria: 'Categoria',
  centro: 'Centro de custo',
  conta: 'Conta financeira',
  faixa: 'Faixa',
}
