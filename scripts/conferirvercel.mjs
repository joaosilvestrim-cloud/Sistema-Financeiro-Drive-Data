import { pool, query } from '../src/db.mjs'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, S=process.env.SUPABASE_SERVICE_ROLE_KEY, A=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const E='conf3@driveazul.local', P='Conf!'+Math.random().toString(36).slice(2,10)
const ad=(p,o={})=>fetch(URL+'/auth/v1/admin'+p,{...o,headers:{apikey:S,Authorization:'Bearer '+S,'Content-Type':'application/json'}})
const l=await (await ad('/users?per_page=200')).json()
for(const u of l.users??[]) if(u.email===E) await ad('/users/'+u.id,{method:'DELETE'})
const c=await (await ad('/users',{method:'POST',body:JSON.stringify({email:E,password:P,email_confirm:true})})).json()
const t=(await query('select id from core.tenant order by slug limit 1')).rows[0]
await query('insert into core.tenant_member (tenant_id,user_id,role) values ($1,$2,$3) on conflict do nothing',[t.id,c.id,'owner'])
const lg=await (await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:A,'Content-Type':'application/json'},body:JSON.stringify({email:E,password:P})})).json()
const ref=URL.replace('https://','').split('.')[0]
const ck='sb-'+ref+'-auth-token=base64-'+Buffer.from(JSON.stringify(lg)).toString('base64')

const alvo = process.argv[2] ?? '2daa827'
let j, i = 0
while (i < 40) {
  j = await (await fetch('https://driveazul.drivedata.com.br/api/saude',{headers:{Cookie:ck}})).json()
  if (j.ambiente?.commit === alvo) break
  await new Promise(r => setTimeout(r, 15000)); i++
}
console.log('deploy no ar:', j.ambiente.commit, i >= 40 ? '(esperado ' + alvo + ', desisti de esperar)' : '')
console.log('')
for (const [k,v] of Object.entries(j.variaveis)) {
  const esperada = k !== 'DATABASE_URL'
  const marca = v === esperada ? 'ok   ' : (v ? 'sobra' : 'FALTA')
  console.log('  ' + marca + ' ' + k + (k === 'DATABASE_URL' ? '   (esta certo nao ter)' : ''))
}
console.log('')
for (const e of j.etapas) console.log('  ' + (e.ok?'ok   ':'FALHA') + ' ' + e.etapa)
await ad('/users/'+c.id,{method:'DELETE'})
await pool.end()
