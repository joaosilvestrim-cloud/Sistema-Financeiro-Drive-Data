import './globals.css'

export const metadata = {
  title: 'Sistema Financeiro DriveData',
  description: 'Analytics financeiro sobre a Conta Azul',
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
