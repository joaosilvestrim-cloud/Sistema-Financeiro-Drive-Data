import './globals.css'

export const metadata = {
  title: 'DriveAzul',
  description: 'Inteligência financeira sobre a Conta Azul',
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
