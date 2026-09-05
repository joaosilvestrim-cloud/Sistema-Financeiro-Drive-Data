// Ícones do menu.
//
// Desenhados à mão, sem biblioteca. Quinze ícones não justificam uma dependência
// de centenas, e uma biblioteca genérica traria um traço diferente do resto da
// interface.
//
// Todos seguem a mesma regra para parecerem um conjunto e não uma coleção: grade
// de 16, só contorno, espessura 1.4, pontas arredondadas, e a cor vem de
// currentColor. Isso último é o que faz o ícone acompanhar o estado do link sem
// nenhuma regra a mais: no hover e no ativo ele muda junto com o texto.

const D = {
  // Painéis lado a lado.
  resumo: 'M2.5 2.5h4.2v4.2H2.5zM9.3 2.5h4.2v4.2H9.3zM2.5 9.3h4.2v4.2H2.5zM9.3 9.3h4.2v4.2H9.3z',
  // Ponteiro de velocímetro.
  visao: 'M2.2 11.5a5.8 5.8 0 1 1 11.6 0M8 11.5l3-3.2',
  // Linha que sobe e desce.
  fluxo: 'M1.8 12.2l3.6-4.1 2.6 2.6 4.4-5.2M1.8 14.2h12.4',
  // Linha com seta para cima.
  previsao: 'M1.8 11.8l3.8-3.9 2.5 2.5 4.3-4.6M10.5 5.3h3.9v3.9',
  // Seta entrando na bandeja.
  recebiveis: 'M8 1.8v6.6M5.4 6.2L8 8.8l2.6-2.6M2.4 10.4v2.2a1.1 1.1 0 0 0 1.1 1.1h9a1.1 1.1 0 0 0 1.1-1.1v-2.2',
  // Folha com dobra e linhas.
  dre: 'M3.4 1.6h5.7l3.5 3.5v9.3H3.4zM9.1 1.6v3.5h3.5M5.7 8.2h4.6M5.7 10.6h4.6M5.7 13h2.8',
  // Etiqueta de preço.
  preco: 'M2.4 7.8V2.4h5.4l6 6-5.4 5.4-6-6zM5.1 5.1h.01',
  // Cupom com percentual.
  impostos: 'M3.4 1.7h9.2v12.6l-1.5-1-1.6 1-1.5-1-1.6 1-1.5-1-1.5 1zM6 5.4h4M6 8.2h4M6 11h2.2',
  // Pulso.
  indicadores: 'M1.6 8.2h2.9l1.9-4.6 3.1 9.2 1.9-4.6h2.9',
  // Duas pessoas.
  clientes: 'M6.1 7.4a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6M1.7 13.6c0-2.4 2-4.1 4.4-4.1s4.4 1.7 4.4 4.1M11 3.1a2.2 2.2 0 0 1 0 4.2M12.3 9.9c1.3.5 2 1.8 2 3.2',
  // Relógio.
  produtividade: 'M8 1.7a6.3 6.3 0 1 0 0 12.6A6.3 6.3 0 0 0 8 1.7M8 4.4V8l2.6 1.6',
  // Alvo.
  metas: 'M8 1.9a6.1 6.1 0 1 0 0 12.2A6.1 6.1 0 0 0 8 1.9M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6M8 7.7h.01',
  // Cartão com tarja.
  fatura: 'M1.7 3.9h12.6v8.2H1.7zM1.7 6.6h12.6M4.1 9.7h2.6',
  // Camadas de banco de dados.
  dados: 'M8 1.9c3 0 5.4.9 5.4 2s-2.4 2-5.4 2-5.4-.9-5.4-2 2.4-2 5.4-2M2.6 3.9v4c0 1.1 2.4 2 5.4 2s5.4-.9 5.4-2v-4M2.6 7.9v4.2c0 1.1 2.4 2 5.4 2s5.4-.9 5.4-2V7.9',
  // Elo de corrente.
  conexoes: 'M6.6 9.4a2.9 2.9 0 0 0 4.3.3l1.8-1.8a2.9 2.9 0 0 0-4.1-4.1l-1 1M9.4 6.6a2.9 2.9 0 0 0-4.3-.3L3.3 8.1a2.9 2.9 0 0 0 4.1 4.1l1-1',
}

export default function Icone({ nome }) {
  const d = D[nome]
  if (!d) return null
  return (
    <svg
      className="icone" viewBox="0 0 16 16" width="16" height="16"
      fill="none" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}
