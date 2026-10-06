'use strict';
let db, user=null, companies=[], memberships=[], marketRecords=[], keywordRecords=[];
let generation=0, busy=false, ready=false, recovery=false;
let temporaryMarketNames=[];
const pendingRankingSearches=new Map();
let rankingAlertLoad=0,rankingAlertLatest=null;
let loginChallenge=null,loginResendAt=0,loginCodeTimer=null,loginCheckPending=false;
function showCodeScreen(show){$('authForm').hidden=show;$('loginCodeForm').hidden=!show;$('authScreen').hidden=false;if(!show){loginChallenge=null;clearInterval(loginCodeTimer);$('loginCode').value='';}}
async function codeRequest(action,extra={}){
 const {data,error}=await db.functions.invoke('login-email-code',{body:{action,...extra}});
 if(error){let message='Verification could not finish. Please try again.';try{message=(await error.context.json()).error||message;}catch{}throw Error(message);}
 if(data?.error)throw Error(data.error);return data;
}
function refreshCodeResend(){const seconds=Math.max(0,Math.ceil((loginResendAt-Date.now())/1000));$('resendLoginCode').disabled=busy||seconds>0;$('resendLoginCode').textContent=seconds?'Resend code in '+seconds+'s':'Resend code';}
async function sendLoginCode(){
 loginChallenge=null;$('verifyLoginCode').disabled=true;$('loginCode').value='';$('loginCodeMessage').textContent='Sending your code…';
 try{const data=await codeRequest('start');loginChallenge=data.challengeId;loginResendAt=Date.now()+60000;$('loginRequestLabel').textContent='Login request: '+data.requestLabel;$('loginCodeMessage').textContent='Code sent. It expires in 5 minutes.';$('verifyLoginCode').disabled=false;$('loginCode').focus();}
 catch(e){$('loginCodeMessage').textContent=e.message;loginResendAt=Date.now()+60000;}
 finally{clearInterval(loginCodeTimer);loginCodeTimer=setInterval(refreshCodeResend,1000);refreshCodeResend();}
}
function searchUsageKey(company,keyword,market,date){return JSON.stringify([company,keyword,market,date]);}
const pageOffsets=new Map();
const $=id=>document.getElementById(id);
const emptyState=()=>({rows:[],sheets:[],keywords:[],markets:[]});
function SafeChart(canvas,config){if(!window.Chart)return {destroy(){}};config.options={...config.options,animation:false};return new window.Chart(canvas,config);}
function activeCompany(){return companies.find(c=>c.id===activeAccount);}
function companyLabel(){const c=activeCompany();return c?`${c.domain} — ${c.name}`:'';}
function notify(message){$('notice').textContent=message;$('notice').hidden=!message;}
function canWrite(){return memberships.some(m=>m.company_id===activeAccount&&['owner','editor'].includes(m.role));}
function canAudit(){return memberships.some(m=>m.role==='auditor');}
function canManageStaff(){return !canAudit()&&memberships.some(m=>['owner','editor'].includes(m.role));}

function isEntryLimited(){return !canWrite()&&(temporaryMarketNames.length>0||memberships.some(m=>m.company_id===activeAccount&&['co_admin','staff','head_staff'].includes(m.role)));}
function canRequestWork(){return !canAudit()&&memberships.some(m=>['co_admin','staff','head_staff'].includes(m.role));}
function canSeeWorkRequests(){return !canAudit()&&memberships.length>0;}
function entryRoleLabel(){const role=memberships.find(m=>m.company_id===activeAccount)?.role;return role==='staff'?'Staff':role==='head_staff'?'Head of staff':role==='co_admin'?'Co-admin':'Temporary cover';}
function dubaiToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function usernameEmail(value){const username=value.trim().toLowerCase();if(username==='fawaz@db')return 'fawaz+db@users.serptrack.invalid';if(!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))throw Error('Enter your assigned username.');return username+'@users.serptrack.invalid';}
function pageDescription(){return companyLabel()+(isEntryLimited()?' · Add new rankings for today ('+dubaiToday()+', Dubai)':'');}
let dateAccessTimer=null,loadedAccessDate='';
function refreshDateAccess(){
 if(!user||!isEntryLimited()||!loadedAccessDate||loadedAccessDate===dubaiToday())return;
 ready=false;state=emptyState();clearRenderedPages();document.querySelector('.app').hidden=true;
 if(busy){dateAccessTimer=setTimeout(refreshDateAccess,1000);return;}
 void switchAccount(activeAccount);
}
function applyRoleUI(){
 const limited=isEntryLimited();loadedAccessDate=limited?dubaiToday():'';
 const denied=memberships.find(m=>m.company_id===activeAccount)?.denied_entry_market_names||[];
 for(const option of [...$('entryCountry').options])if(denied.includes(option.value.trim().toLowerCase())&&!temporaryMarketNames.includes(option.value.trim().toLowerCase()))option.remove();
 refreshEntryKeywords();
 document.querySelectorAll('.nav button').forEach(el=>el.hidden=false);
 document.querySelector('[data-page="audit"]').hidden=!canAudit();
 document.querySelector('[data-page="staffs"]').hidden=!canManageStaff();
 const requestsButton=document.querySelector('[data-page="requests"]');requestsButton.hidden=!canSeeWorkRequests()||canManageStaff();requestsButton.textContent='Request to admin';
 const requestsContent=$('workRequestsContent');if(requestsContent)(canManageStaff()?$('staffs'):$('requests')).append(requestsContent);
 if(!canManageStaff())clearStaffUI();
 for(const id of ['rankMonth','rankDate']){$(id).parentElement.hidden=false;$(id).disabled=false;}
 $('monthChart').closest('.panel').hidden=false;$('dashMonth').closest('.panel').hidden=false;
 $('entryDate').disabled=limited;
 $('entryDate').min=limited?dubaiToday():'';$('entryDate').max=limited?dubaiToday():'';
 if(limited)$('entryDate').value=dubaiToday();
 document.querySelectorAll('#entry button').forEach(el=>el.disabled=!(canWrite()||limited));
 document.querySelectorAll('#entry .danger-text').forEach(el=>el.hidden=limited);
 if(document.querySelector('.page.active')?.id==='entry')renderEntry();
 clearTimeout(dateAccessTimer);
 if(limited)dateAccessTimer=setTimeout(refreshDateAccess,Math.max(1000,Date.parse(dubaiToday()+'T00:00:00+04:00')+86400000-Date.now()+100));
}

