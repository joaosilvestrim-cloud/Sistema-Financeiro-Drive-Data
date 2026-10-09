import { Suspense } from 'react'
import RedefinirSenha from '@/components/RedefinirSenha'

export const metadata = { title: 'Trocar senha · DriveAzul' }

export default function Pagina() {
  return (
    <Suspense fallback={<div className="login">carregando...</div>}>
      <RedefinirSenha />
    </Suspense>
  )
}
