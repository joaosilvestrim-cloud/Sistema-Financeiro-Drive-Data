import 'server-only'
import { randomBytes } from 'node:crypto'
import { q, q1 } from './db.js'

// Equipe do tenant: membros, convites e o vínculo no primeiro login.
//
// A regra que desenhou tudo isto: sem service role na Vercel. O app não cria
// usuário; ele registra a intenção (convite) e reconhece o convidado quando
// ele chega sozinho pelo cadastro público. O e-mail usado no casamento é o
// que o Supabase confirmou, não o que alguém digitou.

const PAPEIS = ['financeiro', 'leitura', 'contador']

export const PAPEL_ROTULO = {
  owner: 'dono',
  financeiro: 'financeiro',
  leitura: 'leitura',
  contador: 'contador',
}

function exigirDono(sessao) {
  if (sessao.role !== 'owner') {
    throw new Error('Só o dono da conta convida e remove pessoas.')
  }
}

export async function membros(sessao) {
  return q(
    `select m.user_id, m.role, m.created_at, u.email
       from core.tenant_member m
       join auth.users u on u.id = m.user_id
      where m.tenant_id = $1
      order by m.role = 'owner' desc, m.created_at`,
    [sessao.tenantId],
  )
}

export async function convitesPendentes(sessao) {
  return q(
    `select id, email, papel, token, criado_em, expira_em,
            expira_em < now() as vencido
       from core.tenant_convite
      where tenant_id = $1 and aceito_em is null and revogado_em is null
      order by criado_em desc`,
    [sessao.tenantId],
  )
}

export async function convidar(sessao, emailCru, papel) {
  exigirDono(sessao)
  const email = String(emailCru ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('E-mail inválido.')
  if (!PAPEIS.includes(papel)) throw new Error('Papel inválido.')

  const jaMembro = await q1(
    `select 1 from core.tenant_member m join auth.users u on u.id = m.user_id
      where m.tenant_id = $1 and lower(u.email) = $2`,
    [sessao.tenantId, email],
  )
  if (jaMembro) throw new Error('Essa pessoa já faz parte da equipe.')

  const token = randomBytes(16).toString('hex')
  let convite
  try {
    convite = await q1(
      `insert into core.tenant_convite (tenant_id, email, papel, token, convidado_por)
       values ($1, $2, $3, $4, $5) returning id, token`,
      [sessao.tenantId, email, papel, token, sessao.user?.id ?? null],
    )
  } catch (e) {
    if (String(e.message).includes('tenant_convite_vivo')) {
      throw new Error('Já existe convite pendente para esse e-mail. Revogue-o para reenviar.')
    }
    throw e
  }

  const link = `${base()}/comecar?convite=${convite.token}`
  const emailEnviado = await enviarConvite({ para: email, link, empresa: sessao.conta?.nome })
  return { link, emailEnviado }
}

export async function revogarConvite(sessao, id) {
  exigirDono(sessao)
  await q(
    `update core.tenant_convite set revogado_em = now()
      where id = $1 and tenant_id = $2 and aceito_em is null`,
    [id, sessao.tenantId],
  )
}

export async function removerMembro(sessao, userId) {
  exigirDono(sessao)
  if (userId === sessao.user?.id) throw new Error('O dono não remove a si mesmo.')
  await q(
    `delete from core.tenant_member
      where tenant_id = $1 and user_id = $2 and role <> 'owner'`,
    [sessao.tenantId, userId],
  )
}

// Chamada no primeiro login, antes de criar tenant novo. Token vale mais que
// e-mail: quem clicou no link do convite é vinculado mesmo que tenha criado a
// conta com outro endereço. Sem token, vale o e-mail que o Supabase confirmou.
export async function aceitarConvite(user) {
  const token = user.user_metadata?.convite ?? null
  const email = String(user.email ?? '').toLowerCase()
  const convite = await q1(
    `select id, tenant_id, papel from core.tenant_convite
      where aceito_em is null and revogado_em is null and expira_em > now()
        and (($1::text is not null and token = $1) or email = $2)
      order by token = $1 desc, criado_em desc
      limit 1`,
    [token, email],
  )
  if (!convite) return null

  await q(
    `insert into core.tenant_member (tenant_id, user_id, role)
     values ($1, $2, $3) on conflict (tenant_id, user_id) do nothing`,
    [convite.tenant_id, user.id, convite.papel],
  )
  await q(
    `update core.tenant_convite set aceito_em = now(), aceito_por = $2 where id = $1`,
    [convite.id, user.id],
  )
  return { tenantId: convite.tenant_id }
}

// Consulta pública, para a tela de cadastro dizer para qual empresa o link
// convida. Só o que a tela mostra; o token que chegou já é a credencial.
export async function conviteDoToken(token) {
  if (!token) return null
  return q1(
    `select c.email, t.nome as empresa,
            c.aceito_em is not null or c.revogado_em is not null or c.expira_em < now() as invalido
       from core.tenant_convite c
       join core.tenant t on t.id = c.tenant_id
      where c.token = $1`,
    [token],
  )
}

function base() {
  return (process.env.APP_URL ?? 'https://driveazul.drivedata.com.br').replace(/\/$/, '')
}

// O e-mail do convite sai pelo Resend. Sem a chave no ambiente, o convite
// continua valendo e a tela mostra o link para mandar por WhatsApp: e-mail
// que falha não pode anular convite que já existe.
async function enviarConvite({ para, link, empresa }) {
  const chave = process.env.RESEND_API_KEY
  if (!chave) return false
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: 'DriveAzul <driveazul@drivedata.com.br>',
        to: [para],
        subject: `Você foi convidado para o DriveAzul${empresa ? ` da ${empresa}` : ''}`,
        html: `
          <p>Você recebeu acesso ao painel financeiro${empresa ? ` da <strong>${empresa}</strong>` : ''} no DriveAzul.</p>
          <p><a href="${link}">Criar minha conta e entrar</a></p>
          <p style="color:#667">O convite vale por 14 dias. Se você não esperava este e-mail, ignore.</p>`,
      }),
    })
    return r.ok
  } catch {
    return false
  }
}
