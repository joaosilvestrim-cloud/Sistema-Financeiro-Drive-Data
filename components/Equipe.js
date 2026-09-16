'use client'
import { useState, useTransition } from 'react'

// Card de equipe. Convite criado aqui, aceito no primeiro login do
// convidado. O link aparece para o dono copiar porque e-mail falha, cai em
// spam ou demora, e o WhatsApp da vida real resolve na hora.

const PAPEIS = [
  ['leitura', 'Leitura', 'vê tudo, não mexe em nada'],
  ['financeiro', 'Financeiro', 'vê tudo e usa as ações, como emitir nota'],
  ['contador', 'Contador', 'acesso de leitura pensado para o contador'],
]

export default function Equipe({ membros, convites, dono, convidar, revogar, remover, rotulos }) {
  const [erro, setErro] = useState('')
  const [novo, setNovo] = useState(null)
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState('leitura')
  const [pendente, start] = useTransition()

  const agir = (fn) => start(async () => {
    setErro('')
    const r = await fn()
    if (r?.erro) setErro(r.erro)
    return r
  })

  const convidarAgora = () => agir(async () => {
    const r = await convidar(email, papel)
    if (!r?.erro) { setNovo(r); setEmail('') }
    return r
  })

  return (
    <>
      <table style={{ marginBottom: convites.length || dono ? 12 : 0 }}>
        <thead>
          <tr><th>Pessoa</th><th>Papel</th><th>Desde</th>{dono && <th />}</tr>
        </thead>
        <tbody>
          {membros.map((m) => (
            <tr key={m.user_id}>
              <td>{m.email}</td>
              <td>{rotulos[m.role] ?? m.role}</td>
              <td>{new Date(m.created_at).toLocaleDateString('pt-BR')}</td>
              {dono && (
                <td style={{ textAlign: 'right' }}>
                  {m.role !== 'owner' && (
                    <button className="toggle" type="button" disabled={pendente}
                      onClick={() => agir(() => remover(m.user_id))}>
                      remover
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {convites.map((c) => (
            <tr key={c.id} style={{ color: 'var(--text-muted)' }}>
              <td>{c.email}</td>
              <td>{rotulos[c.papel] ?? c.papel}</td>
              <td>{c.vencido ? 'convite vencido' : 'convite pendente'}</td>
              {dono && (
                <td style={{ textAlign: 'right' }}>
                  <button className="toggle" type="button" disabled={pendente}
                    onClick={() => agir(() => revogar(c.id))}>
                    revogar
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {novo && (
        <div style={{
          border: '1px solid var(--good)', borderRadius: 8,
          padding: '10px 14px', marginBottom: 12, fontSize: 13,
        }}>
          Convite criado{novo.emailEnviado ? ' e enviado por e-mail' : ''}.
          {' '}Se preferir, mande o link direto:
          <div style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 6, wordBreak: 'break-all' }}>
            {novo.link}
          </div>
        </div>
      )}

      {erro && <div className="erro" style={{ marginBottom: 10 }}>{erro}</div>}

      {dono && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="email" placeholder="email@empresa.com.br" value={email}
            onChange={(e) => setEmail(e.target.value)} style={{ maxWidth: 260 }}
          />
          <select value={papel} onChange={(e) => setPapel(e.target.value)}
            title={PAPEIS.find(([v]) => v === papel)?.[2]}>
            {PAPEIS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
          <button className="btn" type="button" disabled={pendente || !email} onClick={convidarAgora}>
            {pendente ? 'Convidando…' : 'Convidar'}
          </button>
        </div>
      )}
    </>
  )
}
