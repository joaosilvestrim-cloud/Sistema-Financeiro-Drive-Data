'use client'
import { useState, useTransition } from 'react'

// Credenciais de webhook bancário (TributoStream), geridas pelo próprio
// cliente. O segredo aparece uma única vez, aqui, no momento da criação:
// ele nasce no servidor, volta pela resposta da action e vive só neste
// estado do navegador. Não vai para URL, não vai para o banco em claro e
// não tem tela de "ver de novo". Perdeu, revoga e cria outra.

export default function CredencialBancaria({ lista, criar, revogar, base }) {
  const [nova, setNova] = useState(null)
  const [erro, setErro] = useState('')
  const [rotulo, setRotulo] = useState('')
  const [pendente, startTransition] = useTransition()

  const criarAgora = () => startTransition(async () => {
    setErro('')
    const r = await criar(rotulo)
    if (r?.erro) { setErro(r.erro); return }
    setNova(r)
    setRotulo('')
  })

  const revogarAgora = (id) => startTransition(async () => {
    setErro('')
    const r = await revogar(id)
    if (r?.erro) setErro(r.erro)
  })

  return (
    <>
      {lista.length > 0 && (
        <table style={{ marginBottom: 12 }}>
          <thead>
            <tr><th>Rótulo</th><th>Endereço</th><th>Último uso</th><th /></tr>
          </thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id} style={c.revogado_em ? { color: 'var(--text-muted)' } : undefined}>
                <td>{c.rotulo}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  …/bank/{c.id_publico}
                  {c.revogado_em && ' · revogada'}
                </td>
                <td>{c.ultimo_uso_em ? new Date(c.ultimo_uso_em).toLocaleDateString('pt-BR') : 'nunca'}</td>
                <td style={{ textAlign: 'right' }}>
                  {!c.revogado_em && (
                    <button className="toggle" type="button" disabled={pendente}
                      onClick={() => revogarAgora(c.id)}>
                      revogar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {nova && (
        <div style={{
          border: '1px solid var(--warning)', borderRadius: 8,
          padding: '12px 14px', marginBottom: 12, fontSize: 13,
        }}>
          <strong>Anote agora. O segredo não aparece de novo.</strong>
          <div style={{ marginTop: 8, display: 'grid', gap: 6, fontFamily: 'monospace', fontSize: 12 }}>
            <div>Endereço: {base}/api/webhooks/bank/{nova.idPublico}</div>
            <div>Cabeçalho authorization: {nova.segredo}</div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0' }}>
            Cadastre os dois no painel do seu banco ou adquirente. O segredo vai
            sempre no cabeçalho, nunca na URL.
          </p>
        </div>
      )}

      {erro && <div className="erro" style={{ marginBottom: 10 }}>{erro}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="text" placeholder="Rótulo (ex.: Banco Inter)" value={rotulo}
          onChange={(e) => setRotulo(e.target.value)}
          style={{ maxWidth: 240 }}
        />
        <button className="btn" type="button" disabled={pendente} onClick={criarAgora}>
          {pendente ? 'Gerando…' : 'Gerar credencial'}
        </button>
      </div>
    </>
  )
}
