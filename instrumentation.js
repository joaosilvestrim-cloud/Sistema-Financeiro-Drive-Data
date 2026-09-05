// Captura de erro de produção.
//
// O Next chama onRequestError no servidor com o erro inteiro, antes de trocar a
// mensagem pelo digest que chega ao navegador. Sem isto, um painel fora do ar em
// produção deixa como única pista um número.
//
// A gravação é best-effort e engolida: um erro ao registrar erro não pode virar
// um segundo erro em cima do primeiro.

export function register() {}

export async function onRequestError(err, request, context) {
  try {
    const { query } = await import('./src/db.mjs')
    await query(
      `insert into core.app_error (rota, digest, mensagem, stack, contexto)
       values ($1, $2, $3, $4, $5)`,
      [
        request?.path ?? null,
        err?.digest ?? null,
        String(err?.message ?? err).slice(0, 2000),
        String(err?.stack ?? '').slice(0, 8000),
        {
          rota: context?.routePath ?? null,
          tipo: context?.routeType ?? null,
          metodo: request?.method ?? null,
        },
      ],
    )
  } catch {
    // Silêncio de propósito. Ver o comentário acima.
  }
}
