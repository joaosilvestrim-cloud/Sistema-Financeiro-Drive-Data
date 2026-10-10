'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { brl, compacto, rotuloMes } from '@/lib/format'
import s from './simulador.module.css'
import { NEUTRO, calcular, resumoDe } from '@/lib/simuladorCalculo'

// Simulador de caixa.
//
// Tudo roda no navegador sobre a base que o servidor mandou, então mexer numa
// alavanca redesenha na hora, sem ida ao servidor. A linha tracejada é a base
// sem nenhuma alavanca, para a pessoa ver quanto o cenário dela mexe.

// Os quatro cenários com o nome que o cliente usa (reunião de 11/09):
// conservador, base, agressivo e drástico.
const PRESETS = [
  ['base', 'Base', NEUTRO],
  ['conservador', 'Conservador', { ...NEUTRO, atraso: 15, novos: -20, vencidos: 70 }],
  ['agressivo', 'Agressivo', { ...NEUTRO, novos: 30, vencidos: 100 }],
  ['drastico', 'Drástico', { ...NEUTRO, atraso: 30, perda: 100, novos: -50, vencidos: 40 }],
]

const ALAVANCAS = [
  ['atraso', 'Atraso no recebimento', 0, 50, 5, '%', 'parte do que entraria no mês escorrega para o mês seguinte'],
  ['vencidos', 'Vencidos que entram', 0, 100, 10, '%', 'quanto do que já está vencido você acredita receber no mês que vem'],
  ['novos', 'Negócio novo', -60, 60, 10, '%', 'ajuste sobre o que ainda não foi lançado no ERP'],
  ['perda', 'Perda do maior cliente', 0, 100, 25, '%', 'quanto do faturamento do maior cliente deixa de entrar'],
  ['corte', 'Corte de despesa', 0, 40, 5, '%', 'redução sobre todas as saídas previstas'],
  ['antecipar', 'Antecipar recebíveis', 0, 80, 10, '%', 'parte dos dois meses seguintes trazida para agora'],
  ['custoAntecipar', 'Custo da antecipação', 0, 6, 0.5, '% a.m.', 'taxa cobrada por mês antecipado'],
]

const CHAVE_SALVOS = 'driveazul:cenarios'

