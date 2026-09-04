import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { responder, ultimasPerguntas, SUGESTOES } from '@/lib/pergunta'
import { dataCurta } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function Perguntar({ searchParams }) {
  const sessao = await requireSession()
  const busca = await searchParams
  const historico = await ultimasPerguntas(sessao, 8)

  async function enviar(formData) {
    'use server'
    const s = await requireSession()
    const r = await responder(s, formData.get('pergunta'))
    revalidatePath('/perguntar')
    if (r.erro) return
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Perguntar</h1>
          <p>Pergunte sobre os números da empresa em português.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <form action={enviar} style={{ display: 'grid', gap: 10 }}>
          <textarea
            name="pergunta"
            rows={3}
            required
            maxLength={500}
            defaultValue={busca?.q ?? ''}
            placeholder="Por exemplo: qual cliente concentra mais risco hoje?"
            style={{
              fontFamily: 'inherit', fontSize: 14, padding: 12, borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-primary)', resize: 'vertical',
            }}
          />
          <div>
            <button className="btn" type="submit">Perguntar</button>
          </div>
        </form>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            Exemplos que têm resposta nos dados de hoje
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SUGESTOES.map((s) => (
              <a key={s} href={`/perguntar?q=${encodeURIComponent(s)}`} className="toggle">{s}</a>
            ))}
          </div>
        </div>
      </div>

      {historico.map((h) => (
        <div className="card" key={h.id} style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{h.pergunta}</div>
          <div style={{
            fontSize: 14, lineHeight: 1.6, marginTop: 8,
            borderLeft: '3px solid var(--series-1)', paddingLeft: 14,
          }}>
            {h.resposta}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
            {dataCurta(h.criado_em)} · {new Date(h.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      ))}

      {historico.length === 0 && (
        <p className="empty">Nenhuma pergunta ainda. Escreva a sua acima ou clique num exemplo.</p>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Como isto funciona, e por que assim</h2>
        <p className="sub">Vale saber antes de decidir alguma coisa com a resposta.</p>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'grid', gap: 8 }}>
          <p style={{ margin: 0 }}>
            A IA <strong>não tem acesso ao banco de dados</strong> e não escreve consulta nenhuma.
            Ela recebe um conjunto de números que o sistema já calculou, os mesmos que aparecem nas
            telas, e responde só com aquilo.
          </p>
          <p style={{ margin: 0 }}>
            O caminho comum, deixar a IA escrever a consulta ao banco, foi descartado de propósito.
            O jeito como ele falha é ruim demais para um sistema financeiro: uma consulta
            sutilmente errada devolve um número plausível e ninguém percebe. Aqui o pior caso é ela
            dizer que não tem o dado, o que dá para corrigir.
          </p>
          <p style={{ margin: 0 }}>
            Por isso ela responde bem sobre resultado, margem, comparação com o ano anterior,
            inadimplência, prazos, concentração de cliente e desvios de categoria. Para um recorte
            que não está nesse conjunto, ela vai dizer que não tem, em vez de estimar.
          </p>
          <p style={{ margin: 0 }}>
            Cada pergunta fica guardada com a resposta e com os números que estavam disponíveis
            naquele momento.
          </p>
        </div>
      </div>
    </>
  )
}
