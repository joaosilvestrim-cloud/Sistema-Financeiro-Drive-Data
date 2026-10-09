'use client'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import TelaAcesso from '@/components/TelaAcesso'

// Troca de senha, em três situações:
//
// 1. Sem link: a pessoa digita o e-mail e pedimos o link de troca.
// 2. Com token_hash na URL (modelo de e-mail novo): o link só abre esta
//    página. Nada é validado no carregamento; a validação acontece quando a
//    pessoa envia a senha nova. É o que deixa o link a salvo do filtro de
//    segurança do e-mail corporativo, que abre todo link da mensagem e
//    gastaria um link que valida sozinho ao ser aberto (ver auth/confirmar).
// 3. Já com sessão (modelo de e-mail antigo, que passa por auth/confirmar):
//    só falta a senha nova.

function cliente() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

export default function RedefinirSenha() {
  const router = useRouter()
  const params = useSearchParams()
  const tokenHash = params.get('token_hash')
  const [comSessao, setComSessao] = useState(false)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [repete, setRepete] = useState('')
  const [erro, setErro] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (tokenHash) return
    cliente().auth.getSession().then(({ data }) => setComSessao(!!data.session))
  }, [tokenHash])

  async function pedirLink(e) {
    e.preventDefault()
    setEnviando(true)
    setErro('')
    const { error } = await cliente().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirmar?next=/redefinir-senha`,
    })
    setEnviando(false)
    // Mesma resposta exista ou não a conta. Dizer "esse e-mail não tem conta"
    // entregaria a lista de clientes para quem quisesse testar.
    if (error && !/rate|security/i.test(error.message)) {
      setErro('Não foi possível enviar agora. Tente de novo em alguns minutos.')
      return
    }
    setEnviado(true)
  }

  async function salvar(e) {
    e.preventDefault()
    if (senha.length < 8) { setErro('A senha precisa de pelo menos 8 caracteres.'); return }
    if (senha !== repete) { setErro('As duas senhas não são iguais.'); return }
    setEnviando(true)
    setErro('')
    const sb = cliente()
    if (tokenHash) {
      const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
      if (error) {
        setErro('Esse link já foi usado ou expirou. Peça um novo abaixo.')
        setEnviando(false)
        router.replace('/redefinir-senha')
        return
      }
    }
    const { error } = await sb.auth.updateUser({ password: senha })
    if (error) {
      setErro(/different|same/i.test(error.message)
        ? 'A senha nova precisa ser diferente da anterior.'
        : 'Não foi possível trocar a senha. Peça um novo link.')
      setEnviando(false)
      return
    }
    router.push('/')
    router.refresh()
  }

  const podeTrocar = tokenHash || comSessao

  if (enviado) {
    return (
      <TelaAcesso titulo="Confira seu e-mail." acao={{ href: '/login', rotulo: 'Entrar' }}>
        <p style={{ fontSize: 17, lineHeight: 1.5, margin: 0 }}>
          Se existir uma conta com <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>,
          o link para criar a senha nova chega em instantes. Confira também o lixo eletrônico.
        </p>
        <p style={{ fontSize: 15, margin: '18px 0 0' }}>
          <Link href="/login" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>Voltar para o login</Link>
        </p>
      </TelaAcesso>
    )
  }

  return (
    <TelaAcesso
      titulo={podeTrocar ? 'Crie a senha nova.' : 'Esqueci minha senha.'}
      subtitulo={podeTrocar
        ? 'Mínimo de 8 caracteres. Depois de salvar você já entra no painel.'
        : 'Mandamos um link para você criar uma senha nova.'}
      acao={{ href: '/login', rotulo: 'Entrar' }}
    >
      {podeTrocar ? (
        <form onSubmit={salvar}>
          <input
            type="password" placeholder="Senha nova (mínimo 8 caracteres)" value={senha}
            autoComplete="new-password" minLength={8} required
            onChange={(e) => setSenha(e.target.value)}
          />
          <input
            type="password" placeholder="Repita a senha nova" value={repete}
            autoComplete="new-password" minLength={8} required
            onChange={(e) => setRepete(e.target.value)}
          />
          {erro && <div className="erro">{erro}</div>}
          <button className="btn" type="submit" disabled={enviando}>
            {enviando ? 'Salvando...' : 'Salvar e entrar'}
          </button>
        </form>
      ) : (
        <form onSubmit={pedirLink}>
          <input
            type="email" placeholder="E-mail da conta" value={email} autoComplete="username"
            required onChange={(e) => setEmail(e.target.value)}
          />
          {erro && <div className="erro">{erro}</div>}
          <button className="btn" type="submit" disabled={enviando}>
            {enviando ? 'Enviando...' : 'Mandar link'}
          </button>
          <p style={{ fontSize: 15, margin: '6px 0 0' }}>
            <Link href="/login" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>Voltar para o login</Link>
          </p>
        </form>
      )}
    </TelaAcesso>
  )
}
