'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function NavLink({ href, children }) {
  const atual = usePathname()
  const ativo = href === '/' ? atual === '/' : atual.startsWith(href)
  return (
    <Link href={href} data-active={ativo}>{children}</Link>
  )
}
