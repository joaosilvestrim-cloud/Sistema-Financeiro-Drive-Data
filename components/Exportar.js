'use client'
import { paraCsv, nomeDoArquivo } from '@/lib/csv'

// Botão de exportar tabela.
//
// Gera o arquivo no navegador, a partir dos mesmos dados que a tela já recebeu.
// Não existe rota de exportação de propósito: uma rota refaria a consulta e
// abriria a chance de o arquivo sair diferente do que está na tela, que é
// exatamente o tipo de divergência que ninguém percebe até o cliente perceber.
//
// O objeto de URL é liberado depois do clique. Sem isso, cada exportação deixa
// o arquivo preso na memória da aba até ela fechar.
export default function Exportar({ linhas, colunas, arquivo, rotulo = 'Exportar' }) {
  const quantidade = linhas?.length ?? 0

  function baixar() {
    const csv = paraCsv(linhas, colunas)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = nomeDoArquivo(arquivo)
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      className="toggle" type="button" onClick={baixar} disabled={!quantidade}
      title={quantidade ? `${quantidade} linha(s) para Excel` : 'nada para exportar'}
    >
      ↓ {rotulo}
    </button>
  )
}
