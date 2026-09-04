import { rotuloMes, dataCurta } from '@/lib/format'

// A análise escrita pela IA.
//
// Três coisas ficam explícitas de propósito: que o texto foi escrito por um
// modelo, sobre qual mês, e com base em quando. Quem lê precisa saber o que
// está lendo para decidir quanto peso dar.
export default function AnaliseIA({ analise, acao, gerando }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
        <div>
          <h2>Leitura do mês</h2>
          <p className="sub">
            {analise
              ? `${rotuloMes(analise.competencia)} · escrito por IA em ${dataCurta(analise.criado_em)} sobre os números apurados`
              : 'Análise escrita por IA sobre os números do último mês fechado.'}
          </p>
        </div>
        {acao && (
          <form action={acao}>
            <button className="toggle" type="submit">
              {analise ? 'Refazer' : 'Gerar análise'}
            </button>
          </form>
        )}
      </div>

      {analise ? (
        <div style={{
          fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary)',
          borderLeft: '3px solid var(--series-1)', paddingLeft: 14, marginTop: 4,
        }}>
          {analise.texto.split(/\n{2,}/).map((p, i) => (
            <p key={i} style={{ margin: i ? '10px 0 0' : 0 }}>{p}</p>
          ))}
        </div>
      ) : (
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>
          Nenhuma análise gerada ainda. Ela lê receita, despesa, margem, comparação com o ano
          anterior, inadimplência, desvios de categoria e concentração de cliente, e aponta no
          máximo três coisas.
        </p>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
        A IA só interpreta. Todo número citado é calculado pelo sistema e entregue pronto a ela,
        que é proibida de fazer conta ou de citar valor que não esteja nos dados. O conjunto exato
        de fatos usado fica guardado junto com o texto.
      </p>
    </div>
  )
}
