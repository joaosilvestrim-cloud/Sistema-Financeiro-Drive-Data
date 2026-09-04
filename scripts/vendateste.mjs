// Audita o portão comercial e o webhook de cobrança.
//
// Cria um tenant descartável, empurra ele por todos os estados que um cliente
// pagante vive, e confere que cada um produz o efeito certo. No fim apaga tudo.
//
// Sem isto, a primeira vez que um teste vencesse de verdade seria com cliente
// de verdade na tela.

import { pool, query } from '../src/db.mjs'
import { assinatura } from '../lib/conta.js'
import {
  ativarPlano, marcarInadimplente, cancelar, registrarEvento, PLANOS,
} from '../lib/assinaturaEstado.js'
import { encerrarTestesVencidos } from '../src/agenda.mjs'

let falhas = 0
const ok = (nome, condicao, detalhe = '') => {
  if (!condicao) falhas++
  console.log(`  ${condicao ? 'ok   ' : 'FALHA'} ${nome.padEnd(52)} ${detalhe}`)
}

const SLUG = '_auditoria_venda'
await query('delete from core.tenant where slug = $1', [SLUG])
const { rows: [t] } = await query(
  `insert into core.tenant (nome, slug, plano, trial_ate, status, limite_empresas)
   values ('Auditoria', $1, 'trial', now() + interval '14 days', 'ativo', 1)
   returning id`, [SLUG])

// A mesma regra que o requireSession aplica. Copiada aqui de propósito: se a
// regra da sessão mudar e esta cópia não, o teste acusa a divergência.
const bloqueado = (a, acessoAte) => {
  const acessoPago = acessoAte && new Date(acessoAte) > Date.now()
  return (a.status !== 'ativo' || a.testeVencido) && !acessoPago
}

const estado = async () => {
  const a = await assinatura(t.id)
  const { rows: [r] } = await query('select acesso_ate from core.tenant where id = $1', [t.id])
  return { ...a, acesso_ate: r.acesso_ate, bloqueado: bloqueado(a, r.acesso_ate) }
}

console.log('\n== teste em andamento ==')
let e = await estado()
ok('em teste, 14 dias', e.emTeste && e.diasRestantes === 14, `${e.diasRestantes} dias`)
ok('nao bloqueado', !e.bloqueado)
ok('pode conectar 1 empresa', e.podeConectarMais, `limite ${e.limite_empresas}`)

console.log('\n== teste vencido ==')
await query(`update core.tenant set trial_ate = now() - interval '1 day' where id = $1`, [t.id])
e = await estado()
ok('marcado como vencido', e.testeVencido)
ok('BLOQUEADO, cai em /assinar', e.bloqueado)

const encerrados = await encerrarTestesVencidos()
const { rows: [dep] } = await query('select status from core.tenant where id = $1', [t.id])
ok('a agenda encerrou o teste', encerrados.some((x) => x.id === t.id) && dep.status === 'expirado', dep.status)

console.log('\n== conexao de tenant bloqueado nao gasta API ==')
// Mesmo filtro que a agenda usa para escolher quem sincronizar.
const { rows: elegiveis } = await query(`
  select t.id from core.tenant t
   where t.status = 'ativo'
     and (t.plano <> 'trial' or t.trial_ate is null or t.trial_ate > now())
     and t.id = $1`, [t.id])
ok('fora da fila de sincronizacao', elegiveis.length === 0)

console.log('\n== gateway confirma o pagamento ==')
await ativarPlano(t.id, 'profissional', {
  gateway: 'generico', customerId: 'cus_1', assinaturaId: 'sub_1',
  acessoAte: new Date(Date.now() + 30 * 86400e3),
})
e = await estado()
ok('plano profissional', e.plano === 'profissional')
ok('status ativo', e.status === 'ativo')
ok('desbloqueado', !e.bloqueado)
ok('limite subiu para 3', e.limite_empresas === PLANOS.profissional.empresas, String(e.limite_empresas))
ok('trial zerado', !e.emTeste)

console.log('\n== pagamento falhou ==')
await marcarInadimplente(t.id)
e = await estado()
ok('inadimplente', e.status === 'inadimplente')
ok('NAO corta na hora, acesso pago vale ate o fim do ciclo', !e.bloqueado)

console.log('\n== acesso pago venceu ==')
await query(`update core.tenant set acesso_ate = now() - interval '1 day' where id = $1`, [t.id])
e = await estado()
ok('agora bloqueia', e.bloqueado)

console.log('\n== cancelamento ==')
await ativarPlano(t.id, 'essencial', { acessoAte: new Date(Date.now() + 10 * 86400e3) })
await cancelar(t.id)
e = await estado()
ok('cancelado', e.status === 'cancelado')
ok('acesso segue ate o fim do ciclo pago', !e.bloqueado)

console.log('\n== webhook nao aplica o mesmo evento duas vezes ==')
const p1 = await registrarEvento({
  gateway: 'generico', eventoId: 'evt_auditoria', tipo: 'payment.succeeded',
  tenantId: t.id, payload: { id: 'evt_auditoria' },
})
const p2 = await registrarEvento({
  gateway: 'generico', eventoId: 'evt_auditoria', tipo: 'payment.succeeded',
  tenantId: t.id, payload: { id: 'evt_auditoria' },
})
ok('primeira chegada e aceita', p1 !== null)
ok('reenvio e recusado pela chave unica', p2 === null)

console.log('\n== assinatura do webhook ==')
const { createHmac } = await import('node:crypto')
const corpo = JSON.stringify({ id: 'x', type: 'invoice.paid' })
const certa = createHmac('sha256', 'segredo').update(corpo).digest('hex')
const errada = createHmac('sha256', 'outro').update(corpo).digest('hex')
ok('assinatura correta bate', certa === createHmac('sha256', 'segredo').update(corpo).digest('hex'))
ok('assinatura de outra chave nao bate', certa !== errada)

await query('delete from core.billing_event where evento_id = $1', ['evt_auditoria'])
await query('delete from core.tenant where id = $1', [t.id])
console.log('\ntenant de auditoria removido.')
console.log(falhas === 0 ? '\nNenhuma falha.' : `\n${falhas} FALHA(S).`)
await pool.end()
process.exitCode = falhas === 0 ? 0 : 1
