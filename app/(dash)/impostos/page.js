import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import {
  provisao, impostoLancado, classificarCliente, salvarAliquotas,
  competenciasDisponiveis, competenciaPadrao,
} from '@/lib/imposto'
import { brl, rotuloMes } from '@/lib/format'
import Tile from '@/components/Tile'
import RegimeCliente from '@/components/RegimeCliente'
import Exportar from '@/components/Exportar'

export const dynamic = 'force-dynamic'

// Provisão do imposto sobre o faturamento.
//
// O DAS do Simples é pago no mês seguinte sobre o faturamento do mês anterior.
// Então esta tela olha para trás, para o último mês fechado, e diz quanto vai
// sair. É o pedido da Tamires em 05/09.

export default async function Impostos({ searchParams }) {
  const sessao = await requireSession()
  const busca = await searchParams
  const mes = /^\d{4}-\d{2}$/.test(busca?.competencia ?? '')
    ? busca.competencia
    : competenciaPadrao()

  const [p, lancado, meses] = await Promise.all([
    provisao(sessao, mes), impostoLancado(sessao, mes), competenciasDisponiveis(sessao, 12),
  ])

  async function salvarAnexo(formData) {
    'use server'
    const s = await requireSession()
    await classificarCliente(s, String(formData.get('pessoa')), String(formData.get('anexo')))
    revalidatePath('/impostos')
  }

  async function salvarConfig(formData) {
    'use server'
    const s = await requireSession()
    await salvarAliquotas(s, {
      iii: formData.get('iii'), v: formData.get('v'), padrao: formData.get('padrao'),
    })
    revalidatePath('/impostos')
  }

  const totalLancado = lancado.reduce((a, l) => a + Number(l.valor), 0)
  const diferenca = p.imposto - totalLancado
  const linear = p.receita * (p.config.III / 100)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Provisão de impostos</h1>
          <p>
            Sobre o faturamento de {rotuloMes(mes)}, que é a base do que vence no
            mês seguinte.
          </p>
        </div>
        <form method="get" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select name="competencia" defaultValue={mes} style={{ fontSize: 13 }}>
            {meses.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
          </select>
          <button className="toggle" type="submit">Ver</button>
        </form>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Tile label="Provisão do período" valor={brl(p.imposto)}
              nota={`sobre ${brl(p.receita)} de faturamento`} />
        <Tile label="Alíquota média" valor={p.aliquotaMedia ? `${p.aliquotaMedia.toFixed(2)}%` : '—'}
              nota="imposto sobre receita, com os pesos reais" />
        <Tile label="Já lançado no ERP" valor={brl(totalLancado)}
              nota={lancado.length ? lancado.map((l) => l.categoria).join(', ') : 'nada lançado ainda'} />
        <Tile
          label="Diferença" valor={brl(Math.abs(diferenca))}
          nota={Math.abs(diferenca) < 1
            ? 'provisão e lançamento batem'
            : diferenca > 0 ? 'a provisão é maior que o lançado' : 'o lançado é maior que a provisão'}
          tom={Math.abs(diferenca) < 1 ? 'good' : 'warn'}
        />
      </div>

      {p.naoClassificados > 0 && (
        <p style={{
          background: 'color-mix(in srgb, var(--warning) 14%, transparent)',
          border: '1px solid var(--warning)', borderRadius: 8, padding: '10px 14px',
          fontSize: 13, marginTop: 0,
        }}>
          <strong>{p.naoClassificados} cliente(s) sem anexo definido</strong>, entrando
          no padrão (Anexo {p.config.padrao}). Marque quem é Anexo V na tabela abaixo
          e o número se ajusta.
        </p>
      )}

      <div className="grid cols-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <h2>Como o número sai</h2>
          <p className="sub">Por anexo, com a alíquota de cada um.</p>
          <table>
            <thead>
              <tr>
                <th>Anexo</th><th className="num">Clientes</th>
                <th className="num">Faturamento</th><th className="num">Alíquota</th>
                <th className="num">Imposto</th>
              </tr>
            </thead>
            <tbody>
              {p.porAnexo.map((a) => (
                <tr key={a.anexo}>
                  <td>Anexo {a.anexo}</td>
                  <td className="num">{a.clientes}</td>
                  <td className="num">{brl(a.receita)}</td>
                  <td className="num">{a.aliquota}%</td>
                  <td className="num">{brl(a.imposto)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600 }}>
                <td>Total</td>
                <td className="num">{p.clientes.length}</td>
                <td className="num">{brl(p.receita)}</td>
                <td className="num">{p.aliquotaMedia ? `${p.aliquotaMedia.toFixed(2)}%` : '—'}</td>
                <td className="num">{brl(p.imposto)}</td>
              </tr>
            </tbody>
          </table>
          {p.porAnexo.length > 1 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
              Tratar tudo como Anexo {p.config.padrao} daria {brl(linear)}, uma
              diferença de {brl(Math.abs(p.imposto - linear))}.
            </p>
          )}
        </div>

        <div className="card">
          <h2>Alíquotas</h2>
          <p className="sub">
            O Simples é progressivo sobre a receita dos últimos 12 meses. Estes
            valores são a alíquota efetiva de hoje, e mudam quando a empresa troca
            de faixa. Confira com a contabilidade.
          </p>
          <form action={salvarConfig} style={{ display: 'grid', gap: 10, maxWidth: 320 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Anexo III, em %
              <input type="text" name="iii" defaultValue={p.config.III}
                     inputMode="decimal" style={{ width: '100%', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Anexo V, em %
              <input type="text" name="v" defaultValue={p.config.V}
                     inputMode="decimal" style={{ width: '100%', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Anexo de quem não foi classificado
              <select name="padrao" defaultValue={p.config.padrao}
                      style={{ width: '100%', marginTop: 4 }}>
                <option value="III">Anexo III</option>
                <option value="V">Anexo V</option>
              </select>
            </label>
            <button className="btn" type="submit">Salvar alíquotas</button>
          </form>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
          <h2>Faturamento por cliente</h2>
          <Exportar
            linhas={p.clientes} arquivo={`provisao-imposto-${mes}`}
            colunas={[
              ['cliente', 'Cliente', 'texto'],
              ['anexo', 'Anexo', 'texto'],
              ['receita', 'Faturamento', 'dinheiro'],
              ['aliquota', 'Alíquota em %', 'numero'],
              ['imposto', 'Imposto', 'dinheiro'],
              ['titulos', 'Títulos', 'inteiro'],
            ]}
          />
        </div>
        <p className="sub">
          O anexo é decidido pela atividade e pelo fator R de cada contrato, não
          pela empresa. Por isso ele é marcado cliente a cliente, e fica guardado
          para os próximos meses.
        </p>
        <RegimeCliente clientes={p.clientes} acao={salvarAnexo} padrao={p.config.padrao} />
      </div>

      {lancado.length > 0 && (
        <div className="card">
          <h2>Imposto lançado no ERP em {rotuloMes(mes)}</h2>
          <p className="sub">
            Para conferir a provisão contra o que já entrou. Diferença grande
            costuma ser competência trocada ou lançamento que ainda não foi feito.
          </p>
          <table>
            <thead>
              <tr><th>Categoria</th><th className="num">Títulos</th><th className="num">Valor</th></tr>
            </thead>
            <tbody>
              {lancado.map((l, i) => (
                <tr key={i}>
                  <td>{l.categoria}</td>
                  <td className="num">{l.titulos}</td>
                  <td className="num">{brl(l.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
        A base é o faturamento em competência, tenha o cliente pago ou não, e só
        entra o que está classificado como receita operacional em{' '}
        <Link href="/precificacao">Preço e custo</Link>. Rendimento financeiro e
        movimento não operacional ficam de fora.
      </p>
    </>
  )
}
