import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Diagnóstico de produção.
//
// Quando o painel inteiro cai, o Next esconde a mensagem do erro e devolve só um
// digest. Isso protege o usuário e cega quem precisa consertar. Esta rota faz o
// caminho inteiro em pedaços e diz qual pedaço falhou, com a mensagem.
//
// Duas regras que a fazem segura de existir:
//
// 1. Exige sessão. Sem login não devolve nada, porque a lista de variáveis
//    presentes já é informação sobre a infraestrutura.
//
// 2. Nunca devolve valor de variável, só se ela existe. Segredo em resposta HTTP
//    vira segredo em log de proxy.

const ESPERADAS = [
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'DATABASE_URL_POOLED', 'DATABASE_URL',
  'CONTAAZUL_CLIENT_ID', 'CONTAAZUL_CLIENT_SECRET', 'CONTAAZUL_REDIRECT_URI',
  'CONTAAZUL_LOGIN_URL', 'CONTAAZUL_TOKEN_URL', 'CONTAAZUL_API_URL',
  'OAUTH_STATE_SECRET', 'TOKEN_ENCRYPTION_KEY',
  'CRON_SECRET', 'GROQ_API_KEY', 'GROQ_MODEL',
]

async function tenta(nome, fn) {
  const t0 = Date.now()
  try {
    return { etapa: nome, ok: true, ms: Date.now() - t0, resultado: await fn() }
  } catch (e) {
    return {
      etapa: nome, ok: false, ms: Date.now() - t0,
      erro: e.message?.slice(0, 400) ?? String(e),
      codigo: e.code ?? null,
    }
  }
}

export async function GET() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ erro: 'precisa estar logado' }, { status: 401 })

  const etapas = []

  etapas.push(await tenta('lib/db responde', async () => {
    const { q1 } = await import('@/lib/db')
    const r = await q1('select current_database() as banco, version() as versao')
    return { banco: r.banco, versao: String(r.versao).slice(0, 30) }
  }))

  etapas.push(await tenta('src/db.mjs responde', async () => {
    const { query } = await import('@/src/db.mjs')
    const { rows } = await query('select 1 as um')
    return rows[0]
  }))

  etapas.push(await tenta('consulta da sessao', async () => {
    const { q1 } = await import('@/lib/db')
    return q1(
      `select m.tenant_id, t.plano, t.status, t.limite_empresas, t.ia_habilitada,
              ceil(extract(epoch from (t.trial_ate - now())) / 86400)::int as dias_restantes
         from core.tenant_member m join core.tenant t on t.id = m.tenant_id
        where m.user_id = $1 limit 1`,
      [user.id],
    )
  }))

  etapas.push(await tenta('colunas novas existem', async () => {
    const { q } = await import('@/lib/db')
    const cols = await q(
      `select table_name || '.' || column_name as coluna
         from information_schema.columns
        where table_schema = 'core'
          and (table_name, column_name) in
              (('tenant','plano'), ('tenant','acesso_ate'), ('tenant','ia_habilitada'),
               ('tenant','aliquota_anexo_iii'), ('settlement','reconciliacao_external_id'))`,
    )
    return cols.map((c) => c.coluna)
  }))

  etapas.push(await tenta('tabelas novas existem', async () => {
    const { q } = await import('@/lib/db')
    const t = await q(
      `select table_name from information_schema.tables
        where table_schema = 'core'
          and table_name in ('card_import','onboarding_job','billing_event',
                             'category_classe','cliente_regime','sync_cursor')
        order by 1`,
    )
    return t.map((x) => x.table_name)
  }))

  // O caminho exato que as telas fazem. As etapas acima passam e as telas
  // quebram, entao o erro esta entre a sessao e a primeira consulta da pagina.
  etapas.push(await tenta('requireSession completo', async () => {
    const { requireSession } = await import('@/lib/session')
    const s = await requireSession()
    return {
      tenant: s.tenantNome, escopo: s.connectionId ?? 'consolidado',
      conexoes: s.conexoes?.length, conta: s.conta,
    }
  }))

  etapas.push(await tenta('dados da tela DRE', async () => {
    const { requireSession } = await import('@/lib/session')
    const { dre } = await import('@/lib/dre')
    const d = await dre(await requireSession(), 'mes')
    return { periodos: d.periodos.length, receitas: d.receitas.length }
  }))

  etapas.push(await tenta('dados do Resumo executivo', async () => {
    const { requireSession } = await import('@/lib/session')
    const { conciliacao } = await import('@/lib/executivo')
    const c = await conciliacao(await requireSession())
    return { pendentes: c.pendentes, conciliadas: c.conciliadas }
  }))

  etapas.push(await tenta('componente Marca', async () => {
    const m = await import('@/components/Marca')
    return { carregou: typeof m.default === 'function' }
  }))

  return NextResponse.json({
    ambiente: {
      vercel: !!process.env.VERCEL,
      regiao: process.env.VERCEL_REGION ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      node: process.version,
    },
    // Só o nome, nunca o valor.
    variaveis: Object.fromEntries(ESPERADAS.map((v) => [v, !!process.env[v]])),
    etapas,
    ok: etapas.every((e) => e.ok),
  })
}
