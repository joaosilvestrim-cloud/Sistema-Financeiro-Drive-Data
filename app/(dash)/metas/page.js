import { requireSession } from '@/lib/session'
import { realizadoContraMeta, tiposPreenchidos } from '@/lib/indicadoresAux'
import { brl, rotuloMes } from '@/lib/format'
import Tile from '@/components/Tile'
import BarrasMeta from '@/components/charts/BarrasMeta'
import FaltaSerie from '@/components/FaltaSerie'

export const dynamic = 'force-dynamic'

// Realizado contra orçado.
//
// A comparação só é honesta em mês fechado. O mês em curso aparece separado,
// porque cobrar meta de um mês que está no dia 4 não diz nada.

export default async function Metas() {
  const sessao = await requireSession()
  const [linhas, tipos] = await Promise.all([
    realizadoContraMeta(sessao, 12),
    tiposPreenchidos(sessao),
  ])

  const temMeta = tipos.has('meta_receita') || tipos.has('meta_despesa') || tipos.has('meta_resultado')
  const mesAtual = new Date().toISOString().slice(0, 7)
  const fechados = linhas.filter((l) => l.competencia < mesAtual)
  const emCurso = linhas.find((l) => l.competencia === mesAtual)

  const acumular = (chaveReal, chaveMeta) => {
    const comMeta = fechados.filter((l) => l[chaveMeta] != null)
    const real = comMeta.reduce((a, l) => a + Number(l[chaveReal] ?? 0), 0)
    const meta = comMeta.reduce((a, l) => a + Number(l[chaveMeta]), 0)
    return { real, meta, meses: comMeta.length, desvio: meta ? real / meta - 1 : null }
  }

  const receita = acumular('receita', 'meta_receita')
  const despesa = acumular('despesa', 'meta_despesa')
  const resultado = acumular('resultado', 'meta_resultado')

  const pct = (v) => v === null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1).replace('.', ',')}%`

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Metas</h1>
          <p>Realizado contra orçado, mês a mês. Só meses fechados entram no acumulado.</p>
        </div>
      </div>

      {!temMeta ? (
        <FaltaSerie
          titulo="Nenhuma meta cadastrada"
          serie="Meta de receita, Meta de despesa ou Meta de resultado"
          oQueMostra="o desvio de cada mês contra o orçado, em valor e em percentual, com o acumulado do ano"
          exemplo="Crie a série em Dados auxiliares e digite os doze meses, ou cole direto da planilha de orçamento."
        />
      ) : (
        <>
          <div className="grid cols-3" style={{ marginBottom: 14 }}>
            {receita.meses > 0 && (
              <Tile label={`Receita acumulada em ${receita.meses} ${receita.meses === 1 ? 'mês' : 'meses'}`}
                    valor={brl(receita.real)}
                    nota={`meta de ${brl(receita.meta)} · ${pct(receita.desvio)}`}
                    tom={receita.desvio >= 0 ? 'good' : 'bad'} />
            )}
            {despesa.meses > 0 && (
              <Tile label={`Despesa acumulada em ${despesa.meses} ${despesa.meses === 1 ? 'mês' : 'meses'}`}
                    valor={brl(despesa.real)}
                    nota={`meta de ${brl(despesa.meta)} · ${pct(despesa.desvio)}`}
                    tom={despesa.desvio <= 0 ? 'good' : 'bad'} />
            )}
            {resultado.meses > 0 && (
              <Tile label="Resultado acumulado" valor={brl(resultado.real)}
                    nota={`meta de ${brl(resultado.meta)} · ${pct(resultado.desvio)}`}
                    tom={resultado.desvio >= 0 ? 'good' : 'bad'} />
            )}
          </div>

          {emCurso && (emCurso.meta_receita != null || emCurso.meta_despesa != null) && (
            <p style={{
              border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px',
              fontSize: 13, marginTop: 0, background: 'var(--surface)',
            }}>
              <strong>{rotuloMes(mesAtual)} ainda está em curso.</strong>{' '}
              {emCurso.meta_receita != null && (
                <>Receita de {brl(emCurso.receita)} contra meta de {brl(emCurso.meta_receita)}. </>
              )}
              Fica fora do acumulado até fechar.
            </p>
          )}

          {tipos.has('meta_receita') && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h2>Receita contra meta</h2>
              <p className="sub">Desvio marcado no gráfico quando passa de 5%.</p>
              <BarrasMeta dados={fechados} chaveReal="receita" chaveMeta="meta_receita"
                          rotuloReal="Receita" rotuloMeta="Meta" />
            </div>
          )}

          {tipos.has('meta_despesa') && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h2>Despesa contra meta</h2>
              <p className="sub">Aqui gastar menos que o previsto é bom, e a cor acompanha isso.</p>
              <BarrasMeta dados={fechados} chaveReal="despesa" chaveMeta="meta_despesa"
                          rotuloReal="Despesa" rotuloMeta="Meta" inverter />
            </div>
          )}

          {tipos.has('meta_resultado') && (
            <div className="card">
              <h2>Resultado contra meta</h2>
              <p className="sub">Receita menos despesa, em regime de competência.</p>
              <BarrasMeta dados={fechados} chaveReal="resultado" chaveMeta="meta_resultado"
                          rotuloReal="Resultado" rotuloMeta="Meta" />
            </div>
          )}
        </>
      )}
    </>
  )
}
