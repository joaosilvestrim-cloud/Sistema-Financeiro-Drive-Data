import './globals.css'
import TemaToggle from '@/components/TemaToggle'

export const metadata = {
  title: 'DriveAzul',
  description: 'Inteligência financeira sobre a Conta Azul',
}

// O tema é decidido antes da primeira pintura.
//
// Sem este script, a página nasceria clara e piscaria para escura depois que o
// React montasse, o que é feio e parece defeito. Ele roda inline, antes do CSS
// terminar, e por isso não pode depender de nada.
//
// O padrão é claro, mesmo em sistema escuro. É escolha de produto, não descuido:
// o comprador olhou o painel escuro e a primeira reação foi pedir uma cor mais
// clara. Quem prefere escuro aperta o botão uma vez e a escolha fica guardada.
const DECIDIR_TEMA = `
(function () {
  try {
    var t = localStorage.getItem('tema');
    document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`

export default function RootLayout({ children }) {
  return (
    // O script inline troca o data-theme antes da hidratação, de propósito, e o
    // React acusa a diferença entre o que o servidor mandou e o que ele
    // encontrou. Aqui a diferença é o comportamento desejado, não um defeito, e
    // esta marcação diz isso ao React. Ela vale só para os atributos deste
    // elemento, então não esconde divergência de nenhum outro lugar.
    <html lang="pt-BR" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: DECIDIR_TEMA }} />
      </head>
      <body>
        {children}
        <TemaToggle />
      </body>
    </html>
  )
}
