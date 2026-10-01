import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {checkRanking} from './provider.js';
const cors={'Access-Control-Allow-Origin':'https://serp-gray.vercel.app','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply(405,{error:'POST required'});
 try{
 const auth=req.headers.get('Authorization')||'';
 if(!auth.startsWith('Bearer '))return reply(401,{error:'Sign in first'});
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY');
 const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
 const {data:{user},error:authError}=await client.auth.getUser(auth.slice(7));
 if(authError||!user)return reply(401,{error:'Session expired. Sign in again.'});
 const raw=await req.text();if(raw.length>2048)return reply(413,{error:'Request too large'});
 const input=JSON.parse(raw);
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(![input.company_id,input.keyword_id,input.market_id].every(v=>typeof v==='string'&&uuid.test(v)))return reply(400,{error:'Select company, market and keyword'});
 const {data:member,error:me}=await client.from('company_members').select('role').eq('company_id',input.company_id).eq('user_id',user.id).maybeSingle();
 if(me||!member||!['owner','editor'].includes(member.role))return reply(403,{error:'Owner or editor company membership required'});
 const [c,k,m]=await Promise.all([
 client.from('companies').select('domain').eq('id',input.company_id).single(),
 client.from('keywords').select('keyword,market_id').eq('id',input.keyword_id).eq('company_id',input.company_id).single(),
 client.from('markets').select('name').eq('id',input.market_id).eq('company_id',input.company_id).single()]);
 if(c.error||k.error||m.error||k.data.market_id!==input.market_id)return reply(403,{error:'Keyword and market must belong to your selected company'});
 const key=Deno.env.get('SERPAPI_KEY');
 if(!key)return reply(503,{error:'Administrator setup required: add SERPAPI_KEY to Supabase Edge Function secrets.'});
 const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});
 const previous=await admin.from('provider_checks').select('id,result,created_at').eq('company_id',input.company_id).eq('keyword_id',input.keyword_id).eq('market_id',input.market_id).order('created_at',{ascending:false}).limit(1).maybeSingle();
 if(previous.error)return reply(503,{error:'Could not retrieve the previous provider check'});
 const previousAge=previous.data?Date.now()-Date.parse(previous.data.created_at):Infinity;
 const previousResult=previous.data?.result;
 if(previousAge>=0&&previousAge<300000&&previousResult?.status==='done')return reply(200,{...previousResult,checkId:previous.data.id,reused:true});
 if(previousAge>=0&&previousAge<120000&&previousResult?.status==='running')return reply(409,{error:'This search is still running. Its saved result will appear here when it finishes.'});
 const canResume=previousAge>=0&&previousAge<300000&&previousResult?.status==='error'&&previousResult.resume;
 let reserved,checkpoint=canResume?previousResult.resume:null;
 if(canResume){
  reserved={id:previous.data.id};
 }else{
  const {count,error:countError}=await admin.from('provider_checks').select('id',{count:'exact',head:true}).eq('company_id',input.company_id).gte('created_at',new Date().toISOString().slice(0,10));
  if(countError)return reply(503,{error:'Cannot verify search allowance'});
  if(count>=30)return reply(429,{error:'Daily limit reached: 30 checks per company'});
  const {data:newReservation,error:reserveError}=await admin.from('provider_checks').insert({company_id:input.company_id,requested_by:user.id,keyword_id:input.keyword_id,market_id:input.market_id,slot:Math.floor(Date.now()/60000)}).select('id').single();
  if(reserveError)return reply(reserveError.code==='23505'?429:503,{error:reserveError.code==='23505'?'A new search was just started for this company. Wait a minute before starting another new search.':'Could not reserve search'});
  reserved=newReservation;
 }
 let result;
 try{result=await checkRanking({keyword:k.data.keyword,market:m.data.name,domain:c.data.domain},{
 key,resume:checkpoint,onCheckpoint:async value=>{
 checkpoint=value;
 const saved=await admin.from('provider_checks').update({result:{status:'running',resume:value}}).eq('id',reserved.id);
 if(saved.error)throw Error('Unable to preserve search progress.');
 }});
 }catch(e){
 const message=e.message+(checkpoint?' Completed pages are preserved for 5 minutes. Click Find ranking again to resume at page '+checkpoint.page+'.':'');
 await admin.from('provider_checks').update({result:{status:'error',message,resume:checkpoint}}).eq('id',reserved.id);return reply(502,{error:message});
 }
 const {error:saveError}=await admin.from('provider_checks').update({result}).eq('id',reserved.id);
 if(saveError)return reply(503,{error:'Search completed but its provider record could not be stored. Please try later.'});
 return reply(200,{...result,checkId:reserved.id});
 }catch{return reply(400,{error:'Unable to complete ranking check'});}
});

