// O template remonta a cada navegação, ao contrário do layout. É o que permite
// a tela nova entrar com um movimento curto em vez de trocar de repente. A
// animação mora no CSS (.entrada) e some para quem pediu menos movimento.
export default function Template({ children }) {
  return <div className="entrada">{children}</div>
}
