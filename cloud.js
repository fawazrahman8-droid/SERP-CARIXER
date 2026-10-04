'use strict';
let db, user=null, companies=[], memberships=[], marketRecords=[], keywordRecords=[];
let generation=0, busy=false, ready=false, recovery=false;
const pageOffsets=new Map();
const $=id=>document.getElementById(id);
const emptyState=()=>({rows:[],sheets:[],keywords:[],markets:[]});
function SafeChart(canvas,config){if(!window.Chart)return {destroy(){}};config.options={...config.options,animation:false};return new window.Chart(canvas,config);}
function activeCompany(){return companies.find(c=>c.id===activeAccount);}
function companyLabel(){const c=activeCompany();return c?`${c.domain} — ${c.name}`:'';}
function notify(message){$('notice').textContent=message;$('notice').hidden=!message;}
function canWrite(){return memberships.some(m=>m.company_id===activeAccount&&['owner','editor'].includes(m.role));}

function isCoAdmin(){return memberships.some(m=>m.company_id===activeAccount&&m.role==='co_admin');}
function dubaiToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function usernameEmail(value){const username=value.trim().toLowerCase();if(!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))throw Error('Enter your assigned username.');return username+'@users.serptrack.invalid';}
function pageDescription(){return companyLabel()+(isCoAdmin()?' · Add new rankings for today ('+dubaiToday()+', Dubai)':'');}
let dateAccessTimer=null,loadedAccessDate='';
function refreshDateAccess(){
 if(!user||!isCoAdmin()||!loadedAccessDate||loadedAccessDate===dubaiToday())return;
 ready=false;state=emptyState();clearRenderedPages();document.querySelector('.app').hidden=true;
 if(busy){dateAccessTimer=setTimeout(refreshDateAccess,1000);return;}
 void switchAccount(activeAccount);
}
function applyRoleUI(){
 const limited=isCoAdmin();loadedAccessDate=limited?dubaiToday():'';
 document.querySelectorAll('.nav button').forEach(el=>el.hidden=false);
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
  loader.innerHTML='<div class="loader-inner workspace-loading"><div class="loader-logo">SERP <span>TRACK</span></div><div class="workspace-spinner" aria-hidden="true"></div><div role="status" aria-live="polite"><h2>Loading your workspace…</h2><p>Preparing your rankings and dashboard.</p></div></div>';
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
 document.querySelectorAll('.pagination').forEach(el=>el.remove());
}
function renderActivePage(){
 const renderers={dashboard:updateDashboard,rankings:renderRankings,history:renderHistory,reports:renderReport,entry:renderEntry,keywords:renderKeywords,markets:renderMarkets,import:renderImportInfo};
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
function clearPrivate(){clearTimeout(dateAccessTimer);loadedAccessDate='';setWorkspaceLoading(false);generation++;ready=false;activeAccount=null;state=emptyState();marketRecords=[];keywordRecords=[];document.querySelector('.app').hidden=true;for(const chart of [monthChart,historyChart,reportChart,rankDonut])chart?.destroy();monthChart=historyChart=reportChart=rankDonut=null;document.querySelectorAll('tbody,.keyword-list,#latestSnapshot,#donutLegend,#dashReportStats,#reportStats,#dataInfo').forEach(el=>el.replaceChildren());$('accountSelect').replaceChildren();}
async function allRows(table,companyId){let rows=[];for(let from=0;;from+=1000){let q=db.from(table).select('*').order('id').range(from,from+999);if(companyId)q=q.eq('company_id',companyId);const page=check(await q);rows.push(...page);if(page.length<1000)return rows;}}
async function loadCompany(id){
 if(!companies.some(c=>c.id===id))throw Error('Company access is not available.');
 const ticket=++generation; ready=false;activeAccount=id;state=emptyState();marketRecords=[];keywordRecords=[];
 document.querySelector('.app').hidden=true;
 clearRenderedPages();
 const [ms,ks,rs]=await Promise.all(['markets','keywords','rankings'].map(t=>allRows(t,id)));
 if(ticket!==generation||!user)return;
 marketRecords=ms;keywordRecords=ks;const markets=new Map(ms.map(m=>[m.id,m.name])),keywords=new Map(ks.map(k=>[k.id,k.keyword]));
 if([...ms,...ks,...rs].some(r=>r.company_id!==id))throw Error('Unexpected company data. Please reload.');
 const visibleRankings=rs;
 state={markets:ms.map(m=>m.name),keywords:ks.map(k=>({id:k.id,market_id:k.market_id,name:k.keyword,market:markets.get(k.market_id)||'',addedAt:k.created_at.slice(0,10)})),sheets:[],rows:visibleRankings.map(r=>({id:r.id,market_id:r.market_id,keyword_id:r.keyword_id,date:r.ranking_date,month:r.ranking_date.slice(0,7),country:markets.get(r.market_id)||'',keyword:keywords.get(r.keyword_id)||'',position:r.position,source:r.source}))};
 // Clear every page on reload; render other pages only when opened.
 document.querySelectorAll('.filters input').forEach(el=>el.value='');
 document.querySelector('.app').hidden=false;
 rebuildFilters();$('accountSelect').value=id;$('entryAccount').textContent=companyLabel();$('pageDesc').textContent=pageDescription();
 $('sessionLabel').textContent=`${user.app_metadata?.username||user.email?.split('@')[0]||'Signed in'} · ${isCoAdmin()?'Co-admin · Today entry only':canWrite()?'Admin':'Read only'}`;
 document.querySelectorAll('#entry button,#keywords button,#markets button,#import button,#fileInput').forEach(el=>el.disabled=!canWrite());
 applyRoleUI();ready=true;document.querySelector('.app').hidden=false;$('authScreen').hidden=true;
}
async function switchAccount(id){if(busy||!user)return;setBusy(true);notify('');setWorkspaceLoading(true);try{await loadCompany(id);notify('');}catch(e){ready=false;state=emptyState();document.querySelector('.app').hidden=true;$('authScreen').hidden=false;authMessage('Unable to load company: '+e.message+'. Sign in again to retry.');}finally{setWorkspaceLoading(false);setBusy(false);}}
async function openSession(session){
 if(!session){user=null;companies=[];memberships=[];clearPrivate();$('authScreen').hidden=false;$('authSignout').hidden=true;return;}
 const ticket=++generation;user=session.user;setBusy(true);notify('');setWorkspaceLoading(true);
 try{const [cs,ms]=await Promise.all([allRows('companies'),db.from('company_members').select('company_id,role').eq('user_id',user.id).then(check)]);
  if(ticket!==generation)return;companies=cs;memberships=ms;$('authSignout').hidden=false;
  if(!cs.length){clearPrivate();$('authScreen').hidden=false;authMessage('Signed in, but no company membership has been assigned. Ask your administrator to assign company access.');return;}
  $('accountSelect').innerHTML=cs.map(c=>`<option value="${esc(c.id)}">${esc(c.domain+' — '+c.name)}</option>`).join('');
  const defaultCompany=cs.find(c=>c.domain.toLowerCase()==='carwashtrolley.com')||cs[0];
  await loadCompany(defaultCompany.id);
 }catch(e){clearPrivate();$('authScreen').hidden=false;authMessage('Workspace could not load: '+e.message);}finally{setWorkspaceLoading(false);setBusy(false);notify('');}
}
async function logout(){clearPrivate();user=null;$('authSignout').hidden=true;$('authScreen').hidden=false;authMessage('Signed out.');try{check(await db.auth.signOut({scope:'local'}));}catch(e){authMessage('Workspace cleared. Sign-out failed: '+e.message+' Close this tab to discard its session.');}}
async function mutate(action,message,allowTodayInsert=false){
 if(busy)return;if(!ready||!user||!(canWrite()||(allowTodayInsert&&isCoAdmin()))){notify('An owner or editor membership is required.');return;}
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
async function clearData(){if(!confirm('Permanently clear all markets, keywords and rankings for '+companyLabel()+'?'))return;await mutate(async id=>{for(const table of ['rankings','keywords','markets']){check(await db.from(table).delete().eq('company_id',id));if((await allRows(table,id)).length)throw Error('Some '+table+' could not be deleted. Check your membership.');}},'Selected company data cleared');}
async function saveManualEntry(){
 const date=$('entryDate').value,keyword=$('entryKeyword').value,market=marketByName($('entryCountry').value),raw=$('entryPosition').value;
 const position=raw===''?null:Number(raw);
 if(!date||!market||!keyword)return notify('Select date, country and keyword.');
 if(position!==null&&(!Number.isInteger(position)||position<1||position>1000))return notify('Position must be a whole number from 1 to 1000, or blank for Not Ranked.');
 const k=keywordRecords.find(k=>k.keyword===keyword&&(k.market_id===market.id||k.market_id===null));if(!k)return notify('This keyword is not assigned to the selected market.');
 if(isCoAdmin()&&date!==dubaiToday())return notify('You can only add rankings for today in Dubai time.');
 if(isCoAdmin()&&state.rows.some(r=>r.keyword_id===k.id&&r.market_id===market.id&&r.date===date))return notify('Already entered for today. Only an admin can change this ranking.');
 await mutate(async id=>{const record={company_id:id,market_id:market.id,keyword_id:k.id,ranking_date:date,position,source:'manual'};
 const query=isCoAdmin()?db.from('rankings').insert(record):db.from('rankings').upsert(record,{onConflict:'keyword_id,market_id,ranking_date'});
 const result=await query.select().single();if(result.error?.code==='23505')throw Error('Already entered for today. Only an admin can change this ranking.');check(result);$('entryPosition').value='';},'Ranking saved',true);
}
function deleteButton(table,id){const b=document.createElement('button');b.className='btn sm danger-text';b.textContent='Delete';b.disabled=!canWrite();b.hidden=isCoAdmin();b.onclick=()=>deleteRecord(table,id);return b;}
function renderKeywords(){const el=$('keywordList');el.replaceChildren();$('keywordCountPill').textContent=state.keywords.length+' keywords';for(const k of pageSlice('keywords',state.keywords,100,'keywordList',renderKeywords).items){const row=document.createElement('div');row.className='keyword-row';const text=document.createElement('span');text.textContent=k.name+' · '+(k.market||'Unassigned');row.append(text,deleteButton('keywords',k.id));el.append(row);}if(!el.children.length)el.textContent='No keywords yet.';}
function renderMarkets(){const el=$('marketList');el.replaceChildren();$('marketCountPill').textContent=marketRecords.length+' markets';for(const m of marketRecords){const row=document.createElement('div');row.className='market-row';const text=document.createElement('span');text.textContent=m.name;row.append(text,deleteButton('markets',m.id));el.append(row);}if(!el.children.length)el.textContent='No markets yet.';}
function renderEntry(){
 if(isCoAdmin())$('entryDate').value=dubaiToday();else if(!$('entryDate').value)$('entryDate').value=new Date().toLocaleDateString('en-CA');
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
function renderImportInfo(){$('dataInfo').textContent=state.rows.length.toLocaleString()+' ranking observations saved in Supabase for '+companyLabel()+'. Import merges by keyword, market and date; matching observations are updated.';}
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
  const fresh=await allRows('markets',company);const missing=parsed.markets.filter(name=>!fresh.some(m=>m.name===name));await chunks('markets',missing.map(name=>({company_id:company,name})),'company_id,name');
  const ms=await allRows('markets',company),map=new Map(ms.map(m=>[m.name,m.id]));
  await chunks('keywords',parsed.keywords.map(k=>({company_id:company,market_id:map.get(k.market),keyword:k.keyword})),'company_id,market_id,keyword');
  const ks=await allRows('keywords',company),km=new Map(ks.map(k=>[JSON.stringify([k.market_id,k.keyword]),k.id]));
  await chunks('rankings',parsed.rows.map(r=>({company_id:company,market_id:map.get(r.market),keyword_id:km.get(JSON.stringify([map.get(r.market),r.keyword])),ranking_date:r.date,position:r.position,source:'import'})),'keyword_id,market_id,ranking_date');
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
 };
 save.insertAdjacentElement('beforebegin',button);
}
function wireUI(){
 setupEntryKeywordSearch();
 setupManualSearch();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDateAccess();});
 document.addEventListener('change',e=>{if(e.target.closest('.filters'))pageOffsets.clear();},true);
 document.addEventListener('input',e=>{if(e.target.id==='rankSearch')pageOffsets.clear();},true);
 const actions={logout,goToReports,generateCurrentPDF,saveManualEntry,addKeyword,addMarket,clearData};document.querySelectorAll('[data-action]').forEach(el=>el.onclick=actions[el.dataset.action]);$('accountSelect').onchange=e=>switchAccount(e.target.value);
 const titles={dashboard:'SERP Dashboard',rankings:'Daily Rankings',history:'Keyword History',reports:'Monthly Reports',entry:'Manual SERP Entry',keywords:'Keyword Management',markets:'Countries / Markets',import:'Import / Data'};
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
}
async function boot(){wireUI();$('loader').classList.add('hide');try{if(!window.supabase)throw Error('The website libraries failed to load. Reload to retry.');db=supabase.createClient(SERP_CONFIG.url,SERP_CONFIG.publishableKey,{auth:{persistSession:true,storage:sessionStorage,autoRefreshToken:true,detectSessionInUrl:true},global:{fetch:async(input,options={})=>fetch(input,{...options,signal:options.signal||AbortSignal.timeout(30000)})}});
 db.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'){user=null;$('authSignout').hidden=true;clearPrivate();$('authScreen').hidden=false;}if(event==='PASSWORD_RECOVERY'){recovery=true;clearPrivate();user=session.user;$('authScreen').hidden=false;$('email').value=session.user.app_metadata?.username||session.user.email.split('@')[0];$('password').value='';$('password').autocomplete='new-password';$('loginButton').textContent='Set new password';authMessage('Enter a new password to finish account setup or recovery.');}});
 const data=check(await db.auth.getSession());if(!recovery)await openSession(data.session);
 document.modelContext?.registerTool({name:'read_serp_workspace_summary',description:'Read counts for the signed-in, currently selected SERP company.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if(Object.keys(input||{}).length||!ready||!user)throw Error('A loaded authenticated workspace and empty input are required.');return {company:companyLabel(),markets:state.markets.length,keywords:state.keywords.length,rankings:state.rows.length};}});
 }catch(e){authMessage(e.message);}}
boot();

