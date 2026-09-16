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

// Criação direta de usuário e senha, sem fluxo de e-mail. Pedido do João em
// 16/09: para colocar a equipe para dentro na hora, sem esperar convite.
//
// O caminho respeita a regra de sempre (a service role não existe na Vercel):
// o usuário nasce por SQL direto no schema auth, pela mesma conexão
// privilegiada que o app já usa. A senha entra com o mesmo bcrypt que o
// Supabase usa (custo 10) e o e-mail já nasce confirmado, então o login por
// senha funciona na hora e nenhum e-mail é disparado.
//
// As colunas de token vão como string vazia de propósito: o GoTrue faz scan
// delas como string e NULL derruba o login com erro de conversão. É o
// detalhe que separa um usuário criado por SQL que funciona de um que quebra.
//
// A senha em claro só existe na requisição desta action. Não é gravada, não
// é logada, e trocar depois é pelo "esqueci a senha" normal.
export async function criarAcessoManual(sessao, emailCru, senha, papel) {
  exigirDono(sessao)
  const email = String(emailCru ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('E-mail inválido.')
  if (!PAPEIS.includes(papel)) throw new Error('Papel inválido.')
  if (String(senha ?? '').length < 8) throw new Error('A senha precisa de pelo menos 8 caracteres.')

  const existe = await q1(`select 1 from auth.users where lower(email) = $1`, [email])
  if (existe) {
    throw new Error('Já existe conta com esse e-mail. Use o convite: no primeiro login dela, o acesso liga sozinho.')
  }

  const criado = await q1(
    `with novo as (
       insert into auth.users
         (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, recovery_token, email_change, email_change_token_new,
          email_change_token_current, phone_change, phone_change_token,
          reauthentication_token, is_sso_user, is_anonymous)
       values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
          'authenticated', 'authenticated', $1,
          extensions.crypt($2, extensions.gen_salt('bf', 10)), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          '{"origem":"manual"}'::jsonb, now(), now(),
          '', '', '', '', '', '', '', '', false, false)
       returning id
     ),
     ident as (
       insert into auth.identities
         (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id)
       select id::text, id,
              jsonb_build_object('sub', id::text, 'email', $1, 'email_verified', true),
              'email', now(), now(), now(), gen_random_uuid()
         from novo
     )
     insert into core.tenant_member (tenant_id, user_id, role)
     select $3, id, $4::core.member_role from novo
     returning user_id`,
    [email, senha, sessao.tenantId, papel],
  )
  return { userId: criado.user_id, email }
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

// A moldura visual dos e-mails transacionais. HTML de e-mail é 2005 para
// sempre: tabela para centrar, estilo inline em tudo, nada de classe nem de
// fonte externa, porque o Gmail e o Outlook descartam o resto.
export function molduraEmail({ titulo, corpo, botao, link, rodape }) {
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#eef2f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:36px 12px;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0"
      style="max-width:480px;width:100%;background:#ffffff;border:1px solid #e3e8f0;border-radius:14px;">
      <tr><td style="padding:28px 32px 0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
        <span style="font-size:21px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">Drive<span style="color:#2563eb;">Azul</span></span>
      </td></tr>
      <tr><td style="padding:18px 32px 0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
        <h1 style="margin:0;font-size:19px;line-height:1.35;color:#0f172a;">${titulo}</h1>
      </td></tr>
      <tr><td style="padding:10px 32px 0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#334155;">
        ${corpo}
      </td></tr>
      <tr><td style="padding:22px 32px 6px;">
        <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:12px 26px;border-radius:10px;">${botao}</a>
      </td></tr>
      <tr><td style="padding:6px 32px 26px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#94a3b8;">
        Se o botão não abrir, copie e cole este endereço no navegador:<br>
        <span style="word-break:break-all;color:#64748b;">${link}</span>
      </td></tr>
    </table>
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
      <tr><td style="padding:16px 8px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#94a3b8;text-align:center;">
        ${rodape ?? 'DriveAzul · inteligência financeira sobre o seu Conta Azul'}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
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
        subject: `Você foi convidado${empresa ? ` para o painel da ${empresa}` : ' para o DriveAzul'}`,
        html: molduraEmail({
          titulo: 'Você foi convidado',
          corpo: `Você recebeu acesso ao painel financeiro${empresa ? ` da <strong>${empresa}</strong>` : ''} no DriveAzul.
            Crie sua senha e entre: os números já estarão lá.
            <br><br><span style="color:#94a3b8;">O convite vale por 14 dias. Se você não esperava este e-mail, pode ignorar.</span>`,
          botao: 'Criar minha conta e entrar',
          link,
        }),
      }),
    })
    return r.ok
  } catch {
    return false
  }
}
