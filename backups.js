'use strict';
// Browser-local scheduling; no credentials or ranking records are stored locally.
const WeeklyBackup=(()=>{
 const WEEK=7*86400000,KEY='serp-weekly-excel-v1';
 let running=false,retryAfter=0;
 function latestSlot(now=Date.now()){
  const d=new Date(now+4*3600000);
  let slot=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+1)%7,13);
  if(slot>now)slot-=WEEK;
  return slot;
 }
 function scope(){return companies.filter(c=>memberships.some(m=>m.company_id===c.id&&m.role==='owner')).sort((a,b)=>a.id.localeCompare(b.id));}
 function message(t){document.getElementById('backupStatus').textContent=t;}
 function sheet(X,wb,name,rows,headers){
  const ws=X.utils.json_to_sheet(rows,{header:headers});
  ws['!cols']=headers.map(h=>({wch:/keyword|domain|name/i.test(h)?36:/id/.test(h)?38:24}));
  if(ws['!ref']&&rows.length)ws['!autofilter']={ref:ws['!ref']};
  X.utils.book_append_sheet(wb,ws,name);
 }
 async function build(cs,scheduled,valid){
  const X=await ensureExcelLibrary(),wb=X.utils.book_new(),started=new Date().toISOString();
  sheet(X,wb,'Backup Info',[
   {Item:'Generated UTC',Value:started},{Item:'Scheduled UAE',Value:new Date(scheduled+4*3600000).toISOString().slice(0,16)+' UAE'},
   {Item:'Scope',Value:'Companies where this account is an admin; all dates.'},
   {Item:'Snapshot',Value:'Current data fetched at generation time. Reads are sequential, not an atomic database snapshot.'},
   {Item:'Recovery',Value:'Raw identifiers retained. Restore requires administrator assistance; do not use normal ranking import.'},
   {Item:'Privacy',Value:'Private company data. Store this workbook securely.'}
  ],['Item','Value']);
  sheet(X,wb,'Companies',cs,['id','slug','name','domain']);
  for(let i=0;i<cs.length;i++){
   const c=cs[i];if(!valid())throw Error('Session changed. Retry after signing in.');
   message('Preparing Excel: '+c.domain+'…');
   for(const [table,headers] of [
    ['markets',['id','company_id','name','created_at']],
    ['keywords',['id','company_id','market_id','keyword','created_at']],
    ['rankings',['id','company_id','market_id','keyword_id','ranking_date','position','source','created_at','updated_at']]
   ]){
    const rows=await allRows(table,c.id);
    if(!valid()||rows.some(r=>r.company_id!==c.id))throw Error('Company access changed. No download created.');
    if(rows.length>1048575)throw Error('Excel row limit exceeded. Contact your administrator.');
    sheet(X,wb,(i+1)+' '+table,rows,headers);
   }
  }
  return {X,wb};
 }
 async function checkDue(manual=false){
  const panel=document.getElementById('weeklyBackupPanel');
  if(!panel)return;
  const cs=scope();panel.hidden=!user||!ready||!cs.length;
  // The main role renderer disables import buttons; this is an admin export action.
  document.getElementById('backupDownload').disabled=running||!cs.length;
  if(panel.hidden||busy||running||(!manual&&Date.now()<retryAfter))return;
  if(!navigator.locks){message('Automatic backups need a browser with Web Locks support, such as current Chrome or Edge.');return;}
  running=true;
  try{
   await navigator.locks.request(KEY,{ifAvailable:true},async lock=>{
    if(!lock)return;
    const uid=user.id,valid=()=>!!user&&user.id===uid&&ready&&cs.every(c=>scope().some(x=>x.id===c.id));
    const key=KEY+':'+cs.map(c=>c.id).join(',');
    let saved=JSON.parse(localStorage.getItem(key)||'null');
    const slot=latestSlot();
    if(!saved){saved={firstDue:slot+WEEK,lastRequested:0};localStorage.setItem(key,JSON.stringify(saved));}
    const due=slot>=saved.firstDue&&slot>saved.lastRequested;
    if(!manual&&!due){message('Automatic Excel download: Saturdays, 5:00 PM UAE. Next due: '+new Date(Math.max(saved.firstDue,slot+WEEK)+4*3600000).toISOString().slice(0,10)+'.'+(saved.lastRequested?' Last download requested: '+new Date(saved.lastRequested+4*3600000).toISOString().slice(0,10)+'.':''));return;}
    // Recheck current server membership before exporting, in addition to table RLS.
    const fresh=check(await db.from('company_members').select('company_id,role').eq('user_id',uid));
    if(cs.some(c=>!fresh.some(m=>m.company_id===c.id&&m.role==='owner')))throw Error('Admin access changed. Sign in again.');
    const {X,wb}=await build(cs,slot,valid);
    if(!valid())throw Error('Session changed. No download created.');
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    X.writeFile(wb,'SERP-Backup-'+stamp+'.xlsx',{compression:true});
    if(due){saved.lastRequested=slot;localStorage.setItem(key,JSON.stringify(saved));}
    message('Excel download requested. Check Downloads. If the browser blocked it, allow downloads and click Download backup now.');
    toast('Excel backup download requested — check Downloads.');
   });
  }catch(e){retryAfter=Date.now()+5*60000;message('Backup not completed: '+e.message+' Use Download backup now to retry.');}
  finally{running=false;document.getElementById('backupDownload').disabled=false;}
 }
 function start(){
  const panel=document.createElement('div');panel.id='weeklyBackupPanel';panel.className='panel';panel.hidden=true;
  panel.innerHTML='<h3>Weekly Excel backup</h3><p>Every Saturday at 5:00 PM UAE time. Keep this computer awake, signed in as an admin, and this website open. Allow browser downloads. A missed run exports current data at your next visit.</p><p>Includes all dates for your admin company accounts. This browser remembers download requests; it cannot confirm that a file was saved. Clearing browser data resets the schedule.</p><p id="backupStatus" role="status"></p><button type="button" class="btn" id="backupDownload">Download backup now</button>';
  document.getElementById('import').append(panel);
  document.getElementById('backupDownload').onclick=()=>checkDue(true);
  setInterval(()=>checkDue(),30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkDue();});
  window.addEventListener('focus',()=>checkDue());
  checkDue();
 }
 return {latestSlot,build,checkDue,start};
})();
WeeklyBackup.start();

