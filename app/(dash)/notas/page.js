import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import {
  emitentes, emitenteDoEscopo, documentos, recebiveisSemNota,
  manifestosEmViagem, resumoFiscal, emitirNfseDeTitulo,
  sincronizarDocumento, encerrarManifesto,
} from '@/lib/fiscal'
import { brl, dataCurta } from '@/lib/format'
import Tile from '@/components/Tile'
import Exportar from '@/components/Exportar'
import LinhaExpansivel from '@/components/LinhaExpansivel'

export const dynamic = 'force-dynamic'

// Notas fiscais.
//
// A tela que fecha o ciclo. Até aqui o DriveAzul lia o ERP e explicava o que
// estava acontecendo. Esta é a primeira que escreve no mundo: aperta um botão e
// nasce um documento fiscal com valor legal.
//
// Por isso ela é construída ao contrário das outras. Nas demais, o número vem
// primeiro e o detalhe é opcional. Aqui a primeira pergunta é "o que ainda não
// virou nota", porque é a pergunta que a Tamires faz todo dia primeiro do mês,
// e a resposta é uma lista de coisas para fazer, não um indicador para olhar.

const STATUS_ROTULO = {
  rascunho: 'rascunho', processando: 'processando', autorizado: 'autorizada',
  cancelado: 'cancelada', encerrado: 'encerrado', erro: 'erro',
}
const STATUS_TOM = {
  autorizado: 'var(--good-text)', erro: 'var(--critical)',
  cancelado: 'var(--text-muted)', processando: 'var(--warning)',
}

const EVENTOS = [
  { chave: 'recebido_em', titulo: 'Quando', tipo: 'data' },
  { chave: 'status', titulo: 'Status', tipo: 'texto' },
  { chave: 'mensagem', titulo: 'O que a prefeitura ou a SEFAZ respondeu', tipo: 'texto', largura: 420 },
]

