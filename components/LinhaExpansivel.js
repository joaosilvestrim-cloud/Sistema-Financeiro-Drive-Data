'use client'
import { useState } from 'react'
import { brl, dataCurta, pct } from '@/lib/format'

// Linha de tabela que abre e mostra o que está por trás do número.
//
// O detalhe vem como dado, não como JSX pronto. A primeira versão passava a
// tabela do detalhe montada, como filhos, e a página do resumo saltou de 84 KB
// para 1,1 MB e de 0,7 para 11 segundos: cada elemento de cada linha ia
// serializado no payload. Dado cru custa uma fração disso e o desenho fica
// aqui, onde ele é código e não conteúdo.
//
// E o detalhe mostra os maiores, não todos. Uma faixa com 205 títulos não cabe
// dentro de uma linha nem ajuda quem está decidindo: o que decide é o que pesa.
// A lista inteira mora na tela própria daquele assunto.
//
// O corte é feito no servidor e chega pronto aqui, com `total` dizendo quantos
// existem de verdade. Mandar 640 títulos pela rede para desenhar 8 aparecia no
// relógio de quem abria a tela.
//
// As colunas do detalhe são declaradas por quem chama, em `campos`, porque cada
// tela abre uma coisa diferente: no aging abre título, no DRE abre categoria
// por período, em Recebíveis abre o histórico da própria parcela. O padrão é o
// desenho de título, que é o caso mais comum.

const TITULOS = [
  { chave: 'data_vencimento', titulo: 'Vencimento', tipo: 'data' },
  { chave: 'pessoa', titulo: 'Quem', tipo: 'texto', largura: 160 },
  { chave: 'descricao', titulo: 'Descrição', tipo: 'texto', largura: 240 },
  { chave: 'nao_pago', titulo: 'Em aberto', tipo: 'dinheiro' },
  { chave: 'dias_atraso', titulo: 'Atraso', tipo: 'atraso' },
]

// Um valor nulo vira travessão em vez de "R$ 0,00": zero e ausência são coisas
// diferentes e quem lê precisa distinguir as duas.
function formatar(valor, tipo) {
  if (valor === null || valor === undefined || valor === '') return '—'
  if (tipo === 'dinheiro') return brl(valor)
  if (tipo === 'data') return dataCurta(valor)
  if (tipo === 'percentual') return pct(valor)
  if (tipo === 'inteiro') return Number(valor).toLocaleString('pt-BR')
  if (tipo === 'atraso') return Number(valor) > 0 ? `${valor} d` : '—'
  return String(valor)
}

const NUMERICO = new Set(['dinheiro', 'percentual', 'inteiro', 'atraso'])

export default function LinhaExpansivel({
  celulas, colunas, itens = [], total, rotulo, campos = TITULOS, rodape,
}) {
  const [aberta, setAberta] = useState(false)

  const alternar = () => setAberta((v) => !v)
  const noTeclado = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      alternar()
    }
  }

  const quantos = total ?? itens.length
  const restantes = quantos - itens.length

  return (
    <>
      <tr
        className="expansivel" data-aberta={aberta}
        onClick={alternar} onKeyDown={noTeclado}
        tabIndex={0} role="button" aria-expanded={aberta}
      >
        <td className="seta" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="11" height="11" fill="none"
               stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3.5L10.5 8L6 12.5" />
          </svg>
        </td>
        {celulas}
      </tr>

      {aberta && (
        <tr className="detalhe">
          <td colSpan={colunas}>
            {itens.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12 }}>
                Nada aqui dentro.
              </p>
            ) : (
              <>
                <div className="detalhe-titulo">
                  {rotulo}
                  {restantes > 0 && ` · mostrando os ${itens.length} maiores`}
                </div>
                <table>
                  <thead>
                    <tr>
                      {campos.map((c) => (
                        <th key={c.chave} className={NUMERICO.has(c.tipo) ? 'num' : undefined}>
                          {c.titulo}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((item, i) => (
                      <tr key={i}>
                        {campos.map((c) => {
                          const bruto = item[c.chave]
                          const negativo = c.tipo === 'atraso'
                            ? Number(bruto) > 0
                            : c.negativoSe === 'menor' && Number(bruto) < 0
                          return (
                            <td
                              key={c.chave}
                              className={NUMERICO.has(c.tipo) ? 'num' : undefined}
                              style={{
                                ...(c.largura
                                  ? { maxWidth: c.largura, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                                  : null),
                                ...(negativo ? { color: 'var(--critical)' } : null),
                              }}
                            >
                              {formatar(bruto, c.tipo)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {restantes > 0 && (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0' }}>
                    Mais {restantes} linha(s) além das mostradas.
                  </p>
                )}
                {rodape && (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0' }}>
                    {rodape}
                  </p>
                )}
              </>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
