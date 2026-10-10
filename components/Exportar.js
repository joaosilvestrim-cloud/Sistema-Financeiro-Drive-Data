'use client'
import { paraCsv, nomeDoArquivo } from '@/lib/csv'

// Botão de exportar tabela.
//
// Dois modos. Sem `href`, gera o arquivo no navegador a partir das linhas que
// a tela já recebeu: serve quando a tela mostra tudo o que exporta.
//
// Com `href`, baixa de uma rota. Serve quando a tela é paginada: a tela de
// Contas mostra 80 linhas por vez e o botão exportava só essas 80, de uma
// carteira de 850. A rota usa o mesmo leitor de URL e a mesma consulta da tela,
// então o arquivo não tem como sair com outro recorte.
//
// O objeto de URL é liberado depois do clique. Sem isso, cada exportação deixa
// o arquivo preso na memória da aba até ela fechar.
export default function Exportar({ linhas, colunas, arquivo, rotulo = 'Exportar', href = null, quantidade = null }) {
  const total = quantidade ?? linhas?.length ?? 0

  function baixar() {
    const csv = paraCsv(linhas, colunas)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = nomeDoArquivo(arquivo)
    a.click()
    URL.revokeObjectURL(url)
  }

  const titulo = total ? `${total} linha(s) para Excel` : 'nada para exportar'

  if (href && total) {
    return <a className="toggle" href={href} download title={titulo}>↓ {rotulo}</a>
  }

  return (
    <button className="toggle" type="button" onClick={baixar} disabled={!total} title={titulo}>
      ↓ {rotulo}
    </button>
  )
}
