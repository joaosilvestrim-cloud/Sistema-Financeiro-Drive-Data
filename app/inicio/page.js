import Image from 'next/image'
import Link from 'next/link'
import marca from '@/public/driveazul-marca.png'
import { PLANOS } from '@/lib/assinaturaEstado'
import s from './inicio.module.css'

export const metadata = {
  title: 'DriveAzul · Inteligência financeira sobre o seu Conta Azul',
  description:
    'Conecte o Conta Azul em minutos e veja fluxo de caixa real, projeção, conciliação e inadimplência por cliente. 14 dias grátis, sem cartão.',
}

// A landing. Quem chega à raiz do domínio sem sessão vê esta página (o proxy
// reescreve "/" para cá); quem está logado continua caindo no painel.
//
// Regra de redação desta página: só afirmar o que o sistema faz hoje. Cada
// frase abaixo tem uma tela ou uma regra no código por trás, e os preços vêm
// da mesma constante da tela de planos, para a landing nunca prometer um
// valor que o checkout não cobra.

const DIFERENCIAIS = [
  ['Fluxo de caixa real, primeiro',
    'O passado sai das baixas, pela data do pagamento, igual ao extrato. O futuro é a agenda de vencimentos, com os vencidos em aberto rolando para o mês seguinte como o próprio Conta Azul faz. Nada estimado sem você pedir.'],
  ['Projeção que conhece a sua empresa',
    'Quando você quer ir além da agenda, a projeção desconta o que costuma atrasar pela taxa de recebimento medida na sua empresa e separa sazonalidade de crescimento.'],
  ['Conciliação que diz onde está a pendência',
    'Não só quantos lançamentos faltam: em qual conta, desde quando e o que fazer em cada uma. Banco, cartão e gateway se conciliam de jeitos diferentes, e a tela diz qual é qual.'],
  ['O atraso que o Conta Azul apaga',
    'Quando um título é pago, o ERP esquece que ele atrasou. Aqui o histórico fica: cada cliente ganha um farol de pontual, atrasa às vezes ou atrasa sempre.'],
  ['A história de cada título',
    'Vencimento adiado, baixa parcial, valor alterado. Guardamos cada versão de cada lançamento, então dá para ver o que mudou e quando.'],
  ['Lançamento duplicado, achado',
    'O clique duplo que salvou a mesma conta duas vezes, e o par em que um já foi pago e o gêmeo segue em aberto esperando ser pago de novo.'],
]

const PASSOS = [
  ['Crie a conta',
    'E-mail e senha. O teste de 14 dias começa na hora, sem cartão de crédito.'],
  ['Autorize o Conta Azul',
    'Você entra no próprio Conta Azul e confirma o acesso. Nunca vemos a sua senha, e dá para revogar quando quiser.'],
  ['Veja os números',
    'Você escolhe quanto histórico trazer, de 6 a 36 meses, e vê antes quanto tempo cada opção leva. Depois disso a atualização é sozinha.'],
]

const TAMBEM = [
  ['Nota fiscal sem sair do painel',
    'Ative o emissor uma vez e emita a NFS-e a partir do recebível. A tela mostra só os títulos que ainda não têm nota, para não emitir duas vezes.'],
  ['Sua equipe, com papel certo',
    'Convide por link ou crie o acesso na hora: dono, financeiro, leitura ou contador. Cada um vê o que precisa.'],
  ['Uma leitura em cada indicador',
    'Ao lado de cada número, uma frase curta dizendo o que ele significa agora. Pode ser desligada, e nome de cliente nunca sai do nosso servidor.'],
]

const PERGUNTAS = [
  ['Funciona com qualquer plano do Conta Azul?',
    'Funciona com o Conta Azul Pro, que é o plano que oferece a API de integração. Nos outros planos a conexão não é liberada pelo próprio Conta Azul.'],
  ['Quanto tempo até ver os números?',
    'Você escolhe o período: de 6 a 36 meses de histórico. A tela mostra o tempo de cada opção calculado com o volume da sua empresa, em geral de poucos minutos a um quarto de hora, e dá para trazer mais histórico depois.'],
  ['O DriveAzul altera alguma coisa no meu Conta Azul?',
    'Não sem você mandar. O painel lê o financeiro. Só existe escrita quando você usa uma ação explícita para isso, como importar uma fatura de cartão.'],
  ['Dá para conectar mais de uma empresa?',
    'Sim. O Essencial cobre 1 empresa, o Profissional até 3 e o Escritório a partir de 5. Cada empresa pode ser vista sozinha ou somada com as outras.'],
  ['Como meus dados ficam protegidos?',
    'A autorização do Conta Azul é guardada cifrada, cada empresa enxerga só os próprios dados e o acesso pode ser revogado a qualquer momento dentro do Conta Azul.'],
  ['E depois dos 14 dias?',
    'Você escolhe um plano para continuar. O teste não pede cartão, então nada é cobrado sem você decidir.'],
]

