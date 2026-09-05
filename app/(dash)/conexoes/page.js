import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { q } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { comAviso } from '@/lib/acao'
import { conexoes, ultimasRodadas } from '@/lib/queries'
import { desde, dataCurta } from '@/lib/format'
import { criarState } from '@/lib/oauthState'
import { buildAuthorizeUrl } from '@/src/oauth.mjs'

export const dynamic = 'force-dynamic'

// Página de confiança. Como não existe webhook na Conta Azul, o dado tem idade,
// e o cliente precisa enxergar essa idade sem precisar perguntar.

const STATUS = {
  connected: ['Conectada', 'ok'],
  expired: ['Autorização expirada', 'bad'],
  revoked: ['Acesso revogado', 'bad'],
  error: ['Com erro', 'bad'],
}

export default async function Conexoes({ searchParams }) {
  const sessao = await requireSession()
  const busca = await searchParams
  const [lista, rodadas] = await Promise.all([
    conexoes(sessao.tenantId), ultimasRodadas(sessao.tenantId, 15),
  ])

  async function conectar() {
    'use server'
    await comAviso('/conexoes', async () => {
      const s = await requireSession()
      // O limite do plano vale aqui, e nao so na tela. Sem isso alguem no plano de
      // uma empresa conectaria cinco e o preco por empresa nao existiria.
      if (!s.conta.podeConectarMais) redirect('/assinar?motivo=limite')
      // O state vai assinado com prazo curto: ele volta pelo navegador e sem
      // assinatura daria para ligar a conta de uma empresa ao tenant de outra.
      redirect(buildAuthorizeUrl(criarState(s.tenantId)))
    })
  }

  async function alternarIa() {
    'use server'
    await comAviso('/conexoes', async () => {
      const s = await requireSession()
      await q('update core.tenant set ia_habilitada = not ia_habilitada where id = $1', [s.tenantId])
      revalidatePath('/', 'layout')
    })
  }

  const precisaReconectar = lista.some((c) => c.status !== 'connected')

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Conexões</h1>
          <p>Cada empresa autorizada no ERP é uma conexão, com tokens e ritmo próprios.</p>
        </div>
        <form action={conectar}>
          <button className="btn" type="submit" disabled={!sessao.conta.podeConectarMais}>
            {lista.length ? 'Conectar outra empresa' : 'Conectar Conta Azul'}
          </button>
          {!sessao.conta.podeConectarMais && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Seu plano cobre {sessao.conta.limiteEmpresas}{' '}
              {sessao.conta.limiteEmpresas === 1 ? 'empresa' : 'empresas'}.{' '}
              <a href="/assinar">Ver planos</a>
            </p>
          )}
        </form>
      </div>

      {busca?.erro && (
        <p style={{
          background: 'color-mix(in srgb, var(--critical) 12%, transparent)',
          border: '1px solid var(--critical)', borderRadius: 8, padding: '10px 14px',
          fontSize: 13, marginTop: 0,
        }}>
          <strong>Não deu certo.</strong> {busca.erro}
        </p>
      )}

      {busca?.ok && (
        <p style={{
          background: 'color-mix(in srgb, var(--good) 12%, transparent)',
          border: '1px solid var(--good)', borderRadius: 8, padding: '10px 14px',
          fontSize: 13, marginTop: 0,
        }}>
          <strong>Conexão {busca.ok}.</strong>{' '}
          {busca.renova === '1'
            ? 'A autorização se renova sozinha. Rode a carga inicial para trazer o histórico.'
            : 'Atenção: a Conta Azul não devolveu refresh_token, então esta conexão expira em uma hora.'}
        </p>
      )}

      {precisaReconectar && !busca?.ok && (
        <p style={{
          background: 'color-mix(in srgb, var(--warning) 14%, transparent)',
          border: '1px solid var(--warning)', borderRadius: 8, padding: '10px 14px',
          fontSize: 13, marginTop: 0,
        }}>
          <strong>Sincronização parada.</strong> Uma ou mais conexões perderam a autorização.
          Os números das outras telas param no último sync que deu certo.
        </p>
      )}

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
                {c.external_company_id && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                    {c.external_company_id}
                  </div>
                )}
                {c.last_error && (
                  <div style={{ color: 'var(--critical)', marginTop: 6, fontSize: 12 }}>{c.last_error}</div>
                )}
              </div>
            </div>
          )
        })}
        {lista.length === 0 && (
          <p className="empty">
            Nenhuma empresa conectada. Use o botão Conectar Conta Azul aí em cima.
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Análises de inteligência artificial</h2>
        <p className="sub">
          As leituras que aparecem em cada indicador são geradas pela Groq, que
          processa nos Estados Unidos.
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Enviamos apenas indicadores já calculados, e nome de cliente e de conta
          bancária saem daqui trocados por apelido. O nome real nunca deixa o
          nosso servidor. Desligado, nada é enviado, e todos os números
          continuam na tela.
        </p>
        <form action={alternarIa}>
          <button className="toggle" type="submit">
            {sessao.conta.iaHabilitada ? 'Desligar as análises de IA' : 'Ligar as análises de IA'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>
            hoje: {sessao.conta.iaHabilitada ? 'ligadas' : 'desligadas'}
          </span>
        </form>
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
