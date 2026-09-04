import 'server-only'

// Troca nome próprio por apelido antes de o dossiê sair para a IA, e desfaz a
// troca no texto que volta.
//
// O motivo é simples de enunciar e fácil de errar. A Groq processa nos Estados
// Unidos. Razão social de cliente e nome de conta bancária são dado da empresa
// que nos contratou, e mandar isso para fora sem necessidade é transferência
// internacional que dá para evitar. Mas apagar o nome pioraria o produto: um
// bullet dizendo "o maior cliente" vale menos que um dizendo "a Coferly".
//
// Por isso pseudônimo, e não anonimização. Sai "Cliente A", volta "Cliente A",
// e a substituição de volta acontece aqui no servidor. O nome real nunca sai da
// nossa infraestrutura, e a pessoa continua lendo o nome real na tela.

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function mascarar(dossie) {
  if (!dossie) return { dossie, mapa: new Map() }

  const mapa = new Map()
  const copia = structuredClone(dossie)

  const apelidar = (real, prefixo, i) => {
    if (!real) return real
    const apelido = `${prefixo} ${LETRAS[i] ?? i + 1}`
    mapa.set(apelido, real)
    return apelido
  }

  if (Array.isArray(copia.maiores_clientes_no_historico_completo)) {
    copia.maiores_clientes_no_historico_completo =
      copia.maiores_clientes_no_historico_completo.map((c, i) => ({
        ...c, nome: apelidar(c.nome, 'Cliente', i),
      }))
  }

  if (Array.isArray(copia.contas_financeiras)) {
    copia.contas_financeiras = copia.contas_financeiras.map((c, i) => ({
      // O tipo fica: "conta corrente" e "cartao de credito" mudam a leitura e
      // não identificam ninguém.
      ...c, nome: apelidar(c.nome, 'Conta', i),
    }))
  }

  return { dossie: copia, mapa }
}

// Desfaz a troca. Ordena do apelido mais longo para o mais curto para o caso de
// "Cliente A" e "Cliente AB" existirem juntos, onde substituir o curto primeiro
// quebraria o longo.
export function revelar(texto, mapa) {
  if (!texto || !mapa?.size) return texto
  let saida = texto
  for (const apelido of [...mapa.keys()].sort((a, b) => b.length - a.length)) {
    saida = saida.split(apelido).join(mapa.get(apelido))
  }
  return saida
}

// Percorre o resultado da IA, que pode ser texto solto ou objeto de bullets, e
// devolve o nome real em qualquer string que encontrar.
export function revelarEmTudo(valor, mapa) {
  if (!mapa?.size) return valor
  if (typeof valor === 'string') return revelar(valor, mapa)
  if (Array.isArray(valor)) return valor.map((v) => revelarEmTudo(v, mapa))
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [k, revelarEmTudo(v, mapa)]),
    )
  }
  return valor
}
