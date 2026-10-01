(()=>{
 const panel=document.createElement('div');panel.className='panel';
 panel.innerHTML='<h3>Google ranking check</h3><p class="hint">SerpApi · English · Desktop. UAE uses Dubai. Recent results are reused for 5 minutes. Up to 10 pages and 2 retries per new check. Maximum 30 checks per company daily, one per minute.</p><button class="btn primary" type="button">Find ranking</button><p role="status" aria-live="polite"></p>';
 document.querySelector('#entry').prepend(panel);
 const button=panel.querySelector('button'),status=panel.querySelector('[role=status]');
 let running=false;
 const clear=()=>{status.textContent='';};
 document.getElementById('accountSelect').addEventListener('change',clear);
 document.querySelector('[data-action="logout"]').addEventListener('click',clear);
 button.onclick=async()=>{
  if(running||!user||!ready||!canWrite())return;
  const company=activeAccount,ticket=generation,date=$('entryDate').value;
  const market=marketRecords.find(m=>m.name===$('entryCountry').value);
  const keyword=keywordRecords.find(k=>k.keyword===$('entryKeyword').value&&k.market_id===market?.id);
  if(!keyword||!market){status.textContent='Select a keyword and its market.';return;}
  const current=()=>ticket===generation&&company===activeAccount&&!!user;
  const latest=async()=>{
   const saved=await db.from('provider_checks').select('id,result,created_at').eq('company_id',company).eq('keyword_id',keyword.id).eq('market_id',market.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
   if(saved.error)throw Error('Could not read the saved provider result. Refresh and sign in again.');
   return saved.data;
  };
  const recent=row=>row&&Date.now()-Date.parse(row.created_at)<300000;
  const completed=row=>({...row.result,checkId:row.id});
  const recover=async()=>{
   for(let attempt=0;attempt<30;attempt++){
    if(!current())return null;
    const row=await latest();
    if(recent(row)){
     if(row.result?.status==='done')return completed(row);
     if(row.result?.status==='error')throw Error(row.result.message);
    }
    await new Promise(resolve=>setTimeout(resolve,3000));
   }
   throw Error('The provider check has not finished. Click Find ranking later to retrieve it; do not keep restarting the search.');
  };
  running=true;button.disabled=true;status.textContent='Checking for an existing result…';
  try{
   let data;const existing=await latest();
   if(recent(existing)&&existing.result?.status==='done')data=completed(existing);
   else if(recent(existing)&&(!existing.result||existing.result.status==='running')&&Date.now()-Date.parse(existing.created_at)<120000){
    status.textContent='A check is already running. Retrieving its result without another API request…';data=await recover();
   }else{
    status.textContent='Checking Google — up to 90 seconds…';
    const response=await db.functions.invoke('serp-ranking',{body:{company_id:company,keyword_id:keyword.id,market_id:market.id}});
    data=response.data;
    if(response.error){
     let message='',httpStatus=response.error.context?.status;
     try{message=(await response.error.context.json()).error||'';}catch{}
     if([400,401,403].includes(httpStatus)||message.includes('Daily limit'))throw Error(message||'Access denied. Sign in again.');
     const row=await latest();
     if(recent(row)&&row.result?.status==='done')data=completed(row);
     else if(recent(row)&&row.result?.status==='error')throw Error(row.result.message);
     else if(recent(row)&&(!row.result||row.result.status==='running')){
      status.textContent='Waiting for the existing check to finish — no additional API request…';data=await recover();
     }else throw Error(message||'The request failed before a check was stored. Please try again later.');
    }
   }
   if(!current()||!data)return;
   if($('entryKeyword').value!==keyword.keyword||$('entryCountry').value!==market.name||$('entryDate').value!==date){status.textContent='Selection changed. The check is saved; select that keyword again to retrieve it.';return;}
   if(Number.isInteger(data.position))$('entryPosition').value=data.position;
   status.textContent=data.message+' Provider check stored: '+data.checkId+'. '+(data.position?'Google Position filled. Save Ranking creates a manual entry; the provider record stays protected.':'No manual position was changed.');
  }catch(e){if(current())status.textContent=e.message;}finally{running=false;button.disabled=!canWrite();}
 };
})();