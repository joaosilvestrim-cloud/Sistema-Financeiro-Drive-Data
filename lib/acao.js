import 'server-only'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

// Envelope para toda Server Action que pode falhar por culpa do dado.
//
// Existe por causa de um erro real em produção: clicar em "Emitir NFS-e" com a
// empresa ainda não habilitada no emissor derrubava a tela inteira com "a
// server error occurred". A mensagem certa existia, era a nossa própria
// validação, e o Next a trocou por um digest antes de chegar ao navegador.
//
// A regra que isto grava: **falha de cadastro é recado, não tela quebrada.**
// Toda ação aqui pode falhar por motivo que o usuário resolve sozinho, se
// souber qual é: campo em branco, cliente sem CNPJ, planilha fora do formato,
// prefeitura recusando por uma regra que só ela tem, IA sem resposta. Nenhum
// desses é defeito do sistema, e nenhum deles justifica perder a página.
//
// O recado volta pela URL. Não é elegante, e é o único jeito que sobrevive ao
// redesenho do servidor sem exigir estado no cliente nem transformar cada
// formulário em componente de navegador.

// O redirect do Next funciona lançando. Se este envelope engolir a exceção
// dele, um `redirect()` legítimo dentro da ação vira mensagem de erro em vez de
// navegação, e a autorização da Conta Azul, que é um redirect, para de
// funcionar. O mesmo vale para notFound.
function ehNavegacao(e) {
  const d = e?.digest
  return typeof d === 'string' && (d.startsWith('NEXT_REDIRECT') || d === 'NEXT_NOT_FOUND')
}

// Guarda a falha capturada. O onRequestError do Next não vê o que nós pegamos,
// então sem isto a gente trocaria a tela quebrada por um erro invisível, o que
// é pior: pelo menos a tela quebrada aparecia no log.
async function registrar(rota, e) {
  try {
    const { query } = await import('@/src/db.mjs')
    await query(
      `insert into core.app_error (rota, digest, mensagem, stack, contexto)
       values ($1, $2, $3, $4, $5)`,
      [
        rota,
        'ACAO_TRATADA',
        String(e?.message ?? e).slice(0, 2000),
        String(e?.stack ?? '').slice(0, 8000),
        { rota, tipo: 'action', tratado: true },
      ],
    )
  } catch {
    // Silêncio de propósito: erro ao registrar erro não pode virar o segundo.
  }
}

export async function comAviso(rota, fn) {
  let recado = null
  try {
    await fn()
  } catch (e) {
    if (ehNavegacao(e)) throw e
    await registrar(rota, e)
    // A mensagem vai inteira para quem clicou, cortada só no tamanho. Ela é
    // quase sempre a nossa própria validação, escrita para ser lida; e quando
    // vem de fora, como uma recusa de prefeitura, é ela que diz o que corrigir.
    recado = String(e?.message ?? 'Não foi possível concluir a ação.').slice(0, 300)
  }

  revalidatePath(rota)
  // Fora do try de propósito: ver ehNavegacao acima.
  redirect(recado ? `${rota}?erro=${encodeURIComponent(recado)}` : rota)
}

// O outro envelope, para ação que devolve dado em vez de recarregar a tela.
//
// A importação de fatura já nasceu com esta convenção: o servidor devolve
// `{ erro }` e o componente mostra a frase, sem recarregar nada. É melhor que
// redirecionar quando existe estado no meio do caminho, como as linhas que a
// pessoa marcou.
//
// O que faltava era a metade de baixo. As validações devolviam `{ erro }`
// direitinho, mas a leitura do arquivo e as chamadas à Conta Azul continuavam
// livres para lançar, e uma planilha fora do formato ou um token vencido
// viravam promessa rejeitada dentro do useTransition, sem ninguém para pegar.
// O resultado é o mesmo da tela quebrada, só que sem nem o erro na página.
export async function comRetorno(fn) {
  try {
    return await fn()
  } catch (e) {
    if (ehNavegacao(e)) throw e
    await registrar('acao', e)
    return { erro: String(e?.message ?? 'Não foi possível concluir a ação.').slice(0, 300) }
  }
}
