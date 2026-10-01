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
  const startedAt=new Date().toISOString(),callerId=user.id;
  running=true;button.disabled=true;status.textContent='Checking Google — up to 90 seconds…';
  try{
   let {data,error}=await db.functions.invoke('serp-ranking',{body:{company_id:company,keyword_id:keyword.id,market_id:market.id}});
   if(error&&!error.context){
    status.textContent='The connection ended while Google was being checked. Retrieving the saved result…';
    for(let attempt=0;attempt<20;attempt++){
     if(ticket!==generation||!user)return;
     const saved=await db.from('provider_checks').select('id,result').eq('company_id',company).eq('requested_by',callerId).eq('keyword_id',keyword.id).eq('market_id',market.id).gte('created_at',startedAt).order('created_at',{ascending:false}).limit(1).maybeSingle();
     if(saved.error)break;
     if(saved.data?.result){if(saved.data.result.status==='error')throw Error(saved.data.result.message);data={...saved.data.result,checkId:saved.data.id};error=null;break;}
     await new Promise(resolve=>setTimeout(resolve,4000));
    }
   }
   if(error){let message='Could not retrieve the completed check. Please try later.';try{message=(await error.context.json()).error||message;}catch{}throw Error(message);}
   if(ticket!==generation||company!==activeAccount||!user)return;
   if($('entryKeyword').value!==keyword.keyword||$('entryCountry').value!==market.name||$('entryDate').value!==date){status.textContent='Selection changed. The provider check was recorded; run another check for this selection.';return;}
   if(Number.isInteger(data.position))$('entryPosition').value=data.position;
   status.textContent=data.message+' Provider check stored: '+data.checkId+'. '+(data.position?'Google Position filled. Save Ranking creates a manual entry; the original provider record stays protected.':'No manual position was changed.');
  }catch(e){if(ticket===generation&&user)status.textContent=e.message;}finally{running=false;button.disabled=!canWrite();}
 };
})();