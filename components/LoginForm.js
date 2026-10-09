'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import TelaAcesso from '@/components/TelaAcesso'

export default function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(params.get('erro') === 'sem-acesso'
    ? 'Seu usuário não está vinculado a nenhuma empresa.'
    : '')
  const [enviando, setEnviando] = useState(false)
  const [naoConfirmado, setNaoConfirmado] = useState(false)
  const [reenviado, setReenviado] = useState(false)

  // Quem chega pela volta do link de confirmação. Na maioria das vezes o
  // e-mail já está confirmado (o filtro de segurança do e-mail abriu o link
  // antes da pessoa), e o que falta é só entrar. Ver app/auth/confirmar.
  const aviso = {
    confirmar: 'Seu e-mail foi confirmado. Entre com a senha que você criou para continuar.',
    'senha-nova': 'Senha trocada. Entre com a senha nova.',
    'link-recuperacao': 'Esse link de troca de senha já foi usado ou expirou. Peça outro em "Esqueci minha senha".',
  }[params.get('aviso')] ?? ''

  const cliente = () => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )

  async function reenviar() {
    setErro('')
    const { error } = await cliente().auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirmar?next=/bem-vindo` },
    })
    if (error) { setErro('Não foi possível reenviar agora. Tente de novo em alguns minutos.'); return }
    setReenviado(true)
  }

  async function entrar(e) {
    e.preventDefault()
    setEnviando(true)
    setErro('')
    setNaoConfirmado(false)
    const { error } = await cliente().auth.signInWithPassword({ email, password: senha })
    if (error) {
      // E-mail não confirmado é outro problema, com outra saída. Dizer "senha
      // inválida" aqui mandaria a pessoa trocar uma senha que está certa.
      if (error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message)) {
        setNaoConfirmado(true)
        setErro('Seu e-mail ainda não foi confirmado. Use o link que enviamos ou peça outro.')
      } else {
        setErro('E-mail ou senha inválidos.')
      }
      setEnviando(false)
      return
    }
    router.push(params.get('proxima') || '/')
    router.refresh()
  }

  return (
    <TelaAcesso
      titulo="Entrar"
      subtitulo="Bom te ver de novo. Os números estão atualizados."
      acao={{ href: '/comecar', rotulo: 'Criar conta' }}
    >
      <form onSubmit={entrar}>
        <input
          type="email" placeholder="E-mail" value={email} autoComplete="username"
          onChange={(e) => setEmail(e.target.value)} required
        />
        <input
          type="password" placeholder="Senha" value={senha} autoComplete="current-password"
          onChange={(e) => setSenha(e.target.value)} required
        />
        {aviso && !erro && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{aviso}</div>
        )}
        {erro && <div className="erro">{erro}</div>}
        {naoConfirmado && !reenviado && (
          <button type="button" className="toggle" onClick={reenviar} disabled={!email}>
            Reenviar link de confirmação
          </button>
        )}
        {reenviado && (
          <div style={{ fontSize: 13, color: 'var(--good-text)' }}>
            Link reenviado para {email}. Confira também o lixo eletrônico.
          </div>
        )}
        <button className="btn" type="submit" disabled={enviando}>
          {enviando ? 'Entrando...' : 'Entrar'}
        </button>
        <p style={{ fontSize: 15, margin: '6px 0 0' }}>
          <Link href="/redefinir-senha" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>Esqueci minha senha</Link>
        </p>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>
          Ainda não tem conta?{' '}
          <Link href="/comecar" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>Testar 14 dias grátis</Link>
        </p>
      </form>
    </TelaAcesso>
  )
}
