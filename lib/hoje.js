// O dia de hoje no fuso de quem usa o painel.
//
// `new Date().toISOString()` devolve o dia em UTC. A Vercel roda em UTC e o
// banco também rodava, então das 21h à meia-noite de Brasília o sistema já
// estava no dia seguinte: título que vence hoje virava vencido, e no último dia
// do mês o mês corrente virava antes da hora. O Conta Azul é brasileiro e os
// vencimentos são datas de Brasília, então a régua é essa, no servidor e no
// navegador. O banco acompanha desde a migration 0032.
//
// Sem 'server-only' de propósito: os componentes de tela também usam.
export const FUSO = 'America/Sao_Paulo'

const formato = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
})

// 'AAAA-MM-DD'
export const hojeISO = (agora = new Date()) => formato.format(agora)

// 'AAAA-MM'
export const mesAtualISO = (agora = new Date()) => hojeISO(agora).slice(0, 7)

// Meia-noite UTC do dia de hoje em Brasília. Para contas de calendário com
// getUTC*/setUTC*, que não dependem do fuso da máquina.
export const hojeUTC = (agora = new Date()) => new Date(`${hojeISO(agora)}T00:00:00Z`)
