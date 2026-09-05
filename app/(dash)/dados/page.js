import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { comAviso } from '@/lib/acao'
import Aviso from '@/components/Aviso'
import {
  listarSeries, valoresDaSerie, serie, criarSerie, apagarSerie,
  gravarValores, lerCsv, TIPOS, UNIDADES,
} from '@/lib/auxiliares'
import { brl, rotuloMes } from '@/lib/format'
import GradeMensal from '@/components/GradeMensal'

export const dynamic = 'force-dynamic'

// Meses que a grade oferece para digitar: doze para trás e doze para frente,
// que cobre fechar o ano corrente e orçar o seguinte.
function mesesDaGrade() {
  const hoje = new Date()
  const lista = []
  for (let i = -12; i <= 12; i++) {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + i, 1))
    lista.push(d.toISOString().slice(0, 7))
  }
  return lista
}

export default async function Dados({ searchParams }) {
  const sessao = await requireSession()
  const busca = await searchParams
  const erro = busca?.erro ?? null
  const series = await listarSeries(sessao)
  const selecionada = busca?.serie
    ? await serie(sessao, busca.serie)
    : null
  const valores = selecionada ? await valoresDaSerie(sessao, selecionada.id) : []

  async function nova(formData) {
    'use server'
    const s = await requireSession()
    const tipo = formData.get('tipo') || 'livre'
    const padrao = TIPOS.find((t) => t.chave === tipo)
    const criada = await criarSerie(s, {
      nome: String(formData.get('nome') || '').trim() || padrao?.nome || 'Nova série',
      tipo,
      unidade: formData.get('unidade') || padrao?.unidade || 'numero',
      descricao: formData.get('descricao'),
    })
    revalidatePath('/dados')
    return { id: criada.id }
  }

  async function salvar(formData) {
    'use server'
    await comAviso('/dados', async () => {
    const s = await requireSession()
    const id = formData.get('dataset')
    const pontos = []
    for (const [chave, valor] of formData.entries()) {
      if (!chave.startsWith('m:')) continue
      const competencia = chave.slice(2)
      const bruto = String(valor).trim()
      pontos.push({
        competencia,
        valor: bruto === '' ? null : Number(bruto.replace(/\./g, '').replace(',', '.')),
      })
    }
    await gravarValores(s, id, pontos.filter((p) => p.valor === null || Number.isFinite(p.valor)))
    })
  }

  async function importar(formData) {
    'use server'
    // lerCsv lanca em planilha fora do formato, que e' o caso mais comum aqui:
    // quem importa esta justamente tentando descobrir qual e' o formato.
    await comAviso('/dados', async () => {
      const s = await requireSession()
      const id = formData.get('dataset')
      const arquivo = formData.get('arquivo')
      let texto = String(formData.get('colado') || '')
      if (arquivo && typeof arquivo.text === 'function' && arquivo.size > 0) {
        texto = await arquivo.text()
      }
      const { pontos } = lerCsv(texto)
      if (!pontos.length) {
        throw new Error('Não encontrei nenhum mês com valor nesse arquivo. A primeira coluna precisa ter a competência no formato AAAA-MM.')
      }
      await gravarValores(s, id, pontos, 'csv')
    })
  }

  async function remover(formData) {
    'use server'
    await comAviso('/dados', async () => {
      const s = await requireSession()
      await apagarSerie(s, formData.get('dataset'))
    })
  }

  const meses = mesesDaGrade()
  const porMes = Object.fromEntries(valores.map((v) => [v.competencia, Number(v.valor)]))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dados auxiliares</h1>
          <p>
            Números que não existem no ERP mas mudam a leitura do financeiro: meta, pessoas,
            horas, pipeline, índice econômico.
          </p>
        </div>
      </div>

      <Aviso erro={erro} />

      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        {series.map((s) => (
          <a key={s.id} href={`/dados?serie=${s.id}`} className="card"
             style={selecionada?.id === s.id
               ? { boxShadow: 'inset 0 0 0 2px var(--series-1)' }
               : undefined}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <h2>{s.nome}</h2>
              <span className="badge">{s.unidade}</span>
            </div>
            <p className="sub" style={{ marginTop: 6 }}>
              {TIPOS.find((t) => t.chave === s.tipo)?.nome ?? s.tipo}
            </p>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {s.pontos > 0
                ? `${s.pontos} ${s.pontos === 1 ? 'mês' : 'meses'}, de ${rotuloMes(s.de)} a ${rotuloMes(s.ate)}`
                : 'nenhum valor ainda'}
            </div>
          </a>
        ))}

        <form action={nova} className="card" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
          <h2>Nova série</h2>
          <p className="sub">O tipo liga a série a um indicador pronto.</p>
          <input name="nome" placeholder="Nome, por exemplo Meta de receita 2027" required />
          <select name="tipo" defaultValue="meta_receita">
            {TIPOS.map((t) => <option key={t.chave} value={t.chave}>{t.nome}</option>)}
          </select>
          <select name="unidade" defaultValue="BRL">
            {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <button className="btn" type="submit">Criar</button>
        </form>
      </div>

      {selecionada ? (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
              <div>
                <h2>{selecionada.nome}</h2>
                <p className="sub">
                  Digite mês a mês. Campo vazio apaga o valor. Use vírgula para os centavos.
                </p>
              </div>
              <form action={remover}>
                <input type="hidden" name="dataset" value={selecionada.id} />
                <button className="toggle" type="submit"
                        style={{ color: 'var(--critical)', borderColor: 'var(--critical)' }}>
                  Apagar série
                </button>
              </form>
            </div>

            <form action={salvar}>
              <input type="hidden" name="dataset" value={selecionada.id} />
              <GradeMensal meses={meses} valores={porMes} unidade={selecionada.unidade} />
              <button className="btn" type="submit" style={{ marginTop: 12 }}>Salvar valores</button>
            </form>
          </div>

          <div className="card">
            <h2>Importar de planilha</h2>
            <p className="sub">
              Duas colunas: competência e valor. Aceita ponto e vírgula, vírgula ou tabulação,
              e entende 2026-01, 01/2026 ou jan/26.
            </p>
            <form action={importar} style={{ display: 'grid', gap: 10 }}>
              <input type="hidden" name="dataset" value={selecionada.id} />
              <textarea
                name="colado" rows={5}
                placeholder={'competencia;valor\n2027-01;150000\n2027-02;160000'}
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12, padding: 10, borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text-primary)', resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="file" name="arquivo" accept=".csv,.txt,text/csv" style={{ fontSize: 12 }} />
                <button className="btn" type="submit">Importar</button>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  cole acima ou escolha um arquivo
                </span>
              </div>
            </form>
          </div>
        </>
      ) : (
        <p className="empty">
          {series.length
            ? 'Escolha uma série acima para digitar ou importar os valores.'
            : 'Nenhuma série ainda. Crie a primeira no cartão acima.'}
        </p>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <h2>O que cada tipo destrava</h2>
        <p className="sub">O tipo escolhido determina quais indicadores passam a existir.</p>
        <table>
          <tbody>
            {TIPOS.filter((t) => t.chave !== 'livre').map((t) => (
              <tr key={t.chave}>
                <td style={{ whiteSpace: 'nowrap' }}>{t.nome}</td>
                <td style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>{t.ajuda}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
