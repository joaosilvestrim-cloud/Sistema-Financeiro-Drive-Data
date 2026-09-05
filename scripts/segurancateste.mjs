// Confere as barreiras entre clientes.
//
// Um SaaS multi-inquilino tem uma familia de defeitos que nao aparece em
// nenhum teste funcional, porque tudo funciona: o dado do outro chega
// certinho. So aparece quando alguem procura de proposito.
//
// Este script procura. Ele monta um tenant falso, tenta atravessar cada
// fronteira que a aplicacao tem, e falha se alguma deixar passar.
import { pool, query } from '../src/db.mjs'
import { enviarFatura } from '../lib/faturaServidor.js'

let falhas = 0
const ok = (cond, texto, extra = '') => {
  if (!cond) falhas++
  console.log(`  ${cond ? 'ok  ' : 'FALHA'} ${texto}${extra ? '  ' + extra : ''}`)
}

const { rows: [real] } = await query('select id, nome from core.tenant order by slug limit 1')
const { rows: [conexao] } = await query(
  'select id, nome from core.connection where tenant_id = $1 limit 1', [real.id])

console.log('== EXPOSICAO POR FORA DA APLICACAO ==')
{
  // O app fala com o Postgres direto, nao pelo PostgREST. Se um dia alguem
  // conceder acesso a esses papeis, o schema inteiro fica publico na API do
  // Supabase, e o unico freio passa a ser o RLS.
  const { rows } = await query(
    `select count(*) as n from information_schema.role_table_grants
      where table_schema in ('core','mart') and grantee in ('anon','authenticated')`)
  ok(Number(rows[0].n) === 0, 'anon e authenticated sem nenhum grant em core e mart',
     `${rows[0].n} grant(s)`)
}
{
  const { rows } = await query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'mart' and c.relkind = 'v'
        and coalesce((select option_value from pg_options_to_table(c.reloptions)
                       where option_name = 'security_invoker'), 'false') <> 'true'`)
  ok(rows.length === 0, 'toda view de mart roda como quem consulta',
     rows.map((r) => r.relname).join(', '))
}
{
  // Tabela com tenant_id e sem policy some do RLS: se um dia o grant existir,
  // ela vaza inteira.
  const { rows } = await query(
    `select c.relname, c.relrowsecurity as rls,
            (select count(*) from pg_policy p where p.polrelid = c.oid) as pols
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'core' and c.relkind = 'r'
        and exists (select 1 from pg_attribute a
                     where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)`)
  const semRls = rows.filter((r) => !r.rls)
  ok(semRls.length === 0, 'toda tabela com tenant_id tem RLS ligado',
     semRls.map((r) => r.relname).join(', '))
}

console.log('\n== ID VINDO DO NAVEGADOR ==')
{
  // O caso real: prepararFatura escolhe a conexao do tenant, mas o valor volta
  // pela tela e o cliente pode trocar. clientFor busca o token pelo id da
  // conexao e nao pergunta de quem ela e', entao sem conferencia isso lancaria
  // despesa no Conta Azul de outra empresa com o token dela.
  const alheia = '00000000-0000-0000-0000-0000000000ff'
  const r = await enviarFatura(
    { tenantId: real.id },
    {
      conexaoId: alheia, vencimento: '2026-10-10',
      itens: [{ descricao: 'sonda', valor: 1, data: '2026-09-01', vencimentoISO: '2026-10-10' }],
      contaExternalId: 'x', pessoaExternalId: 'y',
    },
  )
  ok(!!r?.erro, 'enviarFatura recusa conexao que nao e do tenant', r?.erro ?? 'passou!')

  if (conexao) {
    const tenantFalso = '00000000-0000-0000-0000-0000000000fe'
    const r2 = await enviarFatura(
      { tenantId: tenantFalso },
      {
        conexaoId: conexao.id, vencimento: '2026-10-10',
        itens: [{ descricao: 'sonda', valor: 1, data: '2026-09-01', vencimentoISO: '2026-10-10' }],
        contaExternalId: 'x', pessoaExternalId: 'y',
      },
    )
    ok(!!r2?.erro, 'enviarFatura recusa tenant que nao e dono da conexao', r2?.erro ?? 'passou!')
  }
}

console.log('\n== ESCRITA SEMPRE CARIMBADA ==')
{
  // Toda gravacao de dado do cliente carrega o tenant da sessao. Se alguma
  // parar de carregar, ela grava no lugar errado sem erro nenhum.
  for (const [nome, sql] of [
    ['cliente_regime', 'core.cliente_regime'],
    ['category_classe', 'core.category_classe'],
    ['aux_dataset', 'core.aux_dataset'],
    ['fiscal_documento', 'core.fiscal_documento'],
    ['fiscal_emitente', 'core.fiscal_emitente'],
  ]) {
    const { rows } = await query(
      `select count(*) as n from ${sql} where tenant_id is null`)
    ok(Number(rows[0].n) === 0, `${nome} sem linha orfa`, `${rows[0].n} sem tenant`)
  }
}

console.log(falhas ? `\n${falhas} falha(s) de isolamento.` : '\nNenhuma fronteira aberta.')
await pool.end()
process.exit(falhas ? 1 : 0)
