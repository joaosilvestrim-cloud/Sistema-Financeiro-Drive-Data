import 'server-only'
import { q, q1 } from './db.js'

// Criação de conta e situação da assinatura.
//
// O tenant não nasce no cadastro, nasce no primeiro acesso autenticado. O
// motivo é não precisar da chave de service role no app: quem cria o usuário é
// o próprio Supabase Auth, pelo navegador, e aqui a gente só reage a uma sessão
// que já existe e já foi verificada. Se o cadastro exigir confirmação de
// e-mail, o tenant simplesmente nasce quando a pessoa confirma e volta.

const DIAS_DE_TESTE = 14

// Slug legível e único. O e-mail entra na conta porque duas pessoas podem
// cadastrar empresas com o mesmo nome no mesmo dia.
function montarSlug(nome, email) {
  const base = String(nome || email || 'empresa')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'empresa'
  const sufixo = Math.random().toString(36).slice(2, 7)
  return `${base}-${sufixo}`
}

// Cria o tenant do usuário se ele ainda não tem nenhum, e devolve o vínculo.
//
// Roda dentro de uma transação porque duas abas abertas no primeiro acesso
// criariam duas empresas para a mesma pessoa. O insert do vínculo tem chave
// primária composta, então a segunda tentativa não duplica, mas o tenant órfão
// ficaria para trás. A checagem dentro da transação evita isso.
export async function garantirConta(user, { empresa, origem } = {}) {
  const jaTem = await q1(
    `select tenant_id from core.tenant_member where user_id = $1 limit 1`,
    [user.id],
  )
  if (jaTem) return { tenantId: jaTem.tenant_id, criada: false }

  const nome = (empresa || user.user_metadata?.empresa || '').trim()
    || (user.email?.split('@')[1]?.split('.')[0] ?? 'Minha empresa')

  const [tenant] = await q(
    `insert into core.tenant (nome, slug, plano, trial_ate, status, limite_empresas, origem)
     values ($1, $2, 'trial', now() + make_interval(days => $3), 'ativo', 1, $4)
     returning id`,
    [nome, montarSlug(nome, user.email), DIAS_DE_TESTE,
     origem || user.user_metadata?.origem || 'direto'],
  )

  await q(
    `insert into core.tenant_member (tenant_id, user_id, role)
     values ($1, $2, 'owner')
     on conflict (tenant_id, user_id) do nothing`,
    [tenant.id, user.id],
  )

  return { tenantId: tenant.id, criada: true }
}

// Situação comercial do tenant, já traduzida para o que a tela precisa decidir.
export async function assinatura(tenantId) {
  const t = await q1(
    `select nome, plano, status, trial_ate, limite_empresas,
            -- A contagem sai do relógio do banco, e não da mistura com o do
            -- servidor. A auditoria mediu 31 segundos de diferença entre os
            -- dois, e com arredondamento para cima isso virava "15 dias" num
            -- teste de 14. Contar prazo com dois relógios está errado por
            -- construção, mesmo quando a diferença parece pequena.
            ceil(extract(epoch from (trial_ate - now())) / 86400)::int  as dias_restantes,
            trial_ate is not null and trial_ate <= now()                as teste_vencido,
            (select count(*)::int from core.connection
              where tenant_id = core.tenant.id and status = 'connected') as empresas
       from core.tenant where id = $1`,
    [tenantId],
  )
  if (!t) return null

  const emTeste = t.plano === 'trial' && !!t.trial_ate

  return {
    ...t,
    emTeste,
    // Arredondado para cima no banco: no último dia a tela diz "1 dia", não "0".
    diasRestantes: emTeste ? Math.max(0, t.dias_restantes) : null,
    testeVencido: emTeste && t.teste_vencido,
    podeConectarMais: t.empresas < t.limite_empresas,
  }
}
