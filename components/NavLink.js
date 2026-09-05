'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Icone from './Icone'

// Item do menu.
//
// O estado ativo vale para a rota e para o que estiver abaixo dela, menos na
// raiz: sem a exceção, a Visão geral ficaria acesa em todas as telas, porque
// toda rota começa com barra.
//
// `data-active` em vez de classe condicional porque o estilo inteiro do item
// mora no CSS, incluindo a barra de acento e a transição. O componente decide o
// que a coisa é, a folha decide como ela aparece.
export default function NavLink({ href, icone, children }) {
  const atual = usePathname()
  const ativo = href === '/' ? atual === '/' : atual.startsWith(href)
  return (
    <Link href={href} data-active={ativo} aria-current={ativo ? 'page' : undefined}>
      <Icone nome={icone} />
      <span>{children}</span>
    </Link>
  )
}
