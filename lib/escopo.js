// Fragmento de filtro por tenant e empresa, reaproveitado por toda consulta.
//
// Fica separado da sessão de propósito: é lógica pura, sem nada do Next, e por
// isso pode ser importado por um teste que roda direto no Node.
export function escopo(sessao, alias = '') {
  const p = alias ? `${alias}.` : ''
  const params = [sessao.tenantId]
  let where = `${p}tenant_id = $1`
  if (sessao.connectionId) {
    params.push(sessao.connectionId)
    where += ` and ${p}connection_id = $2`
  }
  return { where, params }
}
