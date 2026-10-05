'use strict';
// Browser-local scheduling; no credentials or ranking records are stored locally.
const WeeklyBackup=(()=>{
 const WEEK=7*86400000,KEY='serp-weekly-excel-v1';
 let running=false,retryAfter=0;
 function historyKey(){return KEY+':history:'+scope().map(c=>c.id).join(',');}
 function events(){return JSON.parse(localStorage.getItem(historyKey())||'[]');}
 function log(status,scheduled,detail='',filename='',id=null){
  const items=events(),entry={id:id||crypto.randomUUID(),at:Date.now(),scheduled,status,detail,filename};
  const index=items.findIndex(x=>x.id===entry.id);if(index>=0)items[index]=entry;else items.push(entry);
  localStorage.setItem(historyKey(),JSON.stringify(items.slice(-250)));renderHistory();return entry.id;
 }
 function uae(time){return time?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai',dateStyle:'medium',timeStyle:'short'}).format(new Date(time)):'—';}
 function renderHistory(){
  const body=document.getElementById('backupHistoryRows');if(!body)return;body.replaceChildren();
  if(!user||!ready||!scope().length)return;
  let rows;try{rows=events().slice().reverse();}catch{rows=[];}
  if(!rows.length){const tr=body.insertRow();const td=tr.insertCell();td.colSpan=5;td.textContent='No backup attempts recorded in this browser yet.';}
  for(const item of rows){const tr=body.insertRow();for(const value of [uae(item.scheduled),uae(item.at),item.status,item.filename||'—',item.detail])tr.insertCell().textContent=value;}
 }
 function syncHistoryAccess(){
  const allowed=!!user&&ready&&scope().length>0;
  const button=document.getElementById('backupHistoryButton');if(button)button.hidden=!allowed;
  const resetButton=document.getElementById('adminPasswordResetButton');if(resetButton)resetButton.hidden=!user||!ready||!memberships.some(m=>['owner','editor'].includes(m.role));
  const dialog=document.getElementById('backupHistoryDialog');if(!allowed&&dialog?.open)dialog.close();
  const resetDialog=document.getElementById('adminPasswordResetDialog');if(resetDialog&&(!user||!ready||!memberships.some(m=>['owner','editor'].includes(m.role)))&&resetDialog.open)resetDialog.close();
 }

 function latestSlot(now=Date.now()){
  const d=new Date(now+4*3600000);
  let slot=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+1)%7,13);
  if(slot>now)slot-=WEEK;
  return slot;
 }
 function scope(){return companies.filter(c=>memberships.some(m=>m.company_id===c.id&&['owner','co_admin'].includes(m.role))).sort((a,b)=>a.id.localeCompare(b.id));}
 function nextDueTime(){
  const slot=latestSlot();let firstDue=slot+WEEK;
  try{const saved=JSON.parse(localStorage.getItem(KEY+':'+scope().map(c=>c.id).join(','))||'null');if(saved?.firstDue)firstDue=saved.firstDue;}catch{}
  return Math.max(firstDue,slot+WEEK);
 }
 function message(){
  const status=document.getElementById('backupStatus');if(!status)return;
  const value=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai',weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(nextDueTime()));
  status.textContent='Next backup: '+value+' Gulf Standard Time (GST, UTC+4)';
 }
 function sheet(X,wb,name,rows,headers){
  const ws=X.utils.json_to_sheet(rows,{header:headers});
  ws['!cols']=headers.map(h=>({wch:/keyword|domain|name/i.test(h)?36:/id/.test(h)?38:24}));
  if(ws['!ref']&&rows.length)ws['!autofilter']={ref:ws['!ref']};
  X.utils.book_append_sheet(wb,ws,name);
 }
 function companyLabel(c){return c.domain||c.name||c.slug||'Company';}
 async function build(cs,scheduled,valid){
  const X=await ensureExcelLibrary(),wb=X.utils.book_new(),started=new Date().toISOString();
  sheet(X,wb,'Backup Info',[
   {Item:'Generated on',Value:new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai',dateStyle:'medium',timeStyle:'short'}).format(new Date(started))+' GST'},
   {Item:'Scheduled backup',Value:new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai',dateStyle:'medium',timeStyle:'short'}).format(new Date(scheduled))+' GST'},
   {Item:'Companies included',Value:cs.map(companyLabel).join(', ')},
   {Item:'Workbook contents',Value:'Company names, countries / markets, keywords, and ranking positions for all dates.'}
  ],['Item','Value']);
  sheet(X,wb,'Companies',cs.map(c=>({Company:companyLabel(c),Website:c.domain||''})),['Company','Website']);
  for(let i=0;i<cs.length;i++){
   const c=cs[i];if(!valid())throw Error('Session changed. Retry after signing in.');
   const markets=await allRows('markets',c.id);
   if(!valid()||markets.some(r=>r.company_id!==c.id))throw Error('Company access changed. No download created.');
   const keywords=await allRows('keywords',c.id);
   if(!valid()||keywords.some(r=>r.company_id!==c.id))throw Error('Company access changed. No download created.');
   const rankings=await allRows('rankings',c.id);
   if(!valid()||rankings.some(r=>r.company_id!==c.id))throw Error('Company access changed. No download created.');
   for(const rows of [markets,keywords,rankings])if(rows.length>1048575)throw Error('Excel row limit exceeded. Contact your administrator.');
   const marketById=new Map(markets.map(m=>[m.id,m.name||'Unknown market']));
   const keywordById=new Map(keywords.map(k=>[k.id,{keyword:k.keyword||'Unknown keyword',market:marketById.get(k.market_id)||'Unknown market'}]));
   sheet(X,wb,(i+1)+' Markets',markets.map(m=>({Company:companyLabel(c),Market:m.name||'Unknown market'})),['Company','Market']);
   sheet(X,wb,(i+1)+' Keywords',keywords.map(k=>({Company:companyLabel(c),Market:marketById.get(k.market_id)||'Unknown market',Keyword:k.keyword||'Unknown keyword'})),['Company','Market','Keyword']);
   sheet(X,wb,(i+1)+' Rankings',rankings.map(r=>{const k=keywordById.get(r.keyword_id);return {Company:companyLabel(c),Market:marketById.get(r.market_id)||k?.market||'Unknown market',Keyword:k?.keyword||'Unknown keyword',Date:r.ranking_date, 'Google Position':r.position==null?'Not Ranked':r.position,Source:r.source||''};}),['Company','Market','Keyword','Date','Google Position','Source']);
  }
  return {X,wb};
 }
 async function checkDue(manual=false){
  const panel=document.getElementById('weeklyBackupPanel');
  if(!panel)return;
  syncHistoryAccess();const cs=scope();panel.hidden=!user||!ready||!cs.length;
  // The main role renderer disables import buttons; this is an admin/co-admin export action.
  const download=document.getElementById('backupDownload');if(download)download.disabled=running||!cs.length;
  message();
  if(panel.hidden||busy||running||(!manual&&Date.now()<retryAfter))return;
  if(!navigator.locks)return;
  running=true;let attempt=null,attemptSlot=null;
  try{
   await navigator.locks.request(KEY,{ifAvailable:true},async lock=>{
    if(!lock)return;
    const uid=user.id,valid=()=>!!user&&user.id===uid&&ready&&cs.every(c=>scope().some(x=>x.id===c.id));
    const key=KEY+':'+cs.map(c=>c.id).join(',');
    let saved=JSON.parse(localStorage.getItem(key)||'null');
    const slot=latestSlot();
    if(!saved){saved={firstDue:slot+WEEK,lastRequested:0};localStorage.setItem(key,JSON.stringify(saved));}
    const due=slot>=saved.firstDue&&slot>saved.lastRequested;
    // Only a lock holder may infer missed or interrupted work.
    for(const old of events().filter(x=>x.status==='Preparing'))log('Interrupted',old.scheduled,'The previous session ended before a download request was recorded.',old.filename,old.id);
    if(saved.lastRequested&&!events().some(x=>x.scheduled===saved.lastRequested&&/requested/i.test(x.status)))log('Previously requested',saved.lastRequested,'Imported from the earlier schedule tracker; exact time and filename are unavailable.');
    const first=Math.max(saved.firstDue,saved.lastRequested+WEEK,slot-51*WEEK);
    for(let missed=first;missed<slot;missed+=WEEK)if(!events().some(x=>x.scheduled===missed))log('Missed',missed,'No download request recorded in this browser. Historical snapshots cannot be recreated.');
    if(!manual&&!due){message();return;}
    // Recheck current server membership before exporting, in addition to table RLS.
    attemptSlot=due?slot:null;attempt=log('Preparing',attemptSlot,manual?'Manual backup':Date.now()-slot>60000?'Late run: exporting current data after a missed schedule.':'Scheduled backup');
    const fresh=check(await db.from('company_members').select('company_id,role').eq('user_id',uid));
    if(cs.some(c=>!fresh.some(m=>m.company_id===c.id&&['owner','co_admin'].includes(m.role))))throw Error('Backup access changed. Sign in again.');
    const {X,wb}=await build(cs,slot,valid);
    if(!valid())throw Error('Session changed. No download created.');
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const filename='SERP-Backup-'+stamp+'.xlsx';X.writeFile(wb,filename,{compression:true});
    log('Download requested',attemptSlot,'Check your Downloads folder. Browser save completion is not verifiable.'+(due&&Date.now()-slot>60000?' Late run; contains current data.':''),filename,attempt);
    if(due){saved.lastRequested=slot;localStorage.setItem(key,JSON.stringify(saved));}
    message();
   });
  }catch(e){if(attempt){try{log('Failed',attemptSlot,e.message,'',attempt);}catch{}}retryAfter=Date.now()+5*60000;message();}
  finally{running=false;const download=document.getElementById('backupDownload');if(download)download.disabled=false;}
 }
 function start(){
  const panel=document.createElement('div');panel.id='weeklyBackupPanel';panel.className='panel';panel.hidden=true;
  panel.innerHTML='<p id="backupStatus" role="status"></p><button type="button" class="btn" id="backupDownload">Download backup now</button> <button type="button" class="btn danger" id="clearBackupHistory">Clear history</button><div class="tablewrap" style="margin-top:16px"><table><thead><tr><th>Scheduled</th><th>Recorded</th><th>Status</th><th>File</th><th>Details</th></tr></thead><tbody id="backupHistoryRows"></tbody></table></div>';
  const sidebar=document.querySelector('.sidebar');
  if(sidebar){
   sidebar.style.display='flex';sidebar.style.flexDirection='column';
   const footer=document.createElement('div');footer.style.cssText='margin-top:auto;padding:24px 8px 12px;border-top:1px solid #334155';
   const button=document.createElement('button');button.id='backupHistoryButton';button.type='button';button.className='btn';button.textContent='Backup History';button.hidden=true;footer.append(button);sidebar.append(footer);
   const resetButton=document.createElement('button');resetButton.id='adminPasswordResetButton';resetButton.type='button';resetButton.className='btn';resetButton.textContent='Reset account password';resetButton.hidden=true;resetButton.style.marginTop='8px';footer.append(resetButton);
   const dialog=document.createElement('dialog');dialog.id='backupHistoryDialog';dialog.className='panel';dialog.style.cssText='width:min(1100px,94vw);max-height:85vh;overflow:auto;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:14px';
   dialog.innerHTML='<div class="sectiontitle"><h2>Backup History</h2><button type="button" class="btn" id="closeBackupHistory">Close</button></div>';
   document.body.append(dialog);dialog.append(panel);
   button.onclick=()=>{if(!user||!ready||!scope().length)return;message();renderHistory();dialog.showModal();checkDue();};
   document.getElementById('closeBackupHistory').onclick=()=>dialog.close();
   const resetDialog=document.createElement('dialog');resetDialog.id='adminPasswordResetDialog';resetDialog.className='panel';resetDialog.style.cssText='width:min(520px,94vw);color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:14px';
   resetDialog.innerHTML='<div class="sectiontitle"><h2>Reset account password</h2><button type="button" class="btn" id="closePasswordReset">Close</button></div><p>Only full admins can reset a password for a user in a company they administer. Use the user ID from Supabase Authentication → Users. The new password must be at least 12 characters.</p><form id="adminPasswordResetForm"><label for="passwordResetUserId">Supabase user ID</label><input id="passwordResetUserId" autocomplete="off" required><label for="passwordResetNewPassword">New password</label><input id="passwordResetNewPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><p id="passwordResetStatus" role="status"></p><div class="actions"><button type="submit" class="btn primary" id="submitPasswordReset">Reset password</button></div></form>';
   document.body.append(resetDialog);
   resetButton.onclick=()=>{if(!user||!ready||!memberships.some(m=>['owner','editor'].includes(m.role)))return;document.getElementById('adminPasswordResetForm').reset();resetDialog.showModal();};
   document.getElementById('closePasswordReset').onclick=()=>resetDialog.close();
   document.getElementById('adminPasswordResetForm').onsubmit=async event=>{
    event.preventDefault();const targetUserId=document.getElementById('passwordResetUserId').value.trim(),newPassword=document.getElementById('passwordResetNewPassword').value,status=document.getElementById('passwordResetStatus'),submit=document.getElementById('submitPasswordReset');
    if(!user||!ready||!memberships.some(m=>['owner','editor'].includes(m.role))){status.textContent='Administrator access is required.';return;}
    submit.disabled=true;status.textContent='Resetting password…';
    try{const {data,error}=await db.functions.invoke('admin-reset-password',{body:{targetUserId,newPassword}});if(error)throw error;if(!data?.ok)throw Error(data?.error||'Password reset failed.');document.getElementById('passwordResetNewPassword').value='';status.textContent='Password reset successfully. Share the new password securely with the user.';}
    catch(error){status.textContent=error.message||'Password reset failed.';}
    finally{submit.disabled=false;}
   };
   new MutationObserver(syncHistoryAccess).observe(document.querySelector('.app'),{attributes:true,attributeFilter:['hidden']});
   window.addEventListener('storage',syncHistoryAccess);
  }else document.getElementById('import').append(panel);
  const download=document.getElementById('backupDownload');if(download)download.onclick=()=>checkDue(true);
  const clearHistory=document.getElementById('clearBackupHistory');if(clearHistory)clearHistory.onclick=()=>{if(!user||!ready||!scope().length)return;localStorage.removeItem(historyKey());renderHistory();};
  renderHistory();
  setInterval(()=>checkDue(),30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkDue();});
  window.addEventListener('focus',()=>checkDue());
  checkDue();
 }
 return {latestSlot,build,checkDue,start,renderHistory};
})();
WeeklyBackup.start();