export default function SimuladorCaixa({ base }) {
  const [c, setC] = useState(NEUTRO)
  const [presetAtivo, setPresetAtivo] = useState('base')
  const [movimentos, setMovimentos] = useState([])
  const [salvos, setSalvos] = useState([])
  const [foco, setFoco] = useState(null)
  const caixa = useRef(null)

  useEffect(() => {
    try { setSalvos(JSON.parse(localStorage.getItem(CHAVE_SALVOS) ?? '[]')) } catch { /* sem armazenamento */ }
  }, [])
  const gravar = (lista) => {
    setSalvos(lista)
    try { localStorage.setItem(CHAVE_SALVOS, JSON.stringify(lista)) } catch { /* sem armazenamento */ }
  }

  const linhaBase = useMemo(() => calcular(base, NEUTRO, []), [base])
  const linhas = useMemo(() => calcular(base, c, movimentos), [base, c, movimentos])
  const r = resumoDe(linhas, base.saldoInicial)
  const rb = resumoDe(linhaBase, base.saldoInicial)

  const mudar = (chave, valor) => { setC((x) => ({ ...x, [chave]: valor })); setPresetAtivo(null) }
  const meses = base.linhas.map((l) => l.competencia)

  // ------------------------------------------------------------ gráfico
  const W = 960, H = 280, M = { t: 16, r: 18, b: 30, l: 64 }
  const sc = [base.saldoInicial, ...linhas.map((l) => l.saldo)]
  const sb = [base.saldoInicial, ...linhaBase.map((l) => l.saldo)]
  const todos = [...sc, ...sb, 0]
  const min = Math.min(...todos), max = Math.max(...todos)
  const folga = (max - min) * 0.12 || 1
  const piso = min - folga, topo = max + folga
  const x = (i) => M.l + (i / Math.max(1, sc.length - 1)) * (W - M.l - M.r)
  const y = (v) => M.t + (H - M.t - M.b) * (1 - (v - piso) / (topo - piso))
  const caminho = (serie) => serie.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const area = `${caminho(sc)} L${x(sc.length - 1).toFixed(1)} ${y(piso).toFixed(1)} L${x(0).toFixed(1)} ${y(piso).toFixed(1)} Z`
  const marcas = [piso + folga, (piso + topo) / 2, topo - folga]
  const rotulos = ['hoje', ...meses.map(rotuloMes)]
  const passoRotulo = Math.ceil(rotulos.length / 12)

  function moverMouse(e) {
    const caixaR = caixa.current.getBoundingClientRect()
    const px = ((e.clientX - caixaR.left) / caixaR.width) * W
    const i = Math.round(((px - M.l) / (W - M.l - M.r)) * (sc.length - 1))
    setFoco(Math.max(0, Math.min(sc.length - 1, i)))
  }

  const diff = r.final - rb.final

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className={s.presets} role="group" aria-label="Cenários prontos">
          {PRESETS.map(([k, rotulo, valores]) => (
            <button key={k} type="button" className={s.preset} aria-pressed={presetAtivo === k}
              onClick={() => { setC(valores); setPresetAtivo(k) }}>
              {rotulo}
            </button>
          ))}
        </div>
        <div className={s.salvos}>
          {salvos.map((sv, k) => (
            <span key={k} className={s.salvo}>
              <button type="button" title="Carregar este cenário"
                onClick={() => { setC(sv.c); setMovimentos(sv.movimentos ?? []); setPresetAtivo(null) }}>{sv.nome}</button>
              <button type="button" aria-label={`Apagar ${sv.nome}`} onClick={() => gravar(salvos.filter((_, j) => j !== k))}>×</button>
            </span>
          ))}
          <button type="button" className="toggle" onClick={() => {
            const nome = window.prompt('Nome do cenário', `Cenário ${salvos.length + 1}`)
            if (nome) gravar([...salvos, { nome: nome.slice(0, 40), c, movimentos }])
          }}>Salvar cenário</button>
        </div>
      </div>

      <div className={s.alavancas}>
        {ALAVANCAS.map(([k, rotulo, mn, mx, passo, un, ajuda]) => (
          <div key={k} className={s.alavanca}>
            <label htmlFor={`alv-${k}`}>{rotulo} <b>{c[k] > 0 && k === 'novos' ? '+' : ''}{c[k]}{un}</b></label>
            <input id={`alv-${k}`} type="range" min={mn} max={mx} step={passo} value={c[k]}
              onChange={(e) => mudar(k, Number(e.target.value))} />
            <small>{ajuda}</small>
          </div>
        ))}
      </div>

      <div className={s.kpis}>
        <div className={s.kpi}>
          <span>Saldo no fim do horizonte</span>
          <b>{brl(r.final)}</b>
          <small className={diff >= 0 ? s.sobe : s.desce}>
            {Math.abs(diff) < 1 ? 'igual à base' : `${diff > 0 ? '+' : ''}${brl(diff)} contra a base`}
          </small>
        </div>
        <div className={s.kpi}>
          <span>Menor saldo</span>
          <b className={r.menor.saldo < 0 ? s.desce : undefined}>{brl(r.menor.saldo)}</b>
          <small style={{ color: 'var(--text-muted)' }}>{r.menor.competencia ? `em ${rotuloMes(r.menor.competencia)}` : 'hoje'}</small>
        </div>
        <div className={s.kpi}>
          <span>Caixa fica negativo</span>
          <b className={r.negativo ? s.desce : s.sobe}>{r.negativo ? rotuloMes(r.negativo.competencia) : 'Não fica'}</b>
          <small style={{ color: 'var(--text-muted)' }}>
            {r.negativo ? `chega a ${brl(r.negativo.saldo)}` : `em nenhum dos ${linhas.length} meses`}
          </small>
        </div>
        <div className={s.kpi}>
          <span>Resultado do período</span>
          <b>{brl(linhas.reduce((a, l) => a + l.liquido, 0))}</b>
          <small style={{ color: 'var(--text-muted)' }}>entradas menos saídas</small>
        </div>
      </div>

      <div style={{ position: 'relative' }} onMouseLeave={() => setFoco(null)}>
        <svg ref={caixa} viewBox={`0 0 ${W} ${H}`} className={s.grafico} onMouseMove={moverMouse} role="img"
          aria-label="Saldo projetado mês a mês, cenário contra base">
          {marcas.map((v, i) => (
            <g key={i}>
              <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
              <text x={M.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">{compacto(v)}</text>
            </g>
          ))}
          {min < 0 && <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke="var(--critical)" strokeDasharray="4 4" />}
          <path className={s.areaCenario} d={area} fill="color-mix(in srgb, var(--accent) 12%, transparent)" />
          <path d={caminho(sb)} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="5 5" />
          <path className={s.linhaCenario} d={caminho(sc)} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
          {sc.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={foco === i ? 5.5 : 3.2}
              fill={v < 0 ? 'var(--critical)' : 'var(--accent)'} stroke="var(--surface)" strokeWidth="1.5" />
          ))}
          {foco !== null && <line x1={x(foco)} x2={x(foco)} y1={M.t} y2={H - M.b} stroke="var(--axis)" />}
          {rotulos.map((t, i) => (i % passoRotulo === 0 || i === rotulos.length - 1) && (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--text-muted)">{t}</text>
          ))}
        </svg>
        {foco !== null && (
          <div className={s.dica} style={{ left: `${(x(foco) / W) * 100}%`, top: `${(y(sc[foco]) / H) * 100}%` }}>
            <div style={{ fontWeight: 650, marginBottom: 3 }}>{rotulos[foco]}</div>
            <div>Cenário: <b>{brl(sc[foco])}</b></div>
            <div style={{ color: 'var(--text-muted)' }}>Base: {brl(sb[foco])}</div>
          </div>
        )}
      </div>
      <div className="legend" style={{ marginTop: 6 }}>
        <span><i style={{ background: 'var(--accent)' }} />Seu cenário</span>
        <span><i style={{ background: 'var(--text-muted)' }} />Base, sem alavancas</span>
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14 }}>Lançamentos hipotéticos</h3>
            <p className="sub" style={{ margin: '2px 0 0' }}>Contrato novo, contratação, empréstimo, investimento: teste antes de assumir.</p>
          </div>
          <button type="button" className="toggle" onClick={() => setMovimentos((m) => [...m,
            { id: Date.now(), tipo: 'entrada', descricao: '', valor: '', mes: meses[1] ?? meses[0], recorrente: true }])}>
            + Adicionar lançamento
          </button>
        </div>
        <div className={s.movimentos}>
          {movimentos.map((mv) => {
            const set = (campo, v) => setMovimentos((m) => m.map((x) => (x.id === mv.id ? { ...x, [campo]: v } : x)))
            return (
              <div key={mv.id} className={s.movimento}>
                <select value={mv.tipo} onChange={(e) => set('tipo', e.target.value)} aria-label="Tipo">
                  <option value="entrada">Entrada</option>
                  <option value="saida">Saída</option>
                </select>
                <input placeholder="Descrição (ex.: contrato novo)" value={mv.descricao}
                  onChange={(e) => set('descricao', e.target.value)} aria-label="Descrição" />
                <input inputMode="numeric" placeholder="Valor R$" value={mv.valor}
                  onChange={(e) => set('valor', e.target.value.replace(/[^\d]/g, ''))} aria-label="Valor" />
                <select value={mv.mes} onChange={(e) => set('mes', e.target.value)} aria-label="Mês">
                  {meses.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
                </select>
                <select value={mv.recorrente ? 's' : 'n'} onChange={(e) => set('recorrente', e.target.value === 's')} aria-label="Repetição">
                  <option value="s">todo mês</option>
                  <option value="n">só uma vez</option>
                </select>
                <button type="button" className={s.remover} aria-label="Remover lançamento"
                  onClick={() => setMovimentos((m) => m.filter((x) => x.id !== mv.id))}>×</button>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ overflowX: 'auto', marginTop: 22 }}>
        <table>
          <thead>
            <tr>
              <th>Mês</th><th className="num">Entradas</th><th className="num">Saídas</th>
              <th className="num">Líquido</th><th className="num">Saldo ao fim</th><th className="num">Contra a base</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => {
              const d = l.saldo - linhaBase[i].saldo
              return (
                <tr key={l.competencia} onMouseEnter={() => setFoco(i + 1)} onMouseLeave={() => setFoco(null)}>
                  <td>{rotuloMes(l.competencia)}</td>
                  <td className="num">{brl(l.entradas)}</td>
                  <td className="num">{brl(l.saidas)}</td>
                  <td className="num" style={{ color: l.liquido < 0 ? 'var(--critical)' : undefined }}>{brl(l.liquido)}</td>
                  <td className="num" style={{ fontWeight: 650, color: l.saldo < 0 ? 'var(--critical)' : 'var(--text-primary)' }}>{brl(l.saldo)}</td>
                  <td className={`num ${s.delta}`} style={{ color: Math.abs(d) < 1 ? 'var(--text-muted)' : d > 0 ? 'var(--good-text)' : 'var(--critical)' }}>
                    {Math.abs(d) < 1 ? '—' : `${d > 0 ? '+' : ''}${brl(d)}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
