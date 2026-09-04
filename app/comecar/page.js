import { Suspense } from 'react'
import CadastroForm from '@/components/CadastroForm'

export const metadata = {
  title: 'Começar · DriveAzul',
  description: 'Conecte seu Conta Azul e veja o financeiro da sua empresa em minutos.',
}

// O parâmetro origem serve para saber se a loja da Conta Azul manda cliente de
// verdade. O link da vitrine vai apontar para /comecar?origem=loja-contaazul.
export default async function Comecar({ searchParams }) {
  const busca = await searchParams
  return (
    <Suspense fallback={<div className="login">carregando...</div>}>
      <CadastroForm origem={busca?.origem ?? null} />
    </Suspense>
  )
}
