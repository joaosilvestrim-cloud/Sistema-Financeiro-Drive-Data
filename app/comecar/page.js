import { Suspense } from 'react'
import CadastroForm from '@/components/CadastroForm'
import { conviteDoToken } from '@/lib/equipe'

export const metadata = {
  title: 'Começar · DriveAzul',
  description: 'Conecte seu Conta Azul e veja o financeiro da sua empresa em minutos.',
}

// O parâmetro origem serve para saber se a loja da Conta Azul manda cliente de
// verdade. O link da vitrine vai apontar para /comecar?origem=loja-contaazul.
export default async function Comecar({ searchParams }) {
  const busca = await searchParams
  // Link de convite: a tela diz para qual empresa é e trava o e-mail no que
  // foi convidado, porque o vínculo no primeiro login casa por ele.
  const convite = busca?.convite ? await conviteDoToken(busca.convite) : null
  return (
    <Suspense fallback={<div className="login">carregando...</div>}>
      <CadastroForm
        origem={busca?.origem ?? null}
        convite={convite && !convite.invalido
          ? { token: busca.convite, email: convite.email, empresa: convite.empresa }
          : null}
        conviteInvalido={!!busca?.convite && (!convite || convite.invalido)}
      />
    </Suspense>
  )
}
