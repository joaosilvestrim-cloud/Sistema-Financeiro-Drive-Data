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

export default function Equipe({ membros, convites, dono, convidar, criarDireto, revogar, remover, rotulos }) {
  const [erro, setErro] = useState('')
  const [novo, setNovo] = useState(null)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [papel, setPapel] = useState('leitura')
  // 'convite' manda link e a pessoa cria a senha; 'direto' o dono define a
  // senha aqui e entrega em maos. Os dois existem porque a vida real tem os
  // dois: o cliente distante e a gestora sentada do lado.
  const [modo, setModo] = useState('convite')
  const [pendente, start] = useTransition()

  const agir = (fn) => start(async () => {
    setErro('')
    const r = await fn()
    if (r?.erro) setErro(r.erro)
    return r
  })

  const convidarAgora = () => agir(async () => {
    const r = await convidar(email, papel)
    if (!r?.erro) { setNovo({ ...r, tipo: 'convite' }); setEmail('') }
    return r
  })

  const criarAgora = () => agir(async () => {
    const r = await criarDireto(email, senha, papel)
    if (!r?.erro) { setNovo({ ...r, tipo: 'direto' }); setEmail(''); setSenha('') }
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
          {novo.tipo === 'direto' ? (
            <>Acesso criado. <strong>{novo.email}</strong> ja entra em{' '}
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>driveazul.drivedata.com.br/login</span>{' '}
            com a senha que voce definiu. Ela nao fica guardada em claro e nao
            aparece de novo; se perder, e pelo esqueci a senha.</>
          ) : (
            <>Convite criado{novo.emailEnviado ? ' e enviado por e-mail' : ''}.
            {' '}Se preferir, mande o link direto:
            <div style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 6, wordBreak: 'break-all' }}>
              {novo.link}
            </div></>
          )}
        </div>
      )}

      {erro && <div className="erro" style={{ marginBottom: 10 }}>{erro}</div>}

      {dono && (
        <>
          <div style={{ display: 'flex', gap: 14, marginBottom: 10, fontSize: 13 }}>
            {[['convite', 'Convidar por link'], ['direto', 'Criar usuário e senha']].map(([v, r]) => (
              <label key={v} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name="modo-acesso" checked={modo === v} onChange={() => setModo(v)} />
                {r}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="email" placeholder="email@empresa.com.br" value={email}
              onChange={(e) => setEmail(e.target.value)} style={{ maxWidth: 240 }}
            />
            {modo === 'direto' && (
              <input
                type="text" placeholder="senha (mínimo 8)" value={senha} autoComplete="off"
                onChange={(e) => setSenha(e.target.value)} style={{ maxWidth: 180 }}
              />
            )}
            <select value={papel} onChange={(e) => setPapel(e.target.value)}
              title={PAPEIS.find(([v]) => v === papel)?.[2]}>
              {PAPEIS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
            {modo === 'convite' ? (
              <button className="btn" type="button" disabled={pendente || !email} onClick={convidarAgora}>
                {pendente ? 'Convidando…' : 'Convidar'}
              </button>
            ) : (
              <button className="btn" type="button"
                disabled={pendente || !email || senha.length < 8} onClick={criarAgora}>
                {pendente ? 'Criando…' : 'Criar acesso'}
              </button>
            )}
          </div>
          {modo === 'direto' && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>
              Sem e-mail no caminho: a conta nasce pronta e você entrega a senha
              em mãos. A pessoa pode trocá-la depois pelo esqueci a senha.
            </p>
          )}
        </>
      )}
    </>
  )
}
