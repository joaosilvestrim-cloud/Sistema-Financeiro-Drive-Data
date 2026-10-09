import Image from 'next/image'
import Link from 'next/link'
import marca from '@/public/driveazul-marca.png'
import s from './telaAcesso.module.css'

// Moldura comum das telas de entrada. Mesmo topo e mesma linguagem da
// landing, para quem clica em "Começar grátis" não sentir que saiu do site.
//
// `largo` tira o painel lateral e abre espaço para conteúdo maior (boas-vindas
// e primeira carga). `acao` é o botão vazado do topo: no login leva ao
// cadastro e no cadastro leva ao login.
export default function TelaAcesso({ titulo, subtitulo, acao, largo = false, children }) {
  return (
    <div className={`${s.raiz} lp-raiz`}>
      <header className={s.topo}>
        <div className={s.topoMiolo}>
          <Link href="/" className={s.marca}>
            <Image src={marca} alt="" width={30} height={30} priority />
            DriveAzul
          </Link>
          {acao && <Link href={acao.href} className={s.acao}>{acao.rotulo}</Link>}
        </div>
      </header>

      <main className={`${s.grade} ${largo ? s.largo : ''}`}>
        <section className={s.corpo}>
          {titulo && <h1 className={s.titulo}>{titulo}</h1>}
          {subtitulo && <p className={s.sub}>{subtitulo}</p>}
          <div className={s.conteudo}>{children}</div>
        </section>

        {!largo && (
          <aside className={s.painel}>
            <p className={s.painelTitulo}>
              Seu Conta Azul, <b>lido de verdade.</b>
            </p>
            <ul className={s.lista}>
              <li><span>01</span>Fluxo de caixa real, pelas baixas e pela agenda de vencimentos.</li>
              <li><span>02</span>Conciliação conta por conta, com o que fazer em cada uma.</li>
              <li><span>03</span>O histórico de atraso de cada cliente, que o ERP apaga ao receber.</li>
            </ul>
            <p className={s.rodapePainel}>14 dias grátis, sem cartão. Para empresas no Conta Azul Pro.</p>
          </aside>
        )}
      </main>
    </div>
  )
}
