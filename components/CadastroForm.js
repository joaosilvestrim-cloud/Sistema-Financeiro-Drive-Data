'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import Marca from '@/components/Marca'

// Cadastro. O usuário nasce no Supabase Auth, pelo navegador, com a chave
// pública. O tenant nasce depois, no primeiro acesso autenticado, em
// /bem-vindo. Assim o app não precisa da chave de service role para vender.

export default function CadastroForm({ origem }) {
  const router = useRouter()
  const [empresa, setEmpresa] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [enviando, setEnviando] = useState(false)

  async function criar(e) {
    e.preventDefault()
    if (senha.length < 8) { setErro('A senha precisa de pelo menos 8 caracteres.'); return }
    setEnviando(true)
    setErro('')

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    )
    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha,
      options: {
        data: { empresa, origem: origem || 'direto' },
        emailRedirectTo: `${window.location.origin}/bem-vindo`,
      },
    })

    if (error) {
      setErro(/already|registered/i.test(error.message)
        ? 'Já existe conta com esse e-mail. Entre por aqui.'
        : error.message)
      setEnviando(false)
      return
    }

    // Quando o projeto exige confirmação de e-mail, o signUp não devolve
    // sessão. Sem tratar isso a tela mandaria a pessoa para dentro do app e ela
    // cairia no login sem entender por quê.
    if (!data.session) { setConfirmar(true); setEnviando(false); return }

    router.push('/bem-vindo')
    router.refresh()
  }

  if (confirmar) {
    return (
      <div className="login">
        <div style={{ textAlign: 'center' }}>
          <Marca tamanho={38} />
          <h2 style={{ marginTop: 18 }}>Confirme seu e-mail</h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Mandamos um link para <strong>{email}</strong>. Clique nele e sua conta
            abre já com os 14 dias de teste rodando.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="login">
      <form onSubmit={criar}>
        <div style={{ marginBottom: 6 }}>
          <Marca tamanho={38} />
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 4px' }}>
          14 dias grátis. Sem cartão de crédito.
        </p>
        <input
          type="text" placeholder="Nome da sua empresa" value={empresa}
          onChange={(e) => setEmpresa(e.target.value)} required
        />
        <input
          type="email" placeholder="E-mail" value={email} autoComplete="username"
          onChange={(e) => setEmail(e.target.value)} required
        />
        <input
          type="password" placeholder="Senha (mínimo 8 caracteres)" value={senha}
          autoComplete="new-password" minLength={8}
          onChange={(e) => setSenha(e.target.value)} required
        />
        {erro && <div className="erro">{erro}</div>}
        <button className="btn" type="submit" disabled={enviando}>
          {enviando ? 'Criando...' : 'Começar agora'}
        </button>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
          Já tem conta? <Link href="/login">Entrar</Link>
        </p>
      </form>
    </div>
  )
}
