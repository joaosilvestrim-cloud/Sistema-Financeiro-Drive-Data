import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { prepararFatura, enviarFatura, historicoImportacoes } from '@/lib/faturaServidor'
import { brl, dataCurta } from '@/lib/format'
import RevisaoFatura from '@/components/RevisaoFatura'

export const dynamic = 'force-dynamic'

// Importar fatura de cartão.
//
// O cartão costuma entrar no ERP como uma linha só por mês, e aí o DRE diz que
// a empresa gastou tudo numa categoria. Aqui cada compra vira um lançamento
// próprio, categorizado, e nasce dentro do Conta Azul, que continua sendo a
// fonte da verdade.

export default async function Fatura() {
  const sessao = await requireSession()
  const historico = await historicoImportacoes(sessao, 25)

  async function analisar(formData) {
    'use server'
    const s = await requireSession()
    const arquivo = formData.get('arquivo')
    let texto = String(formData.get('colado') || '')
    if (arquivo && typeof arquivo.text === 'function' && arquivo.size > 0) {
      texto = await arquivo.text()
    }
    return prepararFatura(s, texto)
  }

  async function enviar(dados) {
    'use server'
    const s = await requireSession()
    const r = await enviarFatura(s, dados)
    revalidatePath('/fatura')
    return r
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Importar fatura de cartão</h1>
          <p>
            Cada compra vira um lançamento categorizado dentro do Conta Azul.
          </p>
        </div>
      </div>

      <RevisaoFatura analisar={analisar} enviar={enviar} />

      {historico.length > 0 && (
        <div className="card" style={{ marginTop: 14, overflowX: 'auto' }}>
          <h2>Já importado</h2>
          <p className="sub">
            Estas compras já foram enviadas ao ERP. Subir o mesmo arquivo de novo não as duplica.
          </p>
          <table>
            <thead>
              <tr>
                <th>Compra</th><th>Descrição</th><th>Categoria</th>
                <th className="num">Valor</th><th>Situação</th><th>Enviado em</th>
              </tr>
            </thead>
            <tbody>
              {historico.map((h, i) => (
                <tr key={i}>
                  <td>{dataCurta(h.data_compra)}</td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.descricao}
                  </td>
                  <td>{h.categoria ?? '—'}</td>
                  <td className="num">{brl(h.valor)}</td>
                  <td style={{ color: h.status === 'erro' ? 'var(--critical)' : undefined }}>
                    {h.status}{h.erro ? ` · ${h.erro.slice(0, 60)}` : ''}
                  </td>
                  <td>{dataCurta(h.criado_em)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <h2>O que acontece quando você confirma</h2>
        <p className="sub">Vale ler antes da primeira vez.</p>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'grid', gap: 8 }}>
          <p style={{ margin: 0 }}>
            Cada linha marcada vira uma conta a pagar no Conta Azul, com a data da compra como
            competência, o vencimento da fatura como vencimento e a categoria que você escolheu.
          </p>
          <p style={{ margin: 0 }}>
            <strong>A API da Conta Azul não tem como apagar um lançamento.</strong> Se algo entrar
            errado, o conserto é manual, dentro do ERP. Por isso a revisão vem antes e nada é
            enviado sem você marcar.
          </p>
          <p style={{ margin: 0 }}>
            Cada compra recebe uma impressão digital com data, descrição, valor e ordem de
            ocorrência. Subir o mesmo arquivo duas vezes não cria despesa duplicada.
          </p>
          <p style={{ margin: 0 }}>
            Créditos da fatura, como o pagamento da fatura anterior, são ignorados: eles não são
            despesa e já aparecem no extrato da conta corrente.
          </p>
        </div>
      </div>
    </>
  )
}
