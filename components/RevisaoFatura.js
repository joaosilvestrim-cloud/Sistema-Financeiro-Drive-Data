'use client'
import { useState, useTransition } from 'react'

// Revisão da fatura antes de gravar no ERP.
//
// Tudo aqui existe para evitar um envio errado, porque a API da Conta Azul não
// tem como apagar um lançamento: a linha repetida vem desmarcada e travada, a
// linha sem categoria vem destacada, e o botão diz quantas compras e quanto
// dinheiro vai ser criado.

const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function RevisaoFatura({ analisar, enviar }) {
  const [dados, setDados] = useState(null)
  const [linhas, setLinhas] = useState([])
  const [conta, setConta] = useState('')
  const [pessoa, setPessoa] = useState('')
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState(null)
  const [pendente, iniciar] = useTransition()

  function aoAnalisar(formData) {
    setErro(''); setResultado(null)
    iniciar(async () => {
      const r = await analisar(formData)
      if (r?.erro) { setErro(r.erro); setDados(null); return }
      setDados(r)
      setLinhas(r.linhas.map((l) => ({ ...l, incluir: !l.ja_importada })))
      const cartao = r.contas.find((c) => c.tipo === 'CARTAO_CREDITO') ?? r.contas[0]
      setConta(cartao?.external_id ?? '')
      setPessoa(r.pessoas[0]?.external_id ?? '')
    })
  }

  function aoEnviar() {
    const itens = linhas.filter((l) => l.incluir).map((l) => ({
      impressao: l.impressao,
      data: l.data,
      descricao: l.descricao,
      valor: l.valor,
      categoria_id: l.categoria_id,
      // O vencimento da fatura é o mesmo para todas as compras dela.
      vencimentoISO: vencimentoISO(dados.vencimento, l.data),
    }))
    if (!itens.length) { setErro('Nenhuma linha marcada.'); return }
    setErro('')
    iniciar(async () => {
      const r = await enviar({
        conexaoId: dados.conexaoId,
        vencimento: dados.vencimento,
        itens,
        contaExternalId: conta,
        pessoaExternalId: pessoa,
      })
      if (r?.erro) { setErro(r.erro); return }
      setResultado(r)
      setDados(null)
      setLinhas([])
    })
  }

  const marcadas = linhas.filter((l) => l.incluir)
  const somaMarcada = marcadas.reduce((a, l) => a + l.valor, 0)
  const semCategoria = marcadas.filter((l) => !l.categoria_id).length

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <form action={aoAnalisar} style={{ display: 'grid', gap: 10 }}>
          <textarea
            name="colado" rows={4}
            placeholder="Cole aqui o CSV da fatura, ou escolha o arquivo abaixo"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12, padding: 10, borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-primary)', resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="file" name="arquivo" accept=".csv,.txt,text/csv" style={{ fontSize: 12 }} />
            <button className="btn" type="submit" disabled={pendente}>
              {pendente ? 'Lendo...' : 'Ler fatura'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              nada é gravado nesta etapa
            </span>
          </div>
        </form>
        {erro && (
          <p style={{ color: 'var(--critical)', fontSize: 13, marginBottom: 0 }}>{erro}</p>
        )}
      </div>

      {resultado && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h2>Envio concluído</h2>
          <p className="sub">
            {resultado.resumo.confirmadas} confirmada(s) no ERP,{' '}
            {resultado.resumo.enviadas} aguardando confirmação,{' '}
            {resultado.resumo.repetidas} já existiam,{' '}
            {resultado.resumo.erros} com erro.
          </p>
          {resultado.resultados.filter((r) => r.status === 'erro').map((r, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--critical)' }}>
              {r.descricao}: {r.erro}
            </div>
          ))}
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 0 }}>
            Os lançamentos aparecem no DriveAzul depois da próxima sincronização.
          </p>
        </div>
      )}

      {dados && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h2>Revisão</h2>
          <p className="sub">
            Fatura com vencimento {dados.vencimento} · {dados.resumo.compras} compras,{' '}
            {dados.resumo.repetidas} já importadas antes
            {dados.pagamentos.length > 0 && ` · ${dados.pagamentos.length} crédito(s) ignorado(s)`}
          </p>

          <div className="grid cols-2" style={{ marginBottom: 14, gap: 10 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Conta financeira do cartão
              <select value={conta} onChange={(e) => setConta(e.target.value)}
                      style={{ width: '100%', marginTop: 4 }}>
                {dados.contas.map((c) => (
                  <option key={c.external_id} value={c.external_id}>{c.nome}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Fornecedor padrão
              <select value={pessoa} onChange={(e) => setPessoa(e.target.value)}
                      style={{ width: '100%', marginTop: 4 }}>
                {dados.pessoas.map((p) => (
                  <option key={p.external_id} value={p.external_id}>{p.nome}</option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th>Compra</th><th>Descrição</th>
                  <th className="num">Valor</th><th>Categoria</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={l.impressao} style={l.ja_importada ? { opacity: 0.45 } : undefined}>
                    <td>
                      <input
                        type="checkbox" checked={l.incluir} disabled={l.ja_importada}
                        onChange={(e) => setLinhas((s) =>
                          s.map((x, k) => k === i ? { ...x, incluir: e.target.checked } : x))}
                      />
                    </td>
                    <td>{l.data.split('-').reverse().join('/')}</td>
                    <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.descricao}
                      {l.ja_importada && (
                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · já importada</span>
                      )}
                    </td>
                    <td className="num">{brl(l.valor)}</td>
                    <td>
                      <select
                        value={l.categoria_id ?? ''}
                        onChange={(e) => setLinhas((s) =>
                          s.map((x, k) => k === i ? { ...x, categoria_id: e.target.value || null } : x))}
                        disabled={l.ja_importada}
                        style={{
                          maxWidth: 220, fontSize: 12,
                          borderColor: !l.categoria_id && l.incluir ? 'var(--warning)' : 'var(--border)',
                        }}
                      >
                        <option value="">sem categoria</option>
                        {dados.categorias.map((c) => (
                          <option key={c.id} value={c.id}>{c.nome}</option>
                        ))}
                      </select>
                      {l.motivo && l.categoria_id && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{l.motivo}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {semCategoria > 0 && (
            <p style={{
              background: 'color-mix(in srgb, var(--warning) 14%, transparent)',
              border: '1px solid var(--warning)', borderRadius: 8, padding: '8px 12px',
              fontSize: 13, marginTop: 12, marginBottom: 0,
            }}>
              {semCategoria} compra(s) marcada(s) sem categoria. Elas entram no ERP sem
              classificação e o DRE vai mostrá-las em "Sem classificação".
            </p>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn" onClick={aoEnviar} disabled={pendente || !marcadas.length}>
              {pendente
                ? 'Enviando...'
                : `Criar ${marcadas.length} lançamento(s) no Conta Azul · ${brl(somaMarcada)}`}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              esta ação grava no ERP e não tem desfazer
            </span>
          </div>
        </div>
      )}
    </>
  )
}

// O vencimento vem como "10/09" na fatura, sem ano. O ano sai da compra mais
// recente, e vira o seguinte quando a fatura fecha em dezembro e vence em
// janeiro.
function vencimentoISO(vencimento, dataCompra) {
  const m = /^(\d{2})\/(\d{2})$/.exec(String(vencimento ?? '').trim())
  if (!m) return dataCompra
  const [dia, mes] = [m[1], m[2]]
  const [anoCompra, mesCompra] = dataCompra.split('-')
  const ano = Number(mes) < Number(mesCompra) ? Number(anoCompra) + 1 : Number(anoCompra)
  return `${ano}-${mes}-${dia}`
}
