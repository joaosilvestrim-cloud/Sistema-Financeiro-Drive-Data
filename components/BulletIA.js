import { insights } from '@/lib/insights'

// A leitura da IA para um indicador.
//
// Fica dentro de um Suspense na tela, então o número aparece na hora e a frase
// chega depois. Nenhum indicador espera a IA para ser mostrado: o dado é o
// produto, a leitura é o complemento.
export default async function BulletIA({ sessao, chave }) {
  const bullets = await insights(sessao)
  const texto = bullets?.[chave]
  if (!texto || texto === 'sem base para interpretar') return null

  return (
    <div className="bullet">
      <span className="bullet-marca" aria-label="leitura por inteligência artificial">IA</span>
      {texto}
    </div>
  )
}