function authMessage(message){$('authMessage').textContent=message;}
function setWorkspaceLoading(value){
 const loader=$('loader');
 if(value&&!loader.dataset.workspaceLoader){
  loader.innerHTML="<div class=\"loader-inner premium-loading\"><div class=\"loading-orbit\" aria-hidden=\"true\"><div class=\"orbit-ring\"></div><div class=\"ranking-signal\"><i></i><i></i><i></i><i></i><svg viewBox=\"0 0 120 80\"><path d=\"M10 65L38 45L63 51L106 12\"/><path d=\"M85 12h21v21\"/></svg></div></div><div class=\"loader-logo\">SERP <span>TRACK</span></div><div class=\"loading-caption\" role=\"status\" aria-live=\"polite\">Preparing your ranking workspace</div><div class=\"loading-progress\" aria-hidden=\"true\"><i></i></div></div>";
  loader.dataset.workspaceLoader='true';
 }
 loader.classList.toggle('hide',!value);
 loader.setAttribute('aria-hidden',String(!value));
 $('authScreen').inert=value;
}
function check(result){if(result.error)throw result.error;return result.data;}
function setBusy(value){busy=value;document.body.classList.toggle('busy',value);$('accountSelect').disabled=value;$('loginButton').disabled=value;}
function clearRenderedPages(){
 pageOffsets.clear();
 for(const chart of [monthChart,historyChart,reportChart,rankDonut])chart?.destroy();
 monthChart=historyChart=reportChart=rankDonut=null;
 document.querySelectorAll('tbody,thead#rankHead,.keyword-list,#latestSnapshot,#donutLegend,#dashReportStats,#reportStats,#dataInfo').forEach(el=>el.replaceChildren());
 document.querySelectorAll('.pagination:not(.audit-pagination):not(.work-request-pagination)').forEach(el=>el.remove());
}
function renderActivePage(){
 const renderers={dashboard:updateDashboard,rankings:renderRankings,history:renderHistory,reports:renderReport,entry:renderEntry,keywords:renderKeywords,markets:renderMarkets,import:renderImportInfo,audit:renderAudit,staffs:renderStaffInfo,requests:renderWorkRequests};
 (renderers[document.querySelector('.page.active')?.id]||updateDashboard)();
}
function pageSlice(key,items,size,targetId,render){
 const pages=Math.max(1,Math.ceil(items.length/size)),index=Math.min(pageOffsets.get(key)||0,pages-1),offset=index*size;
 pageOffsets.set(key,index);let controls=$('pager-'+key);
 if(!controls){controls=document.createElement('div');controls.id='pager-'+key;controls.className='pagination';const target=$(targetId);(target.closest('.tablewrap')||target).insertAdjacentElement('afterend',controls);}
 controls.replaceChildren();controls.hidden=items.length<=size;
 const previous=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');
 previous.className=next.className='btn sm';previous.textContent='Previous';next.textContent='Next';previous.disabled=index===0;next.disabled=index>=pages-1;
 label.textContent=(key==='rankingDates'?'Dates: ':'')+(items.length?offset+1:0)+'–'+Math.min(offset+size,items.length)+' of '+items.length;
 previous.onclick=()=>{pageOffsets.set(key,index-1);render();};next.onclick=()=>{pageOffsets.set(key,index+1);render();};controls.append(previous,label,next);
 return {items:items.slice(offset,offset+size),offset};
}
function dailyAverages(rows,days){const totals=new Map();for(const r of rows){const v=totals.get(r.date)||[0,0];if(r.position!==null){v[0]+=r.position;v[1]++;}totals.set(r.date,v);}return days.map(d=>{const v=totals.get(d);return v&&v[1]?v[0]/v[1]:null;});}
function clearPrivate(){document.querySelector('[data-page="staffs"]')?.classList.remove('ranking-alert-text');rankingAlertLoad++;rankingAlertLatest=null;pendingRankingSearches.clear();document.querySelector('[data-page="staffs"]')?.replaceChildren(document.createTextNode('Staff info'));clearWorkRequestsUI();temporaryMarketNames=[];clearStaffUI();clearTimeout(dateAccessTimer);loadedAccessDate='';setWorkspaceLoading(false);generation++;ready=false;activeAccount=null;state=emptyState();marketRecords=[];keywordRecords=[];document.querySelector('.app').hidden=true;for(const chart of [monthChart,historyChart,reportChart,rankDonut])chart?.destroy();monthChart=historyChart=reportChart=rankDonut=null;document.querySelectorAll('tbody,.keyword-list,#latestSnapshot,#donutLegend,#dashReportStats,#reportStats,#dataInfo').forEach(el=>el.replaceChildren());$('accountSelect').replaceChildren();}
async function allRows(table,companyId){let rows=[];for(let from=0;;from+=1000){let q=db.from(table).select('*').order('id').range(from,from+999);if(companyId)q=q.eq('company_id',companyId);const page=check(await q);rows.push(...page);if(page.length<1000)return rows;}}
async function loadCompany(id){
 if(!companies.some(c=>c.id===id))throw Error('Company access is not available.');
 const ticket=++generation; ready=false;activeAccount=id;state=emptyState();marketRecords=[];keywordRecords=[];
 document.querySelector('.app').hidden=true;
 clearRenderedPages();
 const [ms,ks,rs,coverage]=await Promise.all([...['markets','keywords','rankings'].map(t=>allRows(t,id)),db.from('temporary_work_grants').select('market_names').eq('cover_user_id',user.id).eq('company_id',id).lte('start_date',dubaiToday()).gte('end_date',dubaiToday()).then(check)]);
 if(ticket!==generation||!user)return;
 temporaryMarketNames=[...new Set(coverage.flatMap(g=>g.market_names))];
 marketRecords=ms;keywordRecords=ks;const markets=new Map(ms.map(m=>[m.id,m.name])),keywords=new Map(ks.map(k=>[k.id,k.keyword]));
 if([...ms,...ks,...rs].some(r=>r.company_id!==id))throw Error('Unexpected company data. Please reload.');
 const visibleRankings=rs;
 state={markets:ms.map(m=>m.name),keywords:ks.map(k=>({id:k.id,market_id:k.market_id,name:k.keyword,market:markets.get(k.market_id)||'',addedAt:k.created_at.slice(0,10)})),sheets:[],rows:visibleRankings.map(r=>({id:r.id,market_id:r.market_id,keyword_id:r.keyword_id,date:r.ranking_date,month:r.ranking_date.slice(0,7),country:markets.get(r.market_id)||'',keyword:keywords.get(r.keyword_id)||'',position:r.position,source:r.source}))};
 // Clear every page on reload; render other pages only when opened.
 document.querySelectorAll('.filters input').forEach(el=>el.value='');
 document.querySelector('.app').hidden=false;
 rebuildFilters();$('accountSelect').value=id;$('entryAccount').textContent=companyLabel();$('pageDesc').textContent=pageDescription();
 $('sessionLabel').textContent=`${user.app_metadata?.username||user.email?.split('@')[0]||'Signed in'} · ${isEntryLimited()?entryRoleLabel()+' · Today entry only':canWrite()?'Admin':'Read only'}`;
 document.querySelectorAll('#entry button,#keywords button,#markets button,#import button,#fileInput').forEach(el=>el.disabled=!canWrite());
 applyRoleUI();ready=true;void renderRankingAlerts();document.querySelector('.app').hidden=false;$('authScreen').hidden=true;
 if(canAudit()){ $('sessionLabel').textContent=(user.app_metadata?.username||'Signed in')+' · Auditor · Read only';document.querySelector('[data-page="audit"]').click(); }
 else if(document.querySelector('.page.active')?.id==='requests'&&canManageStaff())document.querySelector('[data-page="staffs"]').click();
 else if(document.querySelector('.page.active')?.id==='audit'||(document.querySelector('.page.active')?.id==='staffs'&&!canManageStaff())||(document.querySelector('.page.active')?.id==='requests'&&!canSeeWorkRequests()))document.querySelector('[data-page="dashboard"]').click();
 else if(['staffs','requests'].includes(document.querySelector('.page.active')?.id))renderActivePage();
}
async function switchAccount(id){if(busy||!user)return;setBusy(true);notify('');setWorkspaceLoading(true);try{await loadCompany(id);notify('');}catch(e){ready=false;state=emptyState();document.querySelector('.app').hidden=true;$('authScreen').hidden=false;authMessage('Unable to load company: '+e.message+'. Sign in again to retry.');}finally{setWorkspaceLoading(false);setBusy(false);}}
async function openSession(session){
 if(!session){showCodeScreen(false);user=null;companies=[];memberships=[];clearPrivate();$('authScreen').hidden=false;$('authSignout').hidden=true;return;}
 const ticket=++generation;user=session.user;setBusy(true);notify('');setWorkspaceLoading(true);
 try{const approval=check(await db.rpc('login_status'));if(ticket!==generation)return;
  if(!approval.approved){clearPrivate();companies=[];memberships=[];showCodeScreen(true);setWorkspaceLoading(false);$('loginCodeUser').textContent=session.user.app_metadata?.username||'Your account';await sendLoginCode();return;}
  showCodeScreen(false);
  const [cs,ms]=await Promise.all([allRows('companies'),db.from('company_members').select('company_id,role,denied_entry_market_names').eq('user_id',user.id).then(check)]);
  if(ticket!==generation)return;companies=cs;memberships=ms;$('authSignout').hidden=false;
  if(!cs.length){clearPrivate();$('authScreen').hidden=false;authMessage('Signed in, but no company membership has been assigned. Ask your administrator to assign company access.');return;}
  $('accountSelect').innerHTML=cs.map(c=>`<option value="${esc(c.id)}">${esc(c.domain+' — '+c.name)}</option>`).join('');
  const defaultCompany=cs.find(c=>c.domain.toLowerCase()==='carwashtrolley.com')||cs[0];
  await loadCompany(defaultCompany.id);
 }catch(e){clearPrivate();$('authScreen').hidden=false;authMessage('Workspace could not load: '+e.message);}finally{setWorkspaceLoading(false);setBusy(false);notify('');}
}
async function logout(){showCodeScreen(false);clearPrivate();user=null;$('authSignout').hidden=true;$('authScreen').hidden=false;authMessage('Signed out.');try{check(await db.auth.signOut({scope:'local'}));}catch(e){authMessage('Workspace cleared. Sign-out failed: '+e.message+' Close this tab to discard its session.');}}
async function mutate(action,message,allowTodayInsert=false){
 if(busy)return;if(!ready||!user||!(canWrite()||(allowTodayInsert&&isEntryLimited()))){notify('An owner or editor membership is required.');return;}
 const id=activeAccount,ticket=generation;let saved=false;setBusy(true);notify('Saving…');
 try{await action(id);saved=true;if(ticket!==generation||id!==activeAccount||!user)return;await loadCompany(id);notify('');toast(message);}
 catch(e){if(user&&activeAccount===id){if(!saved){try{await loadCompany(id);}catch{ready=false;}}else ready=false;if(!ready){document.querySelector('.app').hidden=true;$('authScreen').hidden=false;authMessage((saved?'Your data was saved, but the page could not refresh. ':'The operation could not finish. ')+e.message+' Sign in again to reload.');}notify((saved?'Saved, but refresh failed: ':'Save did not finish: ')+e.message);}}
 finally{setBusy(false);}
}
function marketByName(name){return marketRecords.find(m=>m.name===name);}
async function addMarket(){const name=$('newMarket').value.trim();if(!name)return notify('Enter a market name.');if(marketRecords.some(m=>m.name.toLowerCase()===name.toLowerCase()))return notify('This market already exists.');await mutate(async id=>{check(await db.from('markets').insert({company_id:id,name}).select().single());$('newMarket').value='';},'Market saved');}
async function addKeyword(){const keyword=$('newKeyword').value.trim(),market=marketByName($('keywordMarket').value);if(!market||!keyword)return notify('Select a market and enter a keyword.');if(keywordRecords.some(k=>k.market_id===market.id&&k.keyword.toLowerCase()===keyword.toLowerCase()))return notify('Keyword already exists for this market.');await mutate(async id=>{check(await db.from('keywords').insert({company_id:id,market_id:market.id,keyword}).select().single());$('newKeyword').value='';},'Keyword saved');}
async function deleteRecord(table,id){
 if(table==='markets'){
  const keywordCount=keywordRecords.filter(k=>k.market_id===id).length;
  const rankingCount=state.rows.filter(r=>r.market_id===id).length;
  if(keywordCount||rankingCount){notify('This market still has '+keywordCount+' keyword'+(keywordCount===1?'':'s')+' and '+rankingCount+' ranking entr'+(rankingCount===1?'y':'ies')+'. Delete its keywords and rankings first.');return;}
 }
 if(!confirm('Delete this '+(table==='keywords'?'keyword and its ranking history':'record')+' from '+companyLabel()+'?'))return;
 await mutate(async company=>{const rows=check(await db.from(table).delete().eq('company_id',company).eq('id',id).select('id'));if(!rows.length)throw Error('No record deleted. Your access may have changed.');},'Deleted');
}
async function saveManualEntry(){
 const date=$('entryDate').value,keyword=$('entryKeyword').value,market=marketByName($('entryCountry').value),raw=$('entryPosition').value;
 const position=raw===''?null:Number(raw);
 if(!date||!market||!keyword)return notify('Select date, country and keyword.');
 if((memberships.find(m=>m.company_id===activeAccount)?.denied_entry_market_names||[]).includes(market.name.trim().toLowerCase())&&!temporaryMarketNames.includes(market.name.trim().toLowerCase()))return notify('Ranking entry for this market is assigned to another user.');
 if(position!==null&&(!Number.isInteger(position)||position<1||position>1000))return notify('Position must be a whole number from 1 to 1000, or blank for Not Ranked.');
 const k=keywordRecords.find(k=>k.keyword===keyword&&(k.market_id===market.id||k.market_id===null));if(!k)return notify('This keyword is not assigned to the selected market.');
 if(isEntryLimited()&&date!==dubaiToday())return notify('You can only add rankings for today in Dubai time.');
 if(isEntryLimited()&&state.rows.some(r=>r.keyword_id===k.id&&r.market_id===market.id&&r.date===date))return notify('Already entered for today. Only an admin can change this ranking.');
 const searched=await pendingRankingSearches.get(searchUsageKey(activeAccount,k.id,market.id,date));
 if(searched?.error)toast('Search could not be recorded. Saving will notify an admin.','warning');
 await mutate(async id=>{const record={company_id:id,market_id:market.id,keyword_id:k.id,ranking_date:date,position,source:'manual'};
 const query=isEntryLimited()?db.from('rankings').insert(record):db.from('rankings').upsert(record,{onConflict:'keyword_id,market_id,ranking_date'});
 const result=await query.select().single();if(result.error?.code==='23505')throw Error('Already entered for today. Only an admin can change this ranking.');check(result);$('entryPosition').value='';},'Ranking saved',true);
}
function deleteButton(table,id){const b=document.createElement('button');b.className='btn sm danger-text';b.textContent='Delete';b.disabled=!canWrite();b.hidden=isEntryLimited();b.onclick=()=>deleteRecord(table,id);return b;}
function renderKeywords(){const el=$('keywordList');el.replaceChildren();$('keywordCountPill').textContent=state.keywords.length+' keywords';for(const k of pageSlice('keywords',state.keywords,100,'keywordList',renderKeywords).items){const row=document.createElement('div');row.className='keyword-row';const text=document.createElement('span');text.textContent=k.name+' · '+(k.market||'Unassigned');row.append(text,deleteButton('keywords',k.id));el.append(row);}if(!el.children.length)el.textContent='No keywords yet.';}
function renderMarkets(){const el=$('marketList');el.replaceChildren();$('marketCountPill').textContent=marketRecords.length+' markets';for(const m of marketRecords){const row=document.createElement('div');row.className='market-row';const text=document.createElement('span');text.textContent=m.name;row.append(text,deleteButton('markets',m.id));el.append(row);}if(!el.children.length)el.textContent='No markets yet.';}
function renderEntry(){
 if(isEntryLimited())$('entryDate').value=dubaiToday();else if(!$('entryDate').value)$('entryDate').value=new Date().toLocaleDateString('en-CA');
 const date=$('entryDate').value,keyword=$('entryKeyword').value,country=$('entryCountry').value;
 const el=$('entryBody');el.replaceChildren();
 const matches=state.rows.filter(r=>r.date===date&&r.keyword===keyword&&r.country===country);
 for(const r of pageSlice('entry',matches,100,'entryBody',renderEntry).items){
  const row=document.createElement('tr');
  for(const value of [r.date,r.country,r.keyword,displayPosition(r.position,r.date)]){const td=document.createElement('td');td.textContent=value;row.append(td);}
  const td=document.createElement('td');td.append(deleteButton('rankings',r.id));row.append(td);el.append(row);
 }
 if(!matches.length){
  const row=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.className='empty';
  td.textContent=keyword?'No entry saved for "'+keyword+'" in '+country+' on '+date+'.':'Select a keyword to check its entry for this date.';
  row.append(td);el.append(row);
 }
}
function refreshEntryKeywords(){fillSelect('entryKeyword',allKeywords($('entryCountry').value).map(x=>[x,x]),false);syncEntryKeywordSearch();}
let importListRequest=0;
async function renderImportInfo(){
 const request=++importListRequest,company=activeAccount,ticket=generation;
 const target=$('dataInfo');target.textContent='Loading uploaded files…';
 try{
  const uploads=check(await db.from('excel_imports').select('id,filename,uploaded_at,ranking_count,keyword_count,removed_at,removed_count').eq('company_id',company).order('uploaded_at',{ascending:false}));
  if(request!==importListRequest||ticket!==generation||company!==activeAccount||!user)return;
  target.replaceChildren();target.classList.remove('empty');
  const text=document.createElement('p');text.textContent=uploads.length?'Uploaded Excel files':'No tracked Excel uploads yet.';target.append(text);
  if(uploads.length){
   const wrap=document.createElement('div');wrap.className='tablewrap';const table=document.createElement('table');
   table.innerHTML='<thead><tr><th>Excel file</th><th>Uploaded (GST, UTC+4)</th><th>Rankings</th><th>Status</th><th></th></tr></thead><tbody></tbody>';
   for(const upload of uploads){const row=document.createElement('tr');
    for(const value of [upload.filename,new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai',dateStyle:'medium',timeStyle:'short'}).format(new Date(upload.uploaded_at)),upload.ranking_count.toLocaleString(),upload.removed_at?'Removed':'Uploaded']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
    const cell=document.createElement('td');if(canWrite()&&!upload.removed_at){const button=document.createElement('button');button.className='btn danger sm';button.textContent='Remove';button.disabled=busy;button.onclick=()=>removeExcelUpload(upload,company,ticket);cell.append(button);}row.append(cell);table.tBodies[0].append(row);
   }wrap.append(table);target.append(wrap);
  }
  const hint=document.createElement('p');hint.className='hint';hint.textContent='Older imports made before file tracking was added do not have a saved filename or upload history.';target.append(hint);
 }catch(error){if(request===importListRequest&&ticket===generation&&company===activeAccount&&user)target.textContent='Could not load uploads: '+error.message;}
}
async function removeExcelUpload(upload,company,ticket){
 if(busy||!ready||company!==activeAccount||ticket!==generation||!canWrite())return;
 if(!confirm('Remove rankings imported from '+upload.filename+'? Entries changed afterward will be kept. This cannot be undone.'))return;
 let count=0;await mutate(async()=>{count=check(await db.rpc('remove_excel_import',{p_import:upload.id}));},'Excel import removed');
 if(company===activeAccount&&ticket<generation)void renderImportInfo();
}
function renderRankings(){
 const rs=filtered({month:$('rankMonth').value,country:$('rankCountry').value,date:$('rankDate').value});
 const selectedDate=$('rankDate').value,dates=selectedDate?[selectedDate]:[...new Set(rs.map(r=>r.date))].sort(),q=$('rankSearch').value.toLowerCase(),country=$('rankCountry').value,pairs=new Map(),positions=new Map();
 for(const k of state.keywords){if((country==='ALL'||k.market===country)&&k.name.toLowerCase().includes(q))pairs.set(JSON.stringify([k.name,k.market]),{name:k.name,market:k.market});}
 for(const r of rs){if(r.keyword.toLowerCase().includes(q))pairs.set(JSON.stringify([r.keyword,r.country]),{name:r.keyword,market:r.country});positions.set(JSON.stringify([r.keyword,r.country,r.date]),r.position);}
 const datePage=pageSlice('rankingDates',dates,31,'rankHead',renderRankings),rowPage=pageSlice('rankings',[...pairs.values()],50,'rankBody',renderRankings);
 $('rankHead').innerHTML='<tr><th>Keyword</th><th>Market</th>'+datePage.items.map(d=>'<th>'+esc(d)+'</th>').join('')+'</tr>';
 $('rankBody').innerHTML=rowPage.items.map(k=>'<tr><td>'+esc(k.name)+'</td><td>'+esc(k.market)+'</td>'+datePage.items.map(d=>{const key=JSON.stringify([k.name,k.market,d]);return '<td>'+ (positions.has(key)?displayPosition(positions.get(key),d):'Not Ranked')+'</td>';}).join('')+'</tr>').join('');
}
function renderHistory(){
 const rs=filtered({keyword:$('histKeyword').value,country:$('histCountry').value}).filter(r=>(!$('histFrom').value||r.date>=$('histFrom').value)&&(!$('histTo').value||r.date<=$('histTo').value)).sort((a,b)=>a.date.localeCompare(b.date));
 const dates=[...new Set(rs.map(r=>r.date))],markets=[...new Set(rs.map(r=>r.country))],lookup=new Map(rs.map(r=>[JSON.stringify([r.date,r.country]),r.position]));
 historyChart?.destroy();historyChart=new SafeChart($('historyChart'),{type:'line',data:{labels:dates,datasets:markets.map(m=>({label:m,data:dates.map(d=>lookup.get(JSON.stringify([d,m]))??null),spanGaps:false}))},options:{scales:{y:{reverse:true}}}});
 const prev=new Map();const rows=rs.map(r=>{const d=delta(prev.get(r.country)??null,r.position);prev.set(r.country,r.position);return {r,d};});
 $('histBody').innerHTML=pageSlice('history',rows,100,'histBody',renderHistory).items.map(({r,d})=>'<tr><td>'+esc(r.date)+'</td><td>'+esc(r.country)+'</td><td>'+esc(r.keyword)+'</td><td>'+displayPosition(r.position,r.date)+'</td><td>'+deltaHTML(d)+'</td></tr>').join('');
}
function parseDate(value){
 if(value instanceof Date&&!isNaN(value))return validDate(value.getFullYear(),value.getDate(),value.getMonth()+1);
 if(typeof value==='number'){const d=XLSX.SSF.parse_date_code(value);return d?validDate(d.y,d.d,d.m):null;}
 const s=String(value??'').trim();if(!s||!/[0-9]/.test(s))return null;let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);if(m)return validDate(+m[1],+m[2],+m[3]);m=s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);if(m)return validDate(+m[3],+m[2],+m[1]);if(!/[a-z]/i.test(s))return null;const d=new Date(s);return isNaN(d)?null:parseDate(d);
}
function validDate(y,m,d){const dt=new Date(Date.UTC(y,m-1,d));return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d?dt.toISOString().slice(0,10):null;}
function parsePosition(value){if(value===null||value===undefined||String(value).trim()==='')return null;const s=String(value).trim().toLowerCase();if(['na','n/a','-','—','new','not found','not ranked'].includes(s))return null;if(s==='>100')return 101;const n=Number(s);if(!Number.isInteger(n)||n<1||n>1000)throw Error('Invalid ranking position: '+String(value).slice(0,40));return n;}
function displayPosition(position,date){if(date&&new Date(date+'T00:00:00Z').getUTCDay()===0)return 'Weekend';return position===null?'No entry':fmtPos(position);}
function marketFromKeyword(sheet,keyword){
 const m=String(keyword).match(/\bin\s+(uae|saudi(?: arabia)?|india|oman|kuwait|jordan|bahrain|azerbaijan|us|usa|dubai)\b/i);
 if(m){const k=m[1].toLowerCase();return ({uae:'UAE',saudi:'Saudi Arabia','saudi arabia':'Saudi Arabia',india:'India',oman:'Oman',kuwait:'Kuwait',jordan:'Jordan',bahrain:'Bahrain',azerbaijan:'Azerbaijan',us:'United States',usa:'United States',dubai:'Dubai'})[k]||m[1];}
 return countryName(sheet);
}
function headerKeywordColumns(header){return header.map((v,i)=>/^(keyword|keywords)$/i.test(String(v??'').trim())?i:-1).filter(i=>i>=0);}
function parseWorkbook(wb){
 const markets=new Set(),keywords=new Map(),rows=new Map();
 for(const name of wb.SheetNames){
  const aoa=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:null,raw:true});let headerRow=-1,cols=[];
  for(let i=0;i<Math.min(12,aoa.length);i++){const found=headerKeywordColumns(aoa[i]);if(found.length){headerRow=i;cols=found;break;}}
  if(headerRow<0)continue;
  for(let b=0;b<cols.length;b++){
   const keywordCol=cols[b],endCol=b+1<cols.length?cols[b+1]:aoa[headerRow].length;
   const dates=[];for(let col=keywordCol+1;col<endCol;col++){const d=parseDate(aoa[headerRow][col]);if(d)dates.push([col,d]);}
   if(!dates.length)continue;
   for(const row of aoa.slice(headerRow+1)){const keyword=String(row[keywordCol]??'').trim();if(!keyword||/^(sl\s*no|keyword)$/i.test(keyword))continue;const market=marketFromKeyword(name,keyword);markets.add(market);keywords.set(JSON.stringify([market,keyword]),{market,keyword});for(const [col,date] of dates){const position=parsePosition(row[col]);rows.set(JSON.stringify([market,keyword,date]),{market,keyword,date,position});}}
  }
 }
 if(!keywords.size)throw Error('No keyword/date blocks found. Use one or more Keyword headers followed by date columns.');
 return {markets:[...markets].sort(),keywords:[...keywords.values()].sort((a,b)=>a.market.localeCompare(b.market)||a.keyword.localeCompare(b.keyword)),rows:[...rows.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.market.localeCompare(b.market)||a.keyword.localeCompare(b.keyword))};
}
async function chunks(table,records,conflict){for(let i=0;i<records.length;i+=250){const part=records.slice(i,i+250);check(await db.from(table).upsert(part,{onConflict:conflict}));}}
function excelLibrary(){return window.XLSX||globalThis.XLSX||(typeof XLSX!=='undefined'?XLSX:null);}
async function ensureExcelLibrary(){const existing=excelLibrary();if(existing){window.XLSX=existing;return existing;}return await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='xlsx.js?v=20260930';s.async=false;s.onload=()=>{const loaded=excelLibrary();if(loaded){window.XLSX=loaded;resolve(loaded);}else reject(Error('Excel library loaded but did not initialize.'));};s.onerror=()=>reject(Error('Excel library unavailable. Check that xlsx.js is deployed with the site.'));document.head.appendChild(s);});}
async function importFile(file){if(!file||busy||!ready)return;if(!canWrite())return notify('Editor access is required.');if(file.size>20*1024*1024)return notify('Choose a workbook smaller than 20 MB.');const id=activeAccount,ticket=generation;setBusy(true);notify('Reading workbook…');let parsed;try{const Excel=await ensureExcelLibrary();parsed=parseWorkbook(Excel.read(await file.arrayBuffer(),{type:'array',cellDates:true}));}catch(e){notify('Import failed: '+e.message);return;}finally{setBusy(false);$('fileInput').value='';}if(ticket!==generation||id!==activeAccount)return;if(!confirm(`Import ${parsed.keywords.length} keywords and ${parsed.rows.length} rankings into ${companyLabel()}? Matching rankings will be replaced. Worksheet names become markets.`)){notify('');return;}
 await mutate(async company=>{
  check(await db.rpc('import_excel_workbook',{p_company:company,p_filename:file.name,p_rows:parsed.rows}));
 },`Imported ${parsed.rows.length} rankings and ${parsed.keywords.length} keywords`);
}

