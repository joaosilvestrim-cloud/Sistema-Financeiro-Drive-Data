import { Suspense } from 'react'
import LoginForm from '@/components/LoginForm'

export const metadata = { title: 'Entrar · DriveAzul' }

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login">carregando...</div>}>
      <LoginForm />
    </Suspense>
  )
}