export default function Inicio() {
  const planos = Object.entries(PLANOS)
  return (
    <div className={`${s.raiz} lp-raiz`}>
      <header className={s.topo}>
        <div className={s.miolo}>
          <Link href="/" className={s.marca}>
            <Image src={marca} alt="" width={30} height={30} priority />
            DriveAzul
          </Link>
          <nav className={s.links} aria-label="Seções">
            <a href="#como-funciona">Como funciona</a>
            <a href="#o-que-voce-ve">O que você vê</a>
            <a href="#planos">Planos</a>
            <a href="#perguntas">Perguntas</a>
          </nav>
          <div className={s.acoes}>
            <Link href="/login" className={s.vazado}>Entrar</Link>
            <Link href="/comecar" className={s.botao}>Começar grátis</Link>
          </div>
        </div>
      </header>

      <main>
        <section className={s.heroi}>
          <div className={s.miolo}>
            <h1 className={s.titulo}>Seu Conta Azul, lido de verdade.</h1>
            <p className={s.chamada}>
              O DriveAzul conecta no seu Conta Azul em minutos e mostra o que o
              ERP guarda e não conta: fluxo de caixa real, projeção, conciliação
              e o histórico de atraso de cada cliente.
            </p>
            <div className={s.ctaLinha}>
              <Link href="/comecar" className={s.botao}>Começar 14 dias grátis</Link>
              <Link href="/login" className={s.linkTexto}>Já tenho conta</Link>
            </div>
            <p className={s.letraMiuda}>Sem cartão de crédito. Para empresas no Conta Azul Pro.</p>

            <div className={s.vitrine}>
              <PainelIlustrativo />
              <p className={s.legendaVitrine}>Tela ilustrativa, com dados de exemplo.</p>
            </div>
          </div>
        </section>

        <section id="o-que-voce-ve" className={`${s.secao} ${s.faixaFog}`}>
          <div className={s.miolo}>
            <h2 className={s.secaoTitulo}>O que o Conta Azul guarda e não conta.</h2>
            <p className={s.secaoLead}>
              Os seus lançamentos já estão lá. O que falta é ler. Estas são as
              perguntas que o painel responde sem ninguém montar planilha.
            </p>
            <ol className={s.editorial}>
              {DIFERENCIAIS.map(([titulo, texto], i) => (
                <li key={titulo}>
                  <span className={s.num}>{String(i + 1).padStart(2, '0')}</span>
                  <h3>{titulo}</h3>
                  <p>{texto}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="como-funciona" className={`${s.secao} ${s.faixaInk}`}>
          <div className={s.miolo}>
            <h2 className={s.secaoTitulo}>
              Do cadastro ao painel em <span className={s.destaque}>minutos</span>.
            </h2>
            <p className={s.secaoLead}>
              Sem implantação, sem consultor e sem digitar nada de novo. Tudo
              que aparece no painel sai do que já está no seu Conta Azul.
            </p>
            <ol className={`${s.editorial} ${s.passos}`}>
              {PASSOS.map(([titulo, texto], i) => (
                <li key={titulo}>
                  <span className={s.num}>{String(i + 1).padStart(2, '0')}</span>
                  <h3>{titulo}</h3>
                  <p>{texto}</p>
                </li>
              ))}
            </ol>
            <div className={s.ctaLinha} style={{ justifyContent: 'flex-start' }}>
              <Link href="/comecar" className={s.botao}>Criar minha conta</Link>
            </div>
          </div>
        </section>

        <section className={s.secao}>
          <div className={s.miolo}>
            <h2 className={s.secaoTitulo}>E mais, no mesmo lugar.</h2>
            <div className={s.trio}>
              {TAMBEM.map(([titulo, texto]) => (
                <div className={s.cartao} key={titulo}>
                  <h3>{titulo}</h3>
                  <p>{texto}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="planos" className={`${s.secao} ${s.faixaFog}`}>
          <div className={s.miolo}>
            <h2 className={s.secaoTitulo}>Planos por empresa conectada.</h2>
            <p className={s.secaoLead}>
              Todos começam com 14 dias grátis. Você só escolhe depois de ver os
              seus números.
            </p>
            <div className={s.planos}>
              {planos.map(([chave, p], i) => {
                const forte = i === 1
                return (
                  <div key={chave} className={`${s.plano} ${forte ? s.planoForte : ''}`}>
                    <h3>{p.nome}</h3>
                    <div className={s.preco}>
                      R$ {p.preco}<small> /mês</small>
                    </div>
                    <p className={s.planoCapacidade}>
                      {p.precoPorEmpresaExtra
                        ? `${p.empresas} empresas, depois R$ ${p.precoPorEmpresaExtra} por empresa`
                        : `${p.empresas} ${p.empresas === 1 ? 'empresa' : 'empresas'}`}
                    </p>
                    <ul className={s.planoItens}>
                      {p.itens.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                    <Link href="/comecar" className={forte ? s.botao : s.vazado}>
                      Começar grátis
                    </Link>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section id="perguntas" className={s.secao}>
          <div className={s.miolo}>
            <h2 className={s.secaoTitulo}>Perguntas de quem está chegando.</h2>
            <div className={s.perguntas}>
              {PERGUNTAS.map(([p, r]) => (
                <details key={p}>
                  <summary>{p}</summary>
                  <p>{r}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className={s.secao} style={{ paddingTop: 0 }}>
          <div className={s.miolo}>
            <div className={s.final}>
              <h2 className={s.secaoTitulo}>Veja os seus números hoje.</h2>
              <p className={s.secaoLead}>
                Crie a conta, autorize o Conta Azul e em poucos minutos o painel
                está pronto. Quatorze dias grátis, sem cartão.
              </p>
              <div className={s.ctaLinha}>
                <Link href="/comecar" className={s.botao}>Começar grátis</Link>
                <Link href="/login" className={s.linkTexto}>Já tenho conta</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={s.rodape}>
        <div className={s.miolo}>
          <span>DriveAzul é um produto DriveData.</span>
          <nav aria-label="Rodapé">
            <Link href="/termos">Termos</Link>
            <Link href="/privacidade">Privacidade</Link>
            <Link href="/login">Entrar</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}

// Os pontos do gráfico de saldo do painel de exemplo, em coordenadas do SVG.
// Fixos de propósito: a vitrine tem que sair igual em toda visita.
const SALDO = [62, 58, 66, 61, 70, 74, 69, 80, 86, 83, 92, 98]

function PainelIlustrativo() {
  const w = 520
  const h = 150
  const passo = w / (SALDO.length - 1)
  const y = (v) => h - (v - 40) * (h / 70)
  const linha = SALDO.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * passo).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${linha} L${w},${h} L0,${h} Z`

  return (
    <div className={s.painel} aria-hidden="true">
      <div className={s.pLateral}>
        <div className={s.pMarca}>
          <Image src={marca} alt="" width={20} height={20} />
          DriveAzul
        </div>
        <div className={s.pGrupo}><i style={{ background: '#2a78d6' }} />Panorama</div>
        <div className={`${s.pItem} ${s.pAtivo}`}>Visão geral</div>
        <div className={s.pItem}>Resumo executivo</div>
        <div className={s.pGrupo}><i style={{ background: '#0f9d8a' }} />Caixa</div>
        <div className={s.pItem}>Fluxo de caixa</div>
        <div className={s.pItem}>Contas a pagar e receber</div>
        <div className={s.pGrupo}><i style={{ background: '#7c5cd6' }} />Resultado</div>
        <div className={s.pItem}>DRE gerencial</div>
        <div className={s.pGrupo}><i style={{ background: '#e8a013' }} />Fiscal</div>
        <div className={s.pItem}>Notas fiscais</div>
      </div>

      <div className={s.pConteudo}>
        <div className={s.pTitulo}>Visão geral</div>
        <div className={s.pSub}>Empresa Exemplo Ltda · saldo apurado hoje</div>

        <div className={s.pTiles}>
          <div className={s.pTile}>
            <div className={s.pRotulo}>Faturamento médio</div>
            <div className={s.pValor}>R$ 96.400</div>
            <div className={`${s.pNota} ${s.pBom}`}>+18% nos últimos 3 meses</div>
          </div>
          <div className={s.pTile}>
            <div className={s.pRotulo}>Saldo em conta</div>
            <div className={s.pValor}>R$ 184.320</div>
            <div className={s.pNota}>sem contar limite de cartão</div>
          </div>
          <div className={s.pTile}>
            <div className={s.pRotulo}>A receber</div>
            <div className={s.pValor}>R$ 312.900</div>
            <div className={`${s.pNota} ${s.pRuim}`}>R$ 21.400 vencidos</div>
          </div>
          <div className={s.pTile}>
            <div className={s.pRotulo}>A pagar</div>
            <div className={s.pValor}>R$ 141.250</div>
            <div className={s.pNota}>nada vencido</div>
          </div>
        </div>

        <div className={s.pLinha2}>
          <div className={s.pCartao}>
            <div className={s.pCartaoTitulo}>Saldo em conta, 12 meses</div>
            <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="150" preserveAspectRatio="none">
              <path d={area} fill="rgba(42, 120, 214, 0.12)" />
              <path d={linha} fill="none" stroke="#2a78d6" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div className={s.pCartao}>
            <div className={s.pCartaoTitulo}>A receber por atraso</div>
            {[
              ['A vencer', 78, '#86b6ef', '244 mil'],
              ['1 a 30 dias', 14, '#2a78d6', '41 mil'],
              ['31 a 60 dias', 6, '#1c5cab', '18 mil'],
              ['mais de 60', 3, '#104281', '9 mil'],
            ].map(([rotulo, pct, cor, valor]) => (
              <div className={s.pBarra} key={rotulo}>
                <span>{rotulo}</span>
                <span className={s.pTrilho}><b style={{ width: `${pct}%`, background: cor }} /></span>
                <span>{valor}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
