'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

export default function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(params.get('erro') === 'sem-acesso'
    ? 'Seu usuário não está vinculado a nenhuma empresa.'
    : '')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e) {
    e.preventDefault()
    setEnviando(true)
    setErro('')
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    )
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (error) {
      setErro('E-mail ou senha inválidos.')
      setEnviando(false)
      return
    }
    router.push(params.get('proxima') || '/')
    router.refresh()
  }

  return (
    <div className="login">
      <form onSubmit={entrar}>
        <div className="brand" style={{ marginBottom: 6 }}>
          DriveAzul<span>Inteligência financeira</span>
        </div>
        <input
          type="email" placeholder="E-mail" value={email} autoComplete="username"
          onChange={(e) => setEmail(e.target.value)} required
        />
        <input
          type="password" placeholder="Senha" value={senha} autoComplete="current-password"
          onChange={(e) => setSenha(e.target.value)} required
        />
        {erro && <div className="erro">{erro}</div>}
        <button className="btn" type="submit" disabled={enviando}>
          {enviando ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