export default async function Notas() {
  const sessao = await requireSession()
  const lista = await emitentes(sessao)

  async function emitir(formData) {
    'use server'
    const s = await requireSession()
    await emitirNfseDeTitulo(s, String(formData.get('titulo')))
    revalidatePath('/notas')
  }

  async function atualizar(formData) {
    'use server'
    const s = await requireSession()
    await sincronizarDocumento(s, String(formData.get('documento')))
    revalidatePath('/notas')
  }

  async function encerrar(formData) {
    'use server'
    const s = await requireSession()
    await encerrarManifesto(s, String(formData.get('documento')), {
      uf: String(formData.get('uf') || '').toUpperCase(),
      municipio: String(formData.get('municipio') || ''),
    })
    revalidatePath('/notas')
  }

  // Sem emitente não há o que mostrar, e mostrar tabela vazia faria parecer
  // defeito. A tela explica o que falta e para de falar.
  if (!lista.length) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Notas fiscais</h1>
            <p>Emitir de dentro do DriveAzul, sem entrar na prefeitura.</p>
          </div>
        </div>
        <div className="card">
          <h2>Nenhuma empresa habilitada para emitir</h2>
          <p className="sub">
            Emitir nota exige três coisas, e nenhuma delas é código: uma conta no
            emissor, o certificado digital A1 da empresa e a inscrição municipal.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            O certificado sobe uma vez, vai direto para o emissor e{' '}
            <strong>não fica guardado aqui</strong>. O DriveAzul guarda só o CNPJ
            que ele provou e a data em que vence, para avisar antes de ele
            expirar e derrubar a emissão da empresa inteira.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 0 }}>
            O passo a passo está em <code>docs/FISCAL.md</code>. Habilitação em
            Conexões.
          </p>
        </div>
      </>
    )
  }

  const [emitente, docs, semNota, viagem, resumo] = await Promise.all([
    emitenteDoEscopo(sessao), documentos(sessao, 60), recebiveisSemNota(sessao, 60),
    manifestosEmViagem(sessao), resumoFiscal(sessao),
  ])

  // Emitente cadastrado e sem token não emite, e o erro só apareceria no
  // clique, falando de outra coisa.
  const semToken = lista.filter((e) => e.status === 'ativo'
    && !e.token_homologacao_enc && !e.token_producao_enc)

  const venceEm = resumo.certificado?.vence
    ? Math.round((new Date(resumo.certificado.vence) - Date.now()) / 86400000)
    : null

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notas fiscais</h1>
          <p>
            Emitir de dentro do DriveAzul, a partir do que já está no ERP. Sem
            entrar na prefeitura e sem redigitar cliente.
          </p>
        </div>
        <Exportar
          linhas={docs} arquivo="notas-fiscais"
          colunas={[
            ['ref', 'Referência', 'texto'],
            ['tipo', 'Tipo', 'texto'],
            ['status', 'Situação', 'texto'],
            ['numero', 'Número', 'texto'],
            ['data_emissao', 'Emissão', 'data'],
            ['tomador_nome', 'Tomador', 'texto'],
            ['tomador_doc', 'CPF ou CNPJ', 'texto'],
            ['valor', 'Valor', 'dinheiro'],
            ['chave', 'Chave ou código', 'texto'],
            ['mensagem', 'Mensagem', 'texto'],
          ]}
        />
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Tile
          label="A receber sem nota" valor={brl(resumo.semNota?.valor)}
          nota={`${resumo.semNota?.titulos ?? 0} título(s) de competência já vencida`}
          tom={Number(resumo.semNota?.titulos) > 0 ? 'warn' : null}
        />
        <Tile
          label="Emitido no mês" valor={brl(resumo.valor_no_mes)}
          nota={`${resumo.autorizados ?? 0} autorizada(s) no total`}
        />
        <Tile
          label="Esperando resposta" valor={String(resumo.processando ?? 0)}
          nota={Number(resumo.com_erro) > 0 ? `${resumo.com_erro} com erro` : 'nenhuma com erro'}
          tom={Number(resumo.com_erro) > 0 ? 'bad' : null}
        />
        <Tile
          label="Certificado vence em"
          valor={venceEm === null ? '—' : `${venceEm} dias`}
          nota={venceEm === null ? 'sem certificado cadastrado'
            : venceEm < 30 ? 'renove antes que pare de emitir'
            : 'dentro do prazo'}
          tom={venceEm !== null && venceEm < 30 ? 'bad' : null}
        />
      </div>

      {Number(resumo.manifestos_abertos) > 0 && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--warning)' }}>
          <h2>{resumo.manifestos_abertos} manifesto(s) em viagem</h2>
          <p className="sub">
            O MDF-e precisa ser encerrado quando a carga chega. Manifesto
            autorizado e nunca encerrado é pendência de fiscalização, e nenhum
            sistema avisa disso.
          </p>
          <table>
            <thead>
              <tr>
                <th>Emitido</th><th>Número</th><th className="num">Dias em viagem</th>
                <th>Encerrar em</th><th />
              </tr>
            </thead>
            <tbody>
              {viagem.map((m) => (
                <tr key={m.id}>
                  <td>{dataCurta(m.data_emissao)}</td>
                  <td>{m.numero ?? m.ref}</td>
                  <td className="num" style={{
                    color: Number(m.dias_em_viagem) > 7 ? 'var(--critical)' : undefined,
                  }}>
                    {m.dias_em_viagem}
                  </td>
                  <td colSpan={2}>
                    <form action={encerrar} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="hidden" name="documento" value={m.id} />
                      <input name="municipio" placeholder="Município de descarga" required
                             style={{ maxWidth: 180 }} />
                      <input name="uf" placeholder="UF" maxLength={2} required
                             style={{ maxWidth: 56, textTransform: 'uppercase' }} />
                      <button className="toggle" type="submit">Encerrar</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>A receber que ainda não virou nota</h2>
        <p className="sub">
          Competência já vencida e sem documento fiscal emitido. É a lista do dia
          primeiro do mês.
        </p>
        {!emitente ? (
          // Duas razões diferentes para não haver emitente, e dizer a errada
          // manda a pessoa procurar no lugar errado.
          <p className="empty">
            {!sessao.connectionId && lista.length > 1
              ? 'Selecione uma empresa no topo da barra lateral. Com mais de um '
                + 'emitente e nenhuma empresa escolhida, emitir pela errada seria fácil demais.'
              : semToken.length
              ? `${semToken.map((e) => e.razao_social).join(', ')} está cadastrada mas sem `
                + 'token da Focus, então não emite. Rode npm run fiscalinstalar.'
              : 'Nenhum emitente está ligado à empresa selecionada. O vínculo entre '
                + 'a empresa do Conta Azul e a empresa na Focus é o que faz a nota '
                + 'nascer do título. Rode npm run fiscalinstalar para criá-lo.'}
          </p>
        ) : semNota.length === 0 ? (
          <p className="empty">Tudo que venceu já tem nota. Nada a fazer aqui.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Competência</th><th>Vencimento</th><th>Cliente</th>
                <th>Descrição</th><th className="num">Valor</th><th />
              </tr>
            </thead>
            <tbody>
              {semNota.map((t) => (
                <tr key={t.installment_id}>
                  <td>{dataCurta(t.data_competencia)}</td>
                  <td>{dataCurta(t.data_vencimento)}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.pessoa}
                  </td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.descricao ?? '—'}
                  </td>
                  <td className="num">{brl(t.total)}</td>
                  <td className="num">
                    <form action={emitir}>
                      <input type="hidden" name="titulo" value={t.installment_id} />
                      <button className="toggle" type="submit"
                              disabled={!t.pessoa_documento}
                              title={t.pessoa_documento ? undefined : 'Cliente sem CPF ou CNPJ no ERP'}>
                        Emitir NFS-e
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Documentos emitidos</h2>
        <p className="sub">
          Clique numa linha para ver o que a prefeitura ou a SEFAZ respondeu.
        </p>
        {docs.length === 0 ? (
          <p className="empty">Nenhum documento emitido ainda.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th />
                <th>Emissão</th><th>Tipo</th><th>Número</th><th>Tomador</th>
                <th className="num">Valor</th><th>Situação</th><th />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <LinhaExpansivel
                  key={d.id} colunas={8} campos={EVENTOS}
                  itens={d.mensagem ? [{
                    recebido_em: d.atualizado_em,
                    status: STATUS_ROTULO[d.status] ?? d.status,
                    mensagem: d.mensagem,
                  }] : []}
                  rotulo={`Referência ${d.ref}`}
                  rodape={d.chave ? `Chave ou código de verificação: ${d.chave}` : undefined}
                  celulas={
                    <>
                      <td>{d.data_emissao ? dataCurta(d.data_emissao) : '—'}</td>
                      <td>{d.tipo.replace('_', ' ')}</td>
                      <td>{d.numero ?? '—'}</td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.tomador_nome ?? '—'}
                      </td>
                      <td className="num">{brl(d.valor)}</td>
                      <td style={{ color: STATUS_TOM[d.status] }}>
                        {STATUS_ROTULO[d.status] ?? d.status}
                      </td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        {d.url_pdf && (
                          <a className="toggle" href={d.url_pdf} target="_blank" rel="noreferrer">PDF</a>
                        )}
                        {d.url_xml && (
                          <a className="toggle" href={d.url_xml} target="_blank" rel="noreferrer"
                             style={{ marginLeft: 6 }}>XML</a>
                        )}
                        {d.status === 'processando' && (
                          <form action={atualizar} style={{ display: 'inline' }}>
                            <input type="hidden" name="documento" value={d.id} />
                            <button className="toggle" type="submit">Conferir</button>
                          </form>
                        )}
                      </td>
                    </>
                  }
                />
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
          A emissão é assíncrona: a nota sai como <strong>processando</strong> e
          vira autorizada quando a prefeitura responde, o que leva de segundos a
          minutos. O emissor avisa sozinho quando isso acontece. O botão
          Conferir existe para quando o aviso não chega.
        </p>
      </div>
    </>
  )
}
