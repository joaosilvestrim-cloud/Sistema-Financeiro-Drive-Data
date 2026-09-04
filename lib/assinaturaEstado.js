import 'server-only'
import { q, q1 } from './db.js'

// A máquina de estados da assinatura, sem gateway nenhum.
//
// Estas funções são o contrato que o gateway vai chamar. Quando entrar Asaas,
// Stripe ou Pagar.me, o adaptador novo só traduz o evento deles para uma destas
// chamadas. Nada de regra comercial mora dentro do adaptador, porque senão
// trocar de gateway obrigaria a reescrever a regra.
//
// Os quatro estados de core.tenant.status:
//   ativo         usando, seja em teste ou pagando
//   expirado      o teste acabou e não virou assinatura
//   inadimplente  assinava e o pagamento falhou
//   cancelado     pediu para sair

export const PLANOS = {
  essencial: {
    nome: 'Essencial',
    preco: 197,
    empresas: 1,
    itens: [
      'Visão geral com saldo por conta',
      'Fluxo de caixa com realizado e previsto',
      'Recebíveis, aging e alertas',
      'Análise de IA em cada indicador',
    ],
  },
  profissional: {
    nome: 'Profissional',
    preco: 449,
    empresas: 3,
    itens: [
      'Tudo do Essencial, em até 3 empresas',
      'Qualidade da previsão, que compara o que o ERP previa com o que aconteceu',
      'DRE gerencial e projeção de saldo',
      'Importador de fatura de cartão, que conserta o DRE dentro do Conta Azul',
      'Indicadores de hora faturável, colaborador e pipeline',
    ],
  },
  escritorio: {
    nome: 'Escritório',
    preco: 449,
    precoPorEmpresaExtra: 89,
    empresas: 5,
    itens: [
      'Tudo do Profissional',
      'A partir de 5 empresas, R$ 89 por empresa adicional',
      'Painel consolidado entre as empresas da carteira',
    ],
  },
}

// Registra a intenção de compra. É o que o botão da tela de planos faz enquanto
// o gateway não existe, e continua útil depois: diz qual plano a pessoa quis
// antes de desistir no checkout.
export async function registrarIntencao(tenantId, plano) {
  if (!PLANOS[plano]) throw new Error(`plano ${plano} nao existe`)
  await q(
    `update core.tenant
        set plano_desejado = $2, plano_desejado_em = now()
      where id = $1`,
    [tenantId, plano],
  )
  return PLANOS[plano]
}

// Assinatura confirmada. Chamada pelo adaptador do gateway quando o pagamento
// entra, e também pela mão quando a venda for fechada fora do site.
export async function ativarPlano(tenantId, plano, {
  gateway = null, customerId = null, assinaturaId = null, acessoAte = null,
} = {}) {
  const def = PLANOS[plano]
  if (!def) throw new Error(`plano ${plano} nao existe`)
  await q(
    `update core.tenant
        set plano = $2, status = 'ativo', limite_empresas = $3,
            trial_ate = null, plano_desejado = null, plano_desejado_em = null,
            gateway = coalesce($4, gateway),
            gateway_customer_id = coalesce($5, gateway_customer_id),
            gateway_assinatura_id = coalesce($6, gateway_assinatura_id),
            acesso_ate = $7
      where id = $1`,
    [tenantId, plano, def.empresas, gateway, customerId, assinaturaId, acessoAte],
  )
}

// Pagamento falhou. Não corta na hora: o acesso vale até a data já paga, e é
// isso que evita desligar quem só teve o cartão recusado uma vez.
export async function marcarInadimplente(tenantId) {
  await q(`update core.tenant set status = 'inadimplente' where id = $1`, [tenantId])
}

export async function cancelar(tenantId, { acessoAte = null } = {}) {
  await q(
    `update core.tenant set status = 'cancelado', acesso_ate = coalesce($2, acesso_ate)
      where id = $1`,
    [tenantId, acessoAte],
  )
}

// Guarda o evento antes de agir e devolve se é a primeira vez que ele chega.
// Gateway reenvia, sempre. Sem esta trava, "pagamento aprovado" repetido daria
// dois meses de plano.
export async function registrarEvento({ gateway, eventoId, tipo, tenantId, payload }) {
  const [linha] = await q(
    `insert into core.billing_event (gateway, evento_id, tipo, tenant_id, payload)
     values ($1, $2, $3, $4, $5)
     on conflict (gateway, evento_id) do nothing
     returning id`,
    [gateway, eventoId, tipo, tenantId ?? null, payload ?? {}],
  )
  return linha ?? null
}

export async function marcarEventoAplicado(id, erro = null) {
  await q(
    `update core.billing_event set aplicado = $2, erro = $3 where id = $1`,
    [id, !erro, erro?.slice(0, 500) ?? null],
  )
}

export async function tenantPorAssinatura(gateway, assinaturaId) {
  return q1(
    `select id from core.tenant where gateway = $1 and gateway_assinatura_id = $2`,
    [gateway, assinaturaId],
  )
}