let syncEntryKeywordSearch=()=>{};
function setupEntryKeywordSearch(){
 const select=$('entryKeyword'),wrap=document.createElement('div'),input=document.createElement('input'),list=document.createElement('div');
 wrap.className='keyword-combobox';input.id='entryKeywordSearch';input.type='text';input.placeholder='Type to search keywords…';input.autocomplete='off';
 input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls','entryKeywordMatches');input.setAttribute('aria-expanded','false');
 input.setAttribute('aria-label','Keyword');list.id='entryKeywordMatches';list.className='keyword-matches';list.setAttribute('role','listbox');list.hidden=true;
 select.hidden=true;select.insertAdjacentElement('afterend',wrap);wrap.append(input,list);
 select.parentElement.querySelector('label')?.setAttribute('for',input.id);
 let matches=[],highlight=-1,selected='';
 const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');highlight=-1;};
 const mark=index=>{
  highlight=index;
  [...list.querySelectorAll('[role="option"]')].forEach((el,i)=>el.setAttribute('aria-selected',String(i===index)));
  const active=list.querySelectorAll('[role="option"]')[index];
  if(active){input.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});}
 };
 const choose=value=>{select.value=value;selected=select.value;input.value=selected;close();select.dispatchEvent(new Event('change',{bubbles:true}));};
 const draw=query=>{
  const filtered=[...select.options].filter(o=>o.value&&o.text.toLowerCase().includes(query.trim().toLowerCase()));
  matches=filtered.slice(0,100);highlight=-1;list.replaceChildren();input.removeAttribute('aria-activedescendant');
  matches.forEach((o,i)=>{
   const item=document.createElement('div');item.id='entryKeywordMatch-'+i;item.setAttribute('role','option');item.setAttribute('aria-selected','false');item.textContent=o.text;
   item.onmousedown=e=>e.preventDefault();item.onclick=()=>choose(o.value);list.append(item);
  });
  if(!matches.length||filtered.length>100){const note=document.createElement('div');note.className='keyword-match-note';note.setAttribute('role','presentation');note.textContent=matches.length?'Showing 100 matches. Keep typing to narrow the list.':'No matching keywords in this market.';list.append(note);}
  list.hidden=false;input.setAttribute('aria-expanded','true');
 };
 syncEntryKeywordSearch=()=>{selected=select.value;input.value=selected;input.disabled=!select.options.length;close();};
 input.onfocus=()=>{input.select();draw('');};
 input.oninput=()=>{select.value='';renderEntry();draw(input.value);};
 input.onblur=close;
 input.onkeydown=e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   e.preventDefault();if(list.hidden)draw(input.value);
   if(matches.length)mark(e.key==='ArrowDown'?Math.min(highlight+1,matches.length-1):(highlight<0?matches.length-1:Math.max(highlight-1,0)));
  }else if(e.key==='Enter'&&!list.hidden){e.preventDefault();if(highlight>=0)choose(matches[highlight].value);else if(matches.length===1)choose(matches[0].value);}
  else if(e.key==='Escape'){e.preventDefault();select.value=selected;input.value=select.value;close();renderEntry();}
 };
 select.addEventListener('change',syncEntryKeywordSearch);
 syncEntryKeywordSearch();
}

