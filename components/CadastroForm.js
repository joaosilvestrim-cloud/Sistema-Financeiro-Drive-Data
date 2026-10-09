'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import TelaAcesso from '@/components/TelaAcesso'

// Cadastro. O usuário nasce no Supabase Auth, pelo navegador, com a chave
// pública. O tenant nasce depois, no primeiro acesso autenticado, em
// /bem-vindo. Assim o app não precisa da chave de service role para vender.

export default function CadastroForm({ origem, convite = null, conviteInvalido = false }) {
  const router = useRouter()
  const [empresa, setEmpresa] = useState('')
  const [email, setEmail] = useState(convite?.email ?? '')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [existe, setExiste] = useState(false)
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
        // O token do convite viaja nos metadados do usuário e é lido no
        // primeiro login, para vincular à empresa certa mesmo que a pessoa
        // troque o e-mail no formulário.
        data: convite
          ? { origem: 'convite', convite: convite.token }
          : { empresa, origem: origem || 'direto' },
        // Volta por uma rota nossa, que troca o código por sessão e, se o
        // link já tiver sido gasto pelo filtro do e-mail, manda para o login
        // com explicação em vez de tela de erro.
        emailRedirectTo: `${window.location.origin}/auth/confirmar?next=/bem-vindo`,
      },
    })

    if (error) {
      setErro(/already|registered/i.test(error.message)
        ? 'Já existe conta com esse e-mail. Entre por aqui.'
        : error.message)
      setEnviando(false)
      return
    }

    // E-mail que já tem conta. O Supabase responde sucesso e não manda nada,
    // de propósito, para ninguém descobrir quais e-mails existem testando o
    // cadastro. O sinal é o usuário voltar sem identidade nenhuma. Sem este
    // teste a tela dizia "confirme seu e-mail" e o e-mail nunca chegava:
    // aconteceu com o João em 09/10.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setExiste(true)
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
      <TelaAcesso
        titulo="Confirme seu e-mail."
        acao={{ href: '/login', rotulo: 'Entrar' }}
      >
        <p style={{ fontSize: 17, lineHeight: 1.5, margin: 0 }}>
          Mandamos um link para <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>.
          Clique nele e sua conta abre já com os 14 dias de teste rodando.
        </p>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--text-muted)', margin: '16px 0 0' }}>
          Não chegou em alguns minutos? Confira o lixo eletrônico. Se o link disser
          que expirou, é só{' '}
          <Link href="/login" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>entrar com a sua senha</Link>:
          o e-mail já estará confirmado.
        </p>
      </TelaAcesso>
    )
  }

  return (
    <TelaAcesso
      titulo={convite ? 'Entre na equipe.' : 'Crie sua conta.'}
      subtitulo={convite
        ? `Você foi convidado para o painel da ${convite.empresa}. Crie sua senha para entrar.`
        : '14 dias grátis, sem cartão de crédito. Em poucos minutos o painel está pronto.'}
      acao={{ href: '/login', rotulo: 'Entrar' }}
    >
      <form onSubmit={criar}>
        {conviteInvalido && (
          <div className="erro">Este link de convite não vale mais. Peça outro a quem convidou.</div>
        )}
        {!convite && (
          <input
            type="text" placeholder="Nome da sua empresa" value={empresa}
            onChange={(e) => setEmpresa(e.target.value)} required
          />
        )}
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
        {existe && (
          <div className="erro" style={{ lineHeight: 1.5 }}>
            Já existe uma conta com esse e-mail.{' '}
            <Link href="/login" style={{ textDecoration: 'underline' }}>Entre com a sua senha</Link>
            {' '}ou{' '}
            <Link href="/redefinir-senha" style={{ textDecoration: 'underline' }}>crie uma senha nova</Link>.
          </div>
        )}
        <button className="btn" type="submit" disabled={enviando}>
          {enviando ? 'Criando...' : 'Começar agora'}
        </button>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', margin: '6px 0 0' }}>
          Já tem conta?{' '}
          <Link href="/login" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>Entrar</Link>
        </p>
      </form>
    </TelaAcesso>
  )
}
