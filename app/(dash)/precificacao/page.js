import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import {
  estruturaCusto, categoriasParaClassificar, classificar, receitaPorCliente,
  resultadoPorCentro,
} from '@/lib/precificacao'
import { brl } from '@/lib/format'
import Tile from '@/components/Tile'
import Classificador from '@/components/Classificador'
import Exportar from '@/components/Exportar'

export const dynamic = 'force-dynamic'

// Estrutura de custo e multiplicador de preço.
//
// A pergunta que esta tela responde é a que o Diogo fez: por quanto eu preciso
// vender para não sair no prejuízo. A resposta sai do custo real da empresa, não
// de um chute de margem.

const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`)

export default async function Precificacao() {
  const sessao = await requireSession()
  const [e, categorias, clientes, centros] = await Promise.all([
    estruturaCusto(sessao), categoriasParaClassificar(sessao), receitaPorCliente(sessao, 12, 15),
    resultadoPorCentro(sessao),
  ])

  async function salvarClasse(formData) {
    'use server'
    const s = await requireSession()
    await classificar(s, String(formData.get('categoria')), String(formData.get('classe')))
    revalidatePath('/precificacao')
  }

  const confiavel = e.cobertura >= 0.9
  const totalReceitaClientes = clientes.reduce((a, c) => a + Number(c.receita), 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Preço e estrutura de custo</h1>
          <p>Por quanto você precisa vender, a partir do que a empresa custa de verdade.</p>
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Tile
          label="Multiplicador necessário"
          valor={e.multiplicador ? `${e.multiplicador.toFixed(2)}x` : '—'}
          nota={e.multiplicador
            ? 'sobre o custo direto, para empatar'
            : 'fixo e variável já consomem toda a receita'}
          tom={e.multiplicador ? null : 'bad'}
        />
        <Tile
          label="Multiplicador praticado"
          valor={e.multiplicadorAtual ? `${e.multiplicadorAtual.toFixed(2)}x` : '—'}
          nota={e.multiplicador && e.multiplicadorAtual
            ? (e.multiplicadorAtual >= e.multiplicador ? 'acima do necessário' : 'abaixo do necessário')
            : 'receita sobre custo direto'}
          tom={e.multiplicador && e.multiplicadorAtual
            ? (e.multiplicadorAtual >= e.multiplicador ? 'good' : 'bad')
            : null}
        />
        <Tile
          label="Sobra para o custo direto" valor={pct(e.sobra)}
          nota="do preço, depois de imposto e estrutura"
          tom={e.sobra !== null && e.sobra < 0.2 ? 'bad' : null}
        />
        <Tile
          label="Resultado em 12 meses" valor={brl(e.resultado)}
          nota={`sobre ${brl(e.receita)} de receita`}
          tom={e.resultado > 0 ? 'good' : 'bad'}
        />
      </div>

      {!confiavel && (
        <p style={{
          background: 'color-mix(in srgb, var(--warning) 14%, transparent)',
          border: '1px solid var(--warning)', borderRadius: 8, padding: '10px 14px',
          fontSize: 13, marginTop: 0,
        }}>
          <strong>{brl(e.naoClassificado)} ainda sem classificação</strong>, em{' '}
          {e.titulosNaoClassificados} lançamentos. Enquanto isso, o multiplicador
          é uma estimativa. Classifique as maiores lá embaixo e ele passa a valer.
        </p>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Como o multiplicador sai</h2>
        <p className="sub">
          Sobre cada real que entra, uma parte some antes de sobrar qualquer
          coisa. O que resta é o teto que o custo do que você entrega pode
          ocupar.
        </p>
        <table>
          <thead>
            <tr><th>Sobre a receita</th><th className="num">12 meses</th><th className="num">%</th><th>O que é</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Receita</td><td className="num">{brl(e.receita)}</td><td className="num">100%</td>
              <td style={{ color: 'var(--text-muted)' }}>o que foi faturado</td>
            </tr>
            <tr>
              <td>Custo variável</td><td className="num">−{brl(e.variavel)}</td>
              <td className="num">{pct(e.percentual.variavel)}</td>
              <td style={{ color: 'var(--text-muted)' }}>imposto e comissão, andam com a venda</td>
            </tr>
            <tr>
              <td>Custo fixo</td><td className="num">−{brl(e.fixo)}</td>
              <td className="num">{pct(e.percentual.fixo)}</td>
              <td style={{ color: 'var(--text-muted)' }}>existe mesmo sem vender</td>
            </tr>
            <tr style={{ fontWeight: 600, borderTop: '1px solid var(--border)' }}>
              <td>Sobra para o custo direto</td>
              <td className="num">{brl(e.receita - e.variavel - e.fixo)}</td>
              <td className="num">{pct(e.sobra)}</td>
              <td style={{ color: 'var(--text-muted)' }}>
                {e.multiplicador && `1 ÷ ${pct(e.sobra)} = ${e.multiplicador.toFixed(2)}x`}
              </td>
            </tr>
            <tr>
              <td>Custo direto realizado</td><td className="num">{brl(e.direto)}</td>
              <td className="num">{pct(e.percentual.direto)}</td>
              <td style={{ color: 'var(--text-muted)' }}>o que a entrega consumiu</td>
            </tr>
            {e.naoClassificado > 0 && (
              <tr style={{ color: 'var(--warning)' }}>
                <td>Sem classificação</td><td className="num">{brl(e.naoClassificado)}</td>
                <td className="num">{pct(e.percentual.naoClassificado)}</td>
                <td>não entra na conta enquanto ninguém disser o que é</td>
              </tr>
            )}
          </tbody>
        </table>

        {e.multiplicador && (
          <p style={{ fontSize: 14, marginTop: 14, marginBottom: 14 }}>
            Um serviço que custa <strong>{brl(1000)}</strong> para entregar precisa
            ser vendido por pelo menos{' '}
            <strong>{brl(1000 * e.multiplicador)}</strong> para não dar prejuízo.
            {e.multiplicadorAtual && e.multiplicadorAtual < e.multiplicador && (
              <> Hoje a empresa vende a {e.multiplicadorAtual.toFixed(2)}x, abaixo disso.</>
            )}
          </p>
        )}
      </div>

      <div className="grid cols-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <h2>Ponto de equilíbrio</h2>
          <p className="sub">
            Quanto precisa faturar para o resultado ser zero. Custo fixo dividido
            pela margem de contribuição, que é o que sobra de cada real vendido
            depois do custo direto e do imposto.
          </p>
          <table>
            <tbody>
              <tr>
                <td>Margem de contribuição</td>
                <td className="num">{pct(e.margemContribuicao)}</td>
              </tr>
              <tr>
                <td>Custo fixo em 12 meses</td>
                <td className="num">{brl(e.fixo)}</td>
              </tr>
              <tr style={{ fontWeight: 600 }}>
                <td>Faturamento para empatar, por mês</td>
                <td className="num">
                  {e.pontoEquilibrio ? brl(e.pontoEquilibrio / e.meses) : '—'}
                </td>
              </tr>
              <tr>
                <td>Faturado por mês, na média</td>
                <td className="num">{brl(e.receita / e.meses)}</td>
              </tr>
            </tbody>
          </table>
          {e.pontoEquilibrio && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
              {e.receita / e.meses > e.pontoEquilibrio / e.meses
                ? `A empresa fatura ${brl(e.receita / e.meses - e.pontoEquilibrio / e.meses)} por mês acima do ponto de equilíbrio.`
                : `Faltam ${brl(e.pontoEquilibrio / e.meses - e.receita / e.meses)} por mês para empatar.`}
            </p>
          )}
        </div>

        <div className="card">
          <h2>Resultado operacional</h2>
          <p className="sub">
            EBITDA gerencial: receita menos custo direto, variável e fixo. Juros,
            investimento e movimento não operacional ficam de fora, porque estão
            classificados fora da operação.
          </p>
          <table>
            <tbody>
              <tr><td>Receita em {e.meses} meses</td><td className="num">{brl(e.receita)}</td></tr>
              <tr><td>Custo direto</td><td className="num">−{brl(e.direto)}</td></tr>
              <tr><td>Custo variável</td><td className="num">−{brl(e.variavel)}</td></tr>
              <tr><td>Custo fixo</td><td className="num">−{brl(e.fixo)}</td></tr>
              <tr style={{ fontWeight: 600, borderTop: '1px solid var(--border)' }}>
                <td>EBITDA gerencial</td>
                <td className="num" style={{ color: e.ebitda >= 0 ? 'var(--good-text)' : 'var(--critical)' }}>
                  {brl(e.ebitda)}
                </td>
              </tr>
              <tr><td>Margem</td><td className="num">{pct(e.margemEbitda)}</td></tr>
            </tbody>
          </table>
          {!confiavel && (
            <p style={{ fontSize: 12, color: 'var(--warning)', marginTop: 10, marginBottom: 0 }}>
              Com {brl(e.naoClassificado)} sem classificação, este resultado está
              otimista: o que falta classificar é despesa que ainda não entrou na
              conta.
            </p>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Classificação das categorias</h2>
        <p className="sub">
          O palpite vem do DRE da própria Conta Azul. Onde ele erra ou não existe,
          a decisão é sua, e fica guardada. Ordenado pelo que movimenta mais
          dinheiro, porque são poucas categorias que mudam o número.
        </p>
        <Classificador categorias={categorias} acao={salvarClasse} />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
          <h2>Resultado por centro de custo</h2>
          <Exportar
            linhas={centros} arquivo="resultado-por-centro-de-custo"
            colunas={[
              ['centro', 'Centro de custo', 'texto'],
              ['receita', 'Receita', 'dinheiro'],
              ['despesa', 'Despesa', 'dinheiro'],
              ['resultado', 'Resultado', 'dinheiro'],
              ['titulos', 'Lançamentos', 'inteiro'],
            ]}
          />
        </div>
        <p className="sub">
          Últimos 12 meses fechados. Não é resultado por produto, mas onde o
          centro de custo acompanha a linha de serviço, já responde o que dá
          lucro e o que consome. O que não tem centro aparece separado, e não
          rateado nos outros.
        </p>
        <table>
          <thead>
            <tr>
              <th>Centro de custo</th><th className="num">Receita</th>
              <th className="num">Despesa</th><th className="num">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {centros.map((c, i) => (
              <tr key={i}>
                <td>{c.centro}</td>
                <td className="num">{Number(c.receita) ? brl(c.receita) : '—'}</td>
                <td className="num">{Number(c.despesa) ? brl(c.despesa) : '—'}</td>
                <td className="num" style={{
                  fontWeight: 600,
                  color: Number(c.resultado) >= 0 ? 'var(--good-text)' : 'var(--critical)',
                }}>
                  {brl(c.resultado)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
          <h2>Receita por cliente</h2>
          <Exportar
            linhas={clientes} arquivo="receita-por-cliente"
            colunas={[
              ['cliente', 'Cliente', 'texto'],
              ['receita', 'Receita em 12 meses', 'dinheiro'],
              ['titulos', 'Títulos', 'inteiro'],
            ]}
          />
        </div>
        <p className="sub">
          Últimos 12 meses fechados. Isto é peso na receita, não lucro por
          cliente: o Conta Azul não amarra despesa a cliente, então o custo de
          atender cada um não existe na base. Para chegar lá, seria preciso
          apontar hora ou centro de custo por cliente.
        </p>
        <table>
          <thead>
            <tr><th>Cliente</th><th className="num">Receita</th><th className="num">Participação</th><th className="num">Títulos</th></tr>
          </thead>
          <tbody>
            {clientes.map((c, i) => (
              <tr key={i}>
                <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.cliente}
                </td>
                <td className="num">{brl(c.receita)}</td>
                <td className="num">
                  {totalReceitaClientes > 0
                    ? `${((c.receita / totalReceitaClientes) * 100).toFixed(1)}%`
                    : '—'}
                </td>
                <td className="num">{c.titulos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
