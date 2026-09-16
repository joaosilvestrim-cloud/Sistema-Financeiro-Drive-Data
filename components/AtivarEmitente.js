'use client'
import { useState } from 'react'
import { useFormStatus } from 'react-dom'

// Formulário de ativação do emitente fiscal, preenchível por quem não é
// contador. O CEP puxa o endereço e o código IBGE do município pelo ViaCEP,
// que é o dado que a prefeitura exige e ninguém sabe de cor.
//
// O certificado A1 entra num input de arquivo e segue no POST da action.
// Ele atravessa a memória do servidor até a Focus e não é guardado em lugar
// nenhum aqui. A senha idem.

const REGIMES = [
  ['1', 'Simples Nacional'],
  ['2', 'Simples Nacional, excesso de sublimite'],
  ['3', 'Regime normal (Lucro Presumido ou Real)'],
]

function Enviar() {
  const { pending } = useFormStatus()
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? 'Cadastrando no emissor…' : 'Ativar emissão de notas'}
    </button>
  )
}

export default function AtivarEmitente({ acao }) {
  // Só os campos que o CEP preenche são controlados, e são desde o início,
  // para o React não reclamar de input que muda de regime no meio da vida.
  const [end, setEnd] = useState({
    logradouro: '', bairro: '', municipio: '', uf: '', codigo_municipio: '',
  })
  const [buscando, setBuscando] = useState(false)
  const [tipoNfse, setTipoNfse] = useState('municipal')

  async function buscarCep(e) {
    const cep = e.target.value.replace(/\D/g, '')
    if (cep.length !== 8) return
    setBuscando(true)
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
      const j = await r.json()
      if (!j.erro) {
        setEnd({
          logradouro: j.logradouro ?? '', bairro: j.bairro ?? '',
          municipio: j.localidade ?? '', uf: j.uf ?? '',
          codigo_municipio: j.ibge ?? '',
        })
      }
    } catch {
      // Sem ViaCEP a pessoa preenche na mão. Os campos continuam editáveis.
    }
    setBuscando(false)
  }

  const campo = (nome, rotulo, props = {}) => (
    <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{rotulo}</span>
      <input
        name={nome}
        {...(nome in end
          ? { value: end[nome], onChange: (e) => setEnd({ ...end, [nome]: e.target.value }) }
          : {})}
        {...props}
      />
    </label>
  )

  return (
    <form action={acao} style={{ display: 'grid', gap: 18, maxWidth: 720 }}>
      <div className="card">
        <h2>Empresa</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {campo('razao_social', 'Razão social', { required: true })}
          {campo('nome_fantasia', 'Nome fantasia')}
          {campo('cnpj', 'CNPJ', { required: true, placeholder: '00.000.000/0001-00' })}
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Regime tributário</span>
            <select name="regime_tributario" defaultValue="1">
              {REGIMES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </label>
          {campo('inscricao_municipal', 'Inscrição municipal (exigida para NFS-e)')}
          {campo('inscricao_estadual', 'Inscrição estadual (se tiver)')}
          {campo('email', 'E-mail fiscal', { type: 'email' })}
          {campo('telefone', 'Telefone')}
        </div>
      </div>

      <div className="card">
        <h2>Endereço fiscal</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              CEP {buscando && '(buscando…)'}
            </span>
            <input name="cep" required placeholder="00000-000" onBlur={buscarCep} />
          </label>
          {campo('logradouro', 'Logradouro', { required: true })}
          {campo('numero', 'Número', { required: true })}
          {campo('complemento', 'Complemento')}
          {campo('bairro', 'Bairro', { required: true })}
          {campo('municipio', 'Município', { required: true })}
          {campo('uf', 'UF', { required: true, maxLength: 2 })}
          {campo('codigo_municipio', 'Código IBGE do município', {
            required: true,
            title: 'Preenchido sozinho pelo CEP. Se precisar, confira em ibge.gov.br.',
          })}
        </div>
      </div>

      <div className="card">
        <h2>O que a empresa emite</h2>
        <div style={{ display: 'grid', gap: 10, fontSize: 14 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <input
              type="radio" name="tipo_nfse" value="municipal"
              checked={tipoNfse === 'municipal'}
              onChange={() => setTipoNfse('municipal')}
            />
            <span>
              <strong>NFS-e pela prefeitura</strong>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
                O caminho de hoje na maioria dos municípios.
              </span>
            </span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <input
              type="radio" name="tipo_nfse" value="nacional"
              checked={tipoNfse === 'nacional'}
              onChange={() => setTipoNfse('nacional')}
            />
            <span>
              <strong>NFS-e pelo padrão nacional</strong>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
                Só se o seu município já migrou. Os dois juntos a prefeitura não aceita.
              </span>
            </span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <input type="checkbox" name="habilita_recebidas_nfe" value="1" defaultChecked />
            <span>
              <strong>Acompanhar NFe recebidas</strong>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
                As notas emitidas contra o seu CNPJ chegam sozinhas, direto da Receita.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="card">
        <h2>Padrões da NFS-e</h2>
        <p className="sub">
          Preenchidos em toda nota para você não digitar sempre a mesma coisa.
          O seu contador sabe os dois códigos de cabeça.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {campo('item_lista_servico', 'Item da lista de serviço (LC 116)', { placeholder: 'ex.: 0107' })}
          {campo('aliquota_iss', 'Alíquota de ISS (%)', { placeholder: 'ex.: 2,00' })}
        </div>
        <label style={{ display: 'grid', gap: 4, fontSize: 13, marginTop: 12 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Descrição padrão do serviço</span>
          <textarea name="discriminacao_padrao" rows={2}
            placeholder="ex.: Serviços de consultoria em tecnologia da informação" />
        </label>
      </div>

      <div className="card">
        <h2>Certificado digital A1</h2>
        <p className="sub">
          O arquivo .pfx ou .p12 e a senha dele. Vai direto para o emissor e não
          fica guardado aqui: registramos só o CNPJ que ele provou e a data de
          vencimento, para avisar antes de expirar. Pode pular e enviar depois,
          mas sem ele a prefeitura não aceita nota.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Arquivo do certificado</span>
            <input type="file" name="certificado" accept=".pfx,.p12" />
          </label>
          {campo('senha_certificado', 'Senha do certificado', { type: 'password', autoComplete: 'off' })}
        </div>
      </div>

      <div>
        <Enviar />
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
          O cadastro é validado no emissor antes de ser gravado. Se algo estiver
          errado, a mensagem aparece aqui em cima e nada fica pela metade.
        </p>
      </div>
    </form>
  )
}
