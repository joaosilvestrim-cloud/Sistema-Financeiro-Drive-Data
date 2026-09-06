// Confere o desenho, nao a consulta.
//
// Os testes de dados provam que o numero esta certo. Nenhum deles prova que o
// numero cabe na moldura. Grafico feito a mao em SVG quebra de dois jeitos que
// nao dao erro nenhum: uma divisao por zero vira NaN dentro do atributo e o
// navegador simplesmente nao desenha aquele pedaco; e um rotulo calculado para
// fora do viewBox some sem avisar.
//
// Este script abre cada tela com sessao de verdade, le todo SVG que voltou e
// procura por NaN, Infinity, undefined, raio negativo, dimensao negativa e
// rotulo fora da moldura.
//
//   npm run desenhos
import { pool, query } from '../src/db.mjs'
const BASE = process.argv[2] ?? 'http://localhost:3000'
const URL_SB=process.env.NEXT_PUBLIC_SUPABASE_URL, S=process.env.SUPABASE_SERVICE_ROLE_KEY, A=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const E='svg@driveazul.local', P='Sv!'+Math.random().toString(36).slice(2,10)
const ad=(p,o={})=>fetch(URL_SB+'/auth/v1/admin'+p,{...o,headers:{apikey:S,Authorization:'Bearer '+S,'Content-Type':'application/json'}})
const l=await (await ad('/users?per_page=200')).json()
for(const u of l.users??[]) if(u.email===E) await ad('/users/'+u.id,{method:'DELETE'})
const c=await (await ad('/users',{method:'POST',body:JSON.stringify({email:E,password:P,email_confirm:true})})).json()
const t=(await query('select id from core.tenant order by slug limit 1')).rows[0]
await query('insert into core.tenant_member (tenant_id,user_id,role) values ($1,$2,$3) on conflict do nothing',[t.id,c.id,'owner'])
const lg=await (await fetch(URL_SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:A,'Content-Type':'application/json'},body:JSON.stringify({email:E,password:P})})).json()
const ref=URL_SB.replace('https://','').split('.')[0]
const ck='sb-'+ref+'-auth-token=base64-'+Buffer.from(JSON.stringify(lg)).toString('base64')

let falhas=0
for (const rota of ['/precificacao','/indicadores','/dre','/resumo','/fluxo','/previsao','/metas','/produtividade','/']) {
  const html = await (await fetch(BASE + rota,{headers:{Cookie:ck}})).text()
  const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) ?? []
  const problemas = []
  for (const svg of svgs) {
    if (/NaN|Infinity|undefined/.test(svg)) problemas.push('valor invalido no desenho')
    const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
    if (!vb) continue
    const [W,H] = [Number(vb[1]), Number(vb[2])]
    for (const m of svg.matchAll(/<text[^>]*\sx="(-?[\d.]+)"[^>]*\sy="(-?[\d.]+)"/g)) {
      const x=Number(m[1]), y=Number(m[2])
      if (x < -4 || x > W+4 || y < -4 || y > H+4) problemas.push(`rotulo fora da moldura em ${x},${y} (${W}x${H})`)
    }
    for (const m of svg.matchAll(/\sr="(-?[\d.]+)"/g)) if (Number(m[1]) < 0) problemas.push('raio negativo')
    for (const m of svg.matchAll(/\s(?:width|height)="(-?[\d.]+)"/g)) if (Number(m[1]) < 0) problemas.push('dimensao negativa')
  }
  const unicos = [...new Set(problemas)]
  if (unicos.length) falhas += unicos.length
  console.log(`  ${unicos.length?'FALHA':'ok   '} ${rota.padEnd(15)} ${svgs.length} desenho(s)` + (unicos.length?'  '+unicos.join(' | '):''))
}
await ad('/users/'+c.id,{method:'DELETE'})
await pool.end()
console.log(falhas ? `\n${falhas} problema(s) de desenho.` : '\nDesenhos sem numero invalido nem rotulo fora da moldura.')
process.exit(falhas?1:0)