function setupManualSearch(){
 const save=document.querySelector('[data-action="saveManualEntry"]');
 const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Search';button.style.marginRight='8px';
 button.setAttribute('aria-label','Search selected keyword in a new tab');
 button.onclick=()=>{
  const keyword=$('entryKeyword').value;
  if(!ready||!user||!keyword){notify('Select a keyword before searching.');$('entryKeywordSearch')?.focus();return;}
  const url=new URL('https://www.google.com/search');url.searchParams.set('q',keyword);
  window.open(url.href,'_blank','noopener,noreferrer');
  const market=marketByName($('entryCountry').value),date=$('entryDate').value;
  const k=keywordRecords.find(k=>k.keyword===keyword&&(k.market_id===market?.id||k.market_id===null));
  if(!market||!k||!date)return;
  const company=activeAccount,ticket=generation,uid=user.id;
  const pending=db.rpc('record_ranking_search',{p_company:company,p_keyword:k.id,p_market:market.id,p_date:date}).then(result=>{if(result.error)throw result.error;return {};}).catch(error=>{if(company===activeAccount&&ticket===generation&&uid===user?.id)notify('Could not record Search: '+error.message);return {error};});
  pendingRankingSearches.set(searchUsageKey(company,k.id,market.id,date),pending);
 };
 save.insertAdjacentElement('beforebegin',button);
}
let workRequestPage=0,workRequestLoad=0,workRequestBusy=false;
function clearWorkRequestsUI(){
 workRequestLoad++;workRequestPage=0;$('workRequestRows')?.replaceChildren();$('workRequestForm')?.reset();if($('workRequestStatus'))$('workRequestStatus').textContent='';
}
function setupWorkRequestsUI(){
 const button=document.createElement('button');button.type='button';button.dataset.page='requests';button.hidden=true;button.textContent='Request to admin';document.querySelector('.nav').append(button);
 const page=document.createElement('section');page.id='requests';page.className='page';
 page.innerHTML='<div class="panel" id="workRequestSubmitPanel"><h3>Request temporary work cover</h3><p>Your currently assigned markets will be included. Choose your leave dates and explain why you need someone to cover your work.</p><form id="workRequestForm"><div class="filters"><div><label for="workRequestStart">First day</label><input type="date" id="workRequestStart" required></div><div><label for="workRequestEnd">Last day</label><input type="date" id="workRequestEnd" required></div></div><label for="workRequestReason">Reason</label><textarea id="workRequestReason" rows="3" maxlength="2000" required placeholder="For example: I am going on leave for 10 days." style="display:block;width:100%;box-sizing:border-box;margin:8px 0 14px"></textarea><button type="submit" class="btn primary" id="workRequestSend">Send for approval</button></form></div><div class="panel"><div class="sectiontitle"><h3 id="workRequestHistoryTitle">Request history</h3><button type="button" class="btn" id="workRequestRefresh">Refresh</button></div><p id="workRequestStatus" role="status"></p><div class="tablewrap"><table><thead><tr><th>Staff member</th><th>Dates (GST)</th><th>Reason / work</th><th>Status</th><th>Covering person</th><th>Review</th></tr></thead><tbody id="workRequestRows"></tbody></table></div><div class="pagination work-request-pagination"><button type="button" class="btn" id="workRequestPrevious">Previous</button><span id="workRequestPageLabel"></span><button type="button" class="btn" id="workRequestNext">Next</button></div></div>';
 document.querySelector('main').append(page);
 const content=document.createElement('div');content.id='workRequestsContent';while(page.firstChild)content.append(page.firstChild);page.append(content);
 $('workRequestRefresh').onclick=()=>{workRequestPage=0;void switchAccount(activeAccount);};
 $('workRequestPrevious').onclick=()=>{workRequestPage=Math.max(0,workRequestPage-1);void renderWorkRequests();};$('workRequestNext').onclick=()=>{workRequestPage++;void renderWorkRequests();};
 $('workRequestForm').onsubmit=async event=>{
  event.preventDefault();if(workRequestBusy||!ready||!user||!canRequestWork())return;
  const uid=user.id,ticket=generation;workRequestBusy=true;$('workRequestSend').disabled=true;$('workRequestStatus').textContent='Sending request…';
  try{check(await db.rpc('submit_work_request',{p_start:$('workRequestStart').value,p_end:$('workRequestEnd').value,p_reason:$('workRequestReason').value.trim()}));if(uid!==user?.id||ticket!==generation)return;$('workRequestForm').reset();workRequestPage=0;await renderWorkRequests();$('workRequestStatus').textContent='Request sent. Waiting for administrator approval.';}
  catch(error){if(uid===user?.id&&ticket===generation)$('workRequestStatus').textContent=error.message;}
  finally{workRequestBusy=false;$('workRequestSend').disabled=false;}
 };
}
async function decideWorkRequest(id,decision,coverId=null,note=''){
 if(workRequestBusy||!ready||!user)return;
 if(decision==='approve'&&!coverId){$('workRequestStatus').textContent='Choose the person who will cover this work.';return;}
 const uid=user.id,ticket=generation,buttonStates=[...document.querySelectorAll('#workRequestRows button')].map(button=>[button,button.disabled]);workRequestBusy=true;for(const [button] of buttonStates)button.disabled=true;$('workRequestSend').disabled=true;$('workRequestStatus').textContent='Saving decision…';
 try{check(await db.rpc('decide_work_request',{p_request_id:id,p_decision:decision,p_cover_user_id:coverId,p_note:note}));if(uid!==user?.id||ticket!==generation)return;await renderWorkRequests();$('workRequestStatus').textContent=decision==='approve'?'Approved. Temporary ranking-entry access applies only during the requested dates.':decision==='reject'?'Request rejected.':'Request cancelled. Temporary cover access has ended.';}
 catch(error){if(uid===user?.id&&ticket===generation)$('workRequestStatus').textContent=error.message;}
 finally{workRequestBusy=false;for(const [button,disabled] of buttonStates)if(button.isConnected)button.disabled=disabled;$('workRequestSend').disabled=false;}
}
async function renderWorkRequests(){
 const request=++workRequestLoad,ticket=generation,uid=user?.id;$('workRequestRows').replaceChildren();
 if(!ready||!user||!canSeeWorkRequests())return;
 const admin=canManageStaff();$('pageTitle').textContent=admin?'Staff info':'Request to admin';$('workRequestSubmitPanel').hidden=admin||!canRequestWork();$('workRequestHistoryTitle').textContent=admin?'Work requests':'Request history and assigned cover';
 $('workRequestStart').min=$('workRequestEnd').min=dubaiToday();$('workRequestStatus').textContent='Loading requests…';$('workRequestPrevious').disabled=$('workRequestNext').disabled=true;
 try{
  const rows=check(await db.from('work_requests').select('*').order('requested_at',{ascending:false}).order('id',{ascending:false}).range(workRequestPage*50,workRequestPage*50+50));let accounts=[];
  if(admin&&rows.some(r=>r.status==='pending')){const {data,error}=await db.functions.invoke('admin-list-users',{body:{}});if(error)throw Error(await functionMessage(error,'Unable to load covering users.'));if(!data?.ok)throw Error(data?.error||'Unable to load covering users.');accounts=data.accounts||[];}
  if(request!==workRequestLoad||ticket!==generation||uid!==user?.id)return;
  for(const item of rows.slice(0,50)){
   const tr=document.createElement('tr');tr.insertCell().textContent=item.requester_name;tr.insertCell().textContent=item.start_date+' → '+item.end_date;
   const detailsCell=tr.insertCell();detailsCell.style.cssText='white-space:normal;min-width:240px;max-width:420px';const reason=document.createElement('p');reason.textContent=item.reason;const details=document.createElement('details'),summary=document.createElement('summary'),work=document.createElement('p');summary.textContent='Assigned work';work.textContent=item.scopes.map(s=>s.company+': '+s.markets.join(', ')).join('\n');work.style.whiteSpace='pre-line';details.append(summary,work);detailsCell.append(reason,details);
   let status=item.status==='approved'?(item.end_date<dubaiToday()?'Completed':item.start_date>dubaiToday()?'Approved · Upcoming':'Approved · Active'):item.status.charAt(0).toUpperCase()+item.status.slice(1);
   if(item.decided_name)status+='\nReviewed by '+item.decided_name;if(item.decision_note)status+='\n'+item.decision_note;const statusCell=tr.insertCell();statusCell.textContent=status;statusCell.style.whiteSpace='pre-line';tr.insertCell().textContent=item.cover_name||'—';
   const actions=tr.insertCell();actions.style.whiteSpace='normal';
   if(admin&&item.status==='pending'){
    const select=document.createElement('select');select.setAttribute('aria-label','Choose covering person for '+item.requester_name);const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Assign to…';select.append(placeholder);
    const eligible=accounts.filter(a=>a.id!==item.requester_id&&a.username!=='fawaz@db'&&!a.memberships.some(m=>m.role==='auditor')&&item.scopes.every(s=>a.memberships.some(m=>m.companyId===s.company_id)));
    for(const account of eligible){const option=document.createElement('option');option.value=account.id;option.textContent=account.username;select.append(option);}
    const note=document.createElement('input');note.placeholder='Admin note (optional)';note.maxLength=2000;note.setAttribute('aria-label','Decision note for '+item.requester_name);note.style.cssText='display:block;margin:8px 0;max-width:220px';
    const approve=document.createElement('button'),reject=document.createElement('button');approve.type=reject.type='button';approve.className='btn primary sm';reject.className='btn sm';approve.textContent='Accept and assign';reject.textContent='Reject';approve.disabled=!eligible.length;approve.onclick=()=>void decideWorkRequest(item.id,'approve',select.value,note.value);reject.onclick=()=>void decideWorkRequest(item.id,'reject',null,note.value);actions.append(select,note,approve,reject);
   }else if((item.requester_id===uid||admin)&&['pending','approved'].includes(item.status)&&item.end_date>=dubaiToday()){
    const cancel=document.createElement('button');cancel.type='button';cancel.className='btn sm';cancel.textContent=item.status==='approved'?'End cover early':'Cancel request';cancel.onclick=()=>void decideWorkRequest(item.id,'cancel');actions.append(cancel);
   }else actions.textContent='—';$('workRequestRows').append(tr);
  }
  $('workRequestStatus').textContent=rows.length?'':'No requests yet.';$('workRequestPageLabel').textContent='Page '+(workRequestPage+1);$('workRequestPrevious').disabled=workRequestPage===0;$('workRequestNext').disabled=rows.length<=50;
 }catch(error){if(request===workRequestLoad&&ticket===generation&&uid===user?.id)$('workRequestStatus').textContent='Unable to load requests: '+error.message;}
}
let staffRequest=0,staffResetTarget=null,staffResetBusy=false;
function clearStaffUI(){
 staffRequest++;staffResetTarget=null;
 $('staffRows')?.replaceChildren();
 const dialog=$('staffPasswordDialog');if(dialog?.open)dialog.close();
 $('staffPasswordForm')?.reset();
 if($('staffPassword'))$('staffPassword').type='password';
}
async function functionMessage(error,fallback){
 try{const body=await error.context?.json();return body?.error||error.message||fallback;}catch{return error.message||fallback;}
}
function setupStaffUI(){
 const button=document.createElement('button');button.type='button';button.dataset.page='staffs';button.hidden=true;button.textContent='Staff info';document.querySelector('.nav').append(button);
 const page=document.createElement('section');page.id='staffs';page.className='page';page.innerHTML='<div class="panel"><div class="sectiontitle"><h3>Login accounts</h3><button type="button" class="btn" id="staffRefresh">Refresh</button></div><p id="staffStatus" role="status"></p><div class="tablewrap"><table><thead><tr><th>Username</th><th>Role / companies</th><th>Last sign-in (GST)</th><th>Action</th></tr></thead><tbody id="staffRows"></tbody></table></div></div>';
 document.querySelector('main').append(page);
 const alerts=document.createElement('div');alerts.className='panel';alerts.id='rankingAlertsPanel';alerts.innerHTML='<div class="sectiontitle"><h3>Ranking alerts</h3><button type="button" class="btn" id="rankingAlertsRefresh">Refresh</button></div><p id="rankingAlertsStatus" role="status"></p><div class="tablewrap"><table><thead><tr><th>Staff member</th><th>Keyword</th><th>Company / market</th><th>Saved (GST, UTC+4)</th><th>Warning</th></tr></thead><tbody id="rankingAlertsRows"></tbody></table></div>';page.prepend(alerts);$('rankingAlertsRefresh').onclick=()=>void renderRankingAlerts();
 const dialog=document.createElement('dialog');dialog.id='staffPasswordDialog';dialog.className='panel';dialog.style.cssText='width:min(480px,94vw);color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:14px';
 dialog.innerHTML='<div class="sectiontitle"><h2>Change password</h2><button type="button" class="btn" id="staffPasswordClose">Close</button></div><p id="staffPasswordUsername"></p><form id="staffPasswordForm"><label for="staffPassword">New password</label><div style="display:flex;gap:8px;margin:8px 0"><input id="staffPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required style="min-width:0;flex:1"><button type="button" class="btn" id="staffPasswordShow" aria-controls="staffPassword" aria-pressed="false">Show</button></div><p>Use at least 12 characters.</p><p id="staffPasswordStatus" role="status"></p><button type="submit" class="btn primary" id="staffPasswordSave">Save password</button></form>';
 document.body.append(dialog);$('staffRefresh').onclick=()=>void renderStaffs();
 $('staffPasswordClose').onclick=()=>{dialog.close();$('staffPasswordForm').reset();staffResetTarget=null;};
 dialog.addEventListener('close',()=>{$('staffPasswordForm').reset();staffResetTarget=null;});
 $('staffPasswordShow').onclick=()=>{const show=$('staffPassword').type==='password';$('staffPassword').type=show?'text':'password';$('staffPasswordShow').textContent=show?'Hide':'Show';$('staffPasswordShow').setAttribute('aria-pressed',String(show));};
 $('staffPasswordForm').onsubmit=async event=>{
  event.preventDefault();if(staffResetBusy||!ready||!user||!canManageStaff()||!staffResetTarget)return;
  const target={...staffResetTarget},uid=user.id,ticket=generation,newPassword=$('staffPassword').value;
  staffResetBusy=true;$('staffPasswordSave').disabled=true;$('staffPasswordStatus').textContent='Changing password…';
  try{const {data,error}=await db.functions.invoke('admin-reset-password',{body:{targetUserId:target.id,newPassword}});if(error)throw Error(await functionMessage(error,'Password change failed.'));if(!data?.ok)throw Error(data?.error||'Password change failed.');if(uid===user?.id&&ticket===generation&&staffResetTarget?.id===target.id&&canManageStaff()){$('staffPassword').value='';$('staffPassword').type='password';$('staffPasswordShow').textContent='Show';$('staffPasswordShow').setAttribute('aria-pressed','false');$('staffPasswordStatus').textContent='Password changed for '+target.username+'.';}}
  catch(error){if(uid===user?.id&&ticket===generation&&staffResetTarget?.id===target.id)$('staffPasswordStatus').textContent=error.message;}
  finally{staffResetBusy=false;$('staffPasswordSave').disabled=false;}
 };
}
async function renderStaffInfo(){await Promise.all([renderStaffs(),renderWorkRequests(),renderRankingAlerts()]);}
async function renderStaffs(){
 const request=++staffRequest,ticket=generation,uid=user?.id;$('staffRows').replaceChildren();
 if(!ready||!user||!canManageStaff())return;
 $('staffStatus').textContent='Loading login accounts…';
 try{
  const {data,error}=await db.functions.invoke('admin-list-users',{body:{}});if(error)throw Error(await functionMessage(error,'Unable to load accounts.'));if(!data?.ok)throw Error(data?.error||'Unable to load accounts.');
  if(request!==staffRequest||ticket!==generation||uid!==user?.id||!canManageStaff())return;
  const roles={owner:'Admin',editor:'Admin',co_admin:'Co-admin',head_staff:'Head of staff',staff:'Staff',viewer:'Read only'};
  const accounts=(data.accounts||[]).filter(a=>a.username!=='fawaz@db'&&!a.memberships?.some(m=>m.role==='auditor'));
  for(const account of accounts){const tr=document.createElement('tr');tr.insertCell().textContent=account.username;
   tr.insertCell().textContent=(account.memberships||[]).map(m=>(roles[m.role]||m.role)+' · '+m.company).join('; ');
   tr.insertCell().textContent=account.lastSignIn?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai',dateStyle:'medium',timeStyle:'short'}).format(new Date(account.lastSignIn)):'Never signed in';
   const button=document.createElement('button');button.type='button';button.className='btn sm';button.textContent='Change password';button.onclick=()=>{if(!ready||!user||!canManageStaff())return;staffResetTarget={id:account.id,username:account.username};$('staffPasswordForm').reset();$('staffPassword').type='password';$('staffPasswordShow').textContent='Show';$('staffPasswordShow').setAttribute('aria-pressed','false');$('staffPasswordUsername').textContent=account.username;$('staffPasswordStatus').textContent='';$('staffPasswordDialog').showModal();};tr.insertCell().append(button);$('staffRows').append(tr);
  }
  $('staffStatus').textContent=accounts.length?accounts.length+' login accounts':'No login accounts found.';
 }catch(error){if(request===staffRequest&&ticket===generation&&uid===user?.id)$('staffStatus').textContent=error.message;}
}
let auditPage=0,auditRequest=0;
function setupAuditUI(){
 const button=document.createElement('button');button.type='button';button.dataset.page='audit';button.hidden=true;button.textContent='Audit History';document.querySelector('.nav').append(button);
 const page=document.createElement('section');page.id='audit';page.className='page';
 page.innerHTML='<div class="panel"><p>Changes recorded from 5 October 2026. Times shown in Gulf Standard Time (UTC+4).</p><div class="filters"><div><label for="auditCompany">Company</label><select id="auditCompany"><option value="">All companies</option></select></div><div><label for="auditAction">Action</label><select id="auditAction"><option value="">All actions</option><option value="INSERT">Created</option><option value="UPDATE">Modified</option><option value="DELETE">Deleted</option><option value="PASSWORD_CHANGED">Password changed</option><option value="PASSWORD_RESET">Password reset</option><option value="SIGNED_IN">Signed in</option></select></div><div><label for="auditUser">Username</label><input id="auditUser" placeholder="Filter by username"></div></div><button type="button" class="btn" id="auditRefresh">Refresh</button><p id="auditStatus" role="status"></p><div class="tablewrap"><table><thead><tr><th>Time (GST)</th><th>Who</th><th>Action</th><th>Company</th><th>Data</th><th>Details</th></tr></thead><tbody id="auditRows"></tbody></table></div><div class="pagination audit-pagination"><button type="button" class="btn" id="auditPrevious">Previous</button><span id="auditPageLabel"></span><button type="button" class="btn" id="auditNext">Next</button></div></div>';
 document.querySelector('main').append(page);
 for(const id of ['auditCompany','auditAction','auditUser'])$(id).onchange=()=>{auditPage=0;void renderAudit();};
 $('auditRefresh').onclick=()=>{auditPage=0;void renderAudit();};$('auditPrevious').onclick=()=>{auditPage=Math.max(0,auditPage-1);void renderAudit();};$('auditNext').onclick=()=>{auditPage++;void renderAudit();};
}
function auditValues(values){
 if(!values)return '—';
 return Object.entries(values).filter(([key])=>!['id','created_at','updated_at'].includes(key)&&!key.endsWith('_id')).map(([key,value])=>key.replaceAll('_',' ')+': '+(key==='scopes'&&Array.isArray(value)?value.map(s=>s.company+': '+s.markets.join(', ')).join('; '):key==='position'&&value===null?'Not Ranked':typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'—'))).join('\n')||'—';
}
async function renderAudit(){
 const request=++auditRequest,ticket=generation,uid=user?.id;
 $('auditRows').replaceChildren();if(!ready||!user||!canAudit())return;
 fillSelect('auditCompany',[['','All companies'],...companies.map(c=>[c.id,c.domain])],false);
 $('auditStatus').textContent='Loading audit history…';$('auditPrevious').disabled=$('auditNext').disabled=true;
 let query=db.from('audit_events').select('*').order('occurred_at',{ascending:false}).order('id',{ascending:false}).range(auditPage*50,auditPage*50+50);
 if($('auditCompany').value)query=query.eq('company_id',$('auditCompany').value);
 if($('auditAction').value)query=query.eq('action',$('auditAction').value);
 if($('auditUser').value.trim())query=query.ilike('actor_name','%'+$('auditUser').value.trim()+'%');
 try{
  const rows=check(await query);if(request!==auditRequest||ticket!==generation||uid!==user?.id||!canAudit())return;
  const actions={INSERT:'Created',UPDATE:'Modified',DELETE:'Deleted',PASSWORD_CHANGED:'Password changed',PASSWORD_RESET:'Password reset',SIGNED_IN:'Signed in'};
  for(const item of rows.slice(0,50)){
   const tr=document.createElement('tr');
   for(const value of [new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai',dateStyle:'medium',timeStyle:'medium'}).format(new Date(item.occurred_at)),item.actor_name,actions[item.action]||item.action,item.company_name||(item.entity_type==='accounts'?'User accounts':'All companies'),item.entity_type.replaceAll('_',' ')+' · '+item.description]){const td=tr.insertCell();td.textContent=value;}
   const td=tr.insertCell(),details=document.createElement('details'),summary=document.createElement('summary'),before=document.createElement('pre'),after=document.createElement('pre');summary.textContent='View changes';before.textContent='Before\n'+auditValues(item.before_values);after.textContent='After\n'+auditValues(item.after_values);for(const pre of [before,after])pre.style.cssText='white-space:pre-wrap;max-width:420px;overflow-wrap:anywhere';details.append(summary,before,after);td.append(details);$('auditRows').append(tr);
  }
  $('auditStatus').textContent=rows.length?'':'No matching audit events.';$('auditPageLabel').textContent='Page '+(auditPage+1);$('auditPrevious').disabled=auditPage===0;$('auditNext').disabled=rows.length<=50;
 }catch(error){if(request===auditRequest&&ticket===generation&&uid===user?.id)$('auditStatus').textContent='Unable to load audit history: '+error.message;}
}
async function renderRankingAlerts(){
 const request=++rankingAlertLoad,uid=user?.id,ticket=generation,panel=$('rankingAlertsPanel');
 if(!panel)return;panel.hidden=!canManageStaff();
 if(!ready||!user||!canManageStaff()){$('rankingAlertsRows').replaceChildren();return;}
 try{
  const result=await db.from('staff_ranking_alerts').select('*',{count:'exact'}).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(50);const rows=check(result);
  if(request!==rankingAlertLoad||uid!==user?.id||ticket!==generation||!canManageStaff())return;
  $('rankingAlertsRows').replaceChildren();
  const names=new Map(companies.map(c=>[c.id,c.domain]));
  for(const alert of rows){const tr=document.createElement('tr');for(const value of [alert.staff_name,alert.keyword_name,(names.get(alert.company_id)||'Company')+' / '+alert.market_name,new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai',dateStyle:'medium',timeStyle:'short'}).format(new Date(alert.created_at)),alert.warning])tr.insertCell().textContent=value;$('rankingAlertsRows').append(tr);}
  $('rankingAlertsStatus').textContent=rows.length?'Latest '+rows.length+' of '+(result.count??rows.length)+' alerts.':'No ranking alerts.';
  const nav=document.querySelector('[data-page="staffs"]');nav.classList.remove('ranking-alert-text');nav.textContent='Staff info';if(result.count){const badge=document.createElement('span');badge.className='ranking-alert-text';badge.textContent=' ('+result.count+' alert'+(result.count===1?'':'s')+')';nav.append(badge);}
  if(rows[0]&&rows[0].id!==rankingAlertLatest){rankingAlertLatest=rows[0].id;toast(rows[0].staff_name+' saved '+rows[0].keyword_name+' without using Search.','warning');}
 }catch(error){if(request===rankingAlertLoad&&uid===user?.id&&ticket===generation)$('rankingAlertsStatus').textContent='Could not load ranking alerts: '+error.message;}
}
function wireUI(){
 setupAuditUI();
 setupStaffUI();
 setInterval(()=>{if(user&&ready&&canManageStaff())void renderRankingAlerts();},45000);
 setupWorkRequestsUI();
 setupEntryKeywordSearch();
 setupManualSearch();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDateAccess();});
 document.addEventListener('change',e=>{if(e.target.closest('.filters'))pageOffsets.clear();},true);
 document.addEventListener('input',e=>{if(e.target.id==='rankSearch')pageOffsets.clear();},true);
 const actions={logout,goToReports,generateCurrentPDF,saveManualEntry,addKeyword,addMarket};document.querySelectorAll('[data-action]').forEach(el=>el.onclick=actions[el.dataset.action]);$('accountSelect').onchange=e=>switchAccount(e.target.value);
 const titles={dashboard:'SERP Dashboard',rankings:'Daily Rankings',history:'Keyword History',reports:'Monthly Reports',entry:'Manual SERP Entry',keywords:'Keyword Management',markets:'Countries / Markets',import:'Import / Data',audit:'Audit History',staffs:'Staff info',requests:'Request to admin'};
 document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>{if(!ready)return;document.querySelectorAll('.nav button,.page').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.page).classList.add('active');$('pageTitle').textContent=titles[b.dataset.page];$('pageDesc').textContent=pageDescription();renderActivePage();});
 for(const id of ['rankMonth','rankCountry'])$(id).onchange=()=>{if(id==='rankMonth'&&$('rankDate').value&&!$('rankDate').value.startsWith($('rankMonth').value))$('rankDate').value='';renderRankings();};
 $('rankDate').onchange=()=>{const date=$('rankDate').value;if(date){const month=date.slice(0,7),select=$('rankMonth');if(![...select.options].some(o=>o.value===month)){const option=document.createElement('option');option.value=option.textContent=month;select.append(option);}select.value=month;}renderRankings();};$('rankSearch').oninput=renderRankings;
 for(const id of ['histKeyword','histCountry','histFrom','histTo'])$(id).onchange=renderHistory;
 for(const id of ['reportMonth','reportCountry'])$(id).onchange=renderReport;
 for(const id of ['dashMonth','dashCountry'])$(id).onchange=updateDashboard;
 $('entryDate').onchange=renderEntry;$('entryKeyword').onchange=renderEntry;$('entryCountry').onchange=()=>{refreshEntryKeywords();renderEntry();};
 $('fileInput').onchange=e=>importFile(e.target.files[0]);const drop=$('drop');for(const event of ['dragenter','dragover','dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.toggle('drag',event==='dragenter'||event==='dragover');if(event==='drop')importFile(e.dataTransfer.files[0]);});
 $('authForm').onsubmit=async e=>{e.preventDefault();if(busy)return;setBusy(true);authMessage(recovery?'Updating password…':'Signing in…');try{if(recovery){check(await db.auth.updateUser({password:$('password').value}));recovery=false;$('loginButton').textContent='Sign in';authMessage('Password updated.');await openSession(check(await db.auth.getSession()).session);}else{const data=check(await db.auth.signInWithPassword({email:usernameEmail($('email').value),password:$('password').value}));$('password').value='';await openSession(data.session);}}catch(e){authMessage(e.message);}finally{setBusy(false);}};
 $('resetButton').onclick=()=>authMessage('Contact your administrator to reset your username account password.');
 $('authSignout').onclick=logout;
 $('loginCodeForm').onsubmit=async e=>{e.preventDefault();if(busy||!loginChallenge)return;setBusy(true);$('verifyLoginCode').disabled=true;$('loginCodeMessage').textContent='Checking code…';try{await codeRequest('verify',{challengeId:loginChallenge,code:$('loginCode').value.trim()});await openSession(check(await db.auth.getSession()).session);}catch(e){$('loginCodeMessage').textContent=e.message;}finally{setBusy(false);$('verifyLoginCode').disabled=!loginChallenge;refreshCodeResend();}};
 $('resendLoginCode').onclick=async()=>{if(busy||Date.now()<loginResendAt)return;setBusy(true);try{await sendLoginCode();}finally{setBusy(false);refreshCodeResend();}};
 $('cancelLoginCode').onclick=logout;
}
async function boot(){wireUI();$('loader').classList.add('hide');try{if(!window.supabase)throw Error('The website libraries failed to load. Reload to retry.');db=supabase.createClient(SERP_CONFIG.url,SERP_CONFIG.publishableKey,{auth:{persistSession:true,storage:sessionStorage,autoRefreshToken:true,detectSessionInUrl:true},global:{fetch:async(input,options={})=>fetch(input,{...options,signal:options.signal||AbortSignal.timeout(30000)})}});
 db.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'){showCodeScreen(false);user=null;$('authSignout').hidden=true;clearPrivate();$('authScreen').hidden=false;}if(event==='PASSWORD_RECOVERY'){showCodeScreen(false);recovery=true;clearPrivate();user=session.user;$('authScreen').hidden=false;$('email').value=session.user.app_metadata?.username||session.user.email.split('@')[0];$('password').value='';$('password').autocomplete='new-password';$('loginButton').textContent='Set new password';authMessage('Enter a new password to finish account setup or recovery.');}});
 const data=check(await db.auth.getSession());if(!recovery)await openSession(data.session);
 setInterval(async()=>{if(!ready||!user||busy||loginCheckPending)return;loginCheckPending=true;try{const status=check(await db.rpc('login_status'));if(!status.approved){clearPrivate();companies=[];memberships=[];await openSession(check(await db.auth.getSession()).session);}}catch{clearPrivate();authMessage('Your session could not be checked. Sign in again.');$('authScreen').hidden=false;}finally{loginCheckPending=false;}},30000);
 document.modelContext?.registerTool({name:'read_serp_workspace_summary',description:'Read counts for the signed-in, currently selected SERP company.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if(Object.keys(input||{}).length||!ready||!user)throw Error('A loaded authenticated workspace and empty input are required.');return {company:companyLabel(),markets:state.markets.length,keywords:state.keywords.length,rankings:state.rows.length};}});
 }catch(e){authMessage(e.message);}}
boot();

