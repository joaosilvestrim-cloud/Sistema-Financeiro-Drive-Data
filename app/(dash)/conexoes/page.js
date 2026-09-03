import { requireSession } from '@/lib/session'
import { conexoes, ultimasRodadas } from '@/lib/queries'
import { desde, dataCurta } from '@/lib/format'

export const dynamic = 'force-dynamic'

// Página de confiança. Como não existe webhook na Conta Azul, o dado tem idade,
// e o cliente precisa enxergar essa idade sem precisar perguntar.

const STATUS = {
  connected: ['Conectada', 'ok'],
  expired: ['Autorização expirada', 'bad'],
  revoked: ['Acesso revogado', 'bad'],
  error: ['Com erro', 'bad'],
}

export default async function Conexoes() {
  const sessao = await requireSession()
  const [lista, rodadas] = await Promise.all([
    conexoes(sessao.tenantId), ultimasRodadas(sessao.tenantId, 15),
  ])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Conexões</h1>
          <p>Cada empresa autorizada no ERP é uma conexão, com tokens e ritmo próprios.</p>
        </div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        {lista.map((c) => {
          const [rotulo, tom] = STATUS[c.status] ?? [c.status, '']
          return (
            <div className="card" key={c.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
                <h2>{c.nome}</h2>
                <span className={`badge ${tom}`}>{rotulo}</span>
              </div>
              <p className="sub" style={{ marginTop: 6 }}>
                {c.provider} · a cada {c.sync_interval_minutes} min
              </p>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                <div>último sync {desde(c.last_sync_at)}</div>
                <div>{Number(c.parcelas).toLocaleString('pt-BR')} parcelas carregadas</div>
                {c.last_error && (
                  <div style={{ color: 'var(--critical)', marginTop: 6, fontSize: 12 }}>{c.last_error}</div>
                )}
              </div>
            </div>
          )
        })}
        {lista.length === 0 && (
          <p className="empty">Nenhuma empresa conectada. Rode <code>npm run connect</code>.</p>
        )}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Últimas rodadas</h2>
        <p className="sub">Histórico de sincronização, incluindo as que falharam.</p>
        <table>
          <thead>
            <tr>
              <th>Início</th><th>Empresa</th><th>Tipo</th><th>Status</th>
              <th className="num">Itens</th><th className="num">Chamadas</th><th>Erro</th>
            </tr>
          </thead>
          <tbody>
            {rodadas.map((r) => (
              <tr key={r.id}>
                <td>{dataCurta(r.started_at)} {new Date(r.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                <td>{r.conexao}</td>
                <td>{r.kind}</td>
                <td style={{ color: r.status === 'error' ? 'var(--critical)' : undefined }}>{r.status}</td>
                <td className="num">{r.items}</td>
                <td className="num">{r.requests}</td>
                <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                  {r.error ?? '—'}
                </td>
              </tr>
            ))}
            {rodadas.length === 0 && (
              <tr><td colSpan="7" style={{ color: 'var(--text-muted)' }}>Nenhuma rodada ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
