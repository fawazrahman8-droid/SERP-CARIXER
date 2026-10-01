(()=>{
 const panel=document.createElement('div');panel.className='panel';
 panel.innerHTML='<h3>Google ranking check</h3><p class="hint">SerpApi · English · Desktop. UAE uses Dubai. Up to 10 pages and 2 retries per check. Maximum 30 checks per company daily, one per minute. Provider results are stored separately from manual entries.</p><button class="btn primary" type="button">Find ranking</button><p role="status" aria-live="polite"></p>';
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
  running=true;button.disabled=true;status.textContent='Checking Google — up to 90 seconds…';
  try{
   const {data,error}=await db.functions.invoke('serp-ranking',{body:{company_id:company,keyword_id:keyword.id,market_id:market.id}});
   if(error){let message='Ranking check failed. Please try later.';try{message=(await error.context.json()).error||message;}catch{}throw Error(message);}
   if(ticket!==generation||company!==activeAccount||!user)return;
   if($('entryKeyword').value!==keyword.keyword||$('entryCountry').value!==market.name||$('entryDate').value!==date){status.textContent='Selection changed. The provider check was recorded; run another check for this selection.';return;}
   if(Number.isInteger(data.position))$('entryPosition').value=data.position;
   status.textContent=data.message+' Provider check stored: '+data.checkId+'. '+(data.position?'Google Position filled. Save Ranking creates a manual entry; the original provider record stays protected.':'No manual position was changed.');
  }catch(e){if(ticket===generation&&user)status.textContent=e.message;}finally{running=false;button.disabled=!canWrite();}
 };
})();