// Teste do leitor de planilha. Roda sem banco e sem servidor.
import { lerCsv } from '../lib/csv.js'

let falhas = 0
const conferir = (nome, texto, esperado) => {
  const { pontos } = lerCsv(texto)
  const obtido = pontos.map((p) => `${p.competencia}=${p.valor}`).join(' ')
  const ok = obtido === esperado
  if (!ok) falhas++
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${nome}`)
  if (!ok) console.log(`      esperado: ${esperado}\n      obtido:   ${obtido}`)
}

conferir('ponto e virgula com decimal em virgula',
  'competencia;valor\n2027-01;150.000,00\n2027-02;R$ 160.000,50',
  '2027-01=150000 2027-02=160000.5')

conferir('virgula como separador, decimal em ponto',
  'competencia,valor\n2027-01,150000\n2027-02,160000.5',
  '2027-01=150000 2027-02=160000.5')

conferir('tabulacao', 'jan/27\t99.999,99\nfev/27\t100000', '2027-01=99999.99 2027-02=100000')
conferir('mes barra ano', '01/2027;1.234,56', '2027-01=1234.56')
conferir('data completa', '15/03/2027;500', '2027-03=500')
conferir('iso com dia', '2027-04-15;500', '2027-04=500')
conferir('negativo', '2027-05;-1.500,25', '2027-05=-1500.25')
conferir('cabecalho ignorado', 'mes;meta\n2027-06;10', '2027-06=10')

const { erros } = lerCsv('2027-01;abc\n2027-02;10')
console.log(`${erros.length === 1 ? 'ok   ' : 'FALHA'} linha invalida vira erro, nao valor errado`)
if (erros.length !== 1) falhas++

console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.')
process.exit(falhas ? 1 : 0)
