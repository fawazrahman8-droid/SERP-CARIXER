const markets={INDIA:['in','India'],OMAN:['om','Oman'],UAE:['ae','Dubai,Dubai,United Arab Emirates'],'UAE / MAIN':['ae','Dubai,Dubai,United Arab Emirates'],'SAUDI ARABIA':['sa','Saudi Arabia'],BAHRAIN:['bh','Bahrain'],JORDAN:['jo','Jordan'],'UNITED STATES':['us','United States']};
async function checkRanking(input,{key='',fetchImpl=fetch,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onProgress=()=>{},now=Date.now,resume=null,onCheckpoint=async()=>{}}={}){
 const keyword=String(input.keyword||'').trim(),domain=String(input.domain||'').toLowerCase(),market=String(input.market||'').trim();
 if(!keyword||keyword.length>200)throw Error('Select a keyword of 1–200 characters.');
 if(!['carwashtrolley.com','ecowide.com'].includes(domain))throw Error('Select a supported company.');
 const settings=markets[market.toUpperCase()];if(!settings)throw Error('Unsupported market for this trial. Try India, Oman, UAE, Saudi Arabia, Bahrain, Jordan or United States.');
 if(!key?.trim())throw Error('SerpApi key is missing. Start START-SERPAPI-TRIAL.cmd from the same PowerShell window where you entered the key.');
 const url=new URL('https://serpapi.com/search.json');url.search=new URLSearchParams({engine:'google',q:keyword,google_domain:'google.com',gl:settings[0],location:settings[1],hl:'en',device:'desktop',start:'0',api_key:key.trim()}).toString();
 const validResume=resume&&resume.keyword===keyword&&resume.domain===domain&&resume.market===market&&now()-resume.startedAt<300000&&Number.isInteger(resume.page)&&resume.page>=1&&resume.page<=10&&Number.isInteger(resume.start)&&resume.start>=0&&resume.start<=1000;
 const startedAt=validResume?resume.startedAt:now();
 const deadline=now()+90000; const allResults=validResume?[...resume.results]:[];let start=validResume?resume.start:0,retries=0;
 for(let page=validResume?resume.page:1;page<=10;page++){
 await onCheckpoint({keyword,domain,market,startedAt,page,start,results:allResults});
 url.searchParams.set('start',String(start));
 let response;try{
  while(true){
   if(now()>=deadline)throw Object.assign(new Error('Time limit'),{name:'TimeoutError'});
   onProgress({page,retries,message:'Checking page '+page+' of 10'+(retries?' (retry '+retries+')':'')+'…'});
   response=await fetchImpl(url,{signal:AbortSignal.timeout(Math.max(1,Math.min(30000,deadline-now()))),redirect:'error'});
   if(![502,503,504].includes(response.status)||retries>=2)break;
   await response.body?.cancel();
   retries++;await wait(retries*3000);
  }
 }catch(e){
  const timedOut=['TimeoutError','AbortError'].includes(e.name)||['UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(e.cause?.code);
  throw Error((timedOut?'SerpApi timed out while checking page '+page+'.':'Connection to SerpApi failed while checking page '+page+'.')+' Search stopped; no ranking was assigned. '+(timedOut?'Please try again later.':'Check your internet connection and whether SerpApi is reachable.'));
 }
 if(!response.ok)throw Error(response.status===401?'SerpApi rejected the API key. Check the key in your PowerShell window.':response.status===429?'SerpApi quota or rate limit reached. Check your SerpApi dashboard.':[502,503,504].includes(response.status)?'SerpApi is temporarily unavailable (HTTP '+response.status+') on page '+page+' after limited retries. Search incomplete; no ranking assigned. Please try again later.':'SerpApi request failed (HTTP '+response.status+').');
 let data;try{data=await response.json();}catch{throw Error('SerpApi returned an unreadable response.');}
 if(data.error||data.search_metadata?.status!=='Success')throw Error('SerpApi did not complete this search. Check your provider dashboard for details.');
 const normalize=value=>String(value).trim().replace(/\s+/g,' ').toLowerCase();
 const returnedQuery=data.search_parameters?.q,displayedQuery=data.search_information?.query_displayed;
 if((returnedQuery&&normalize(returnedQuery)!==normalize(keyword))||(displayedQuery&&normalize(displayedQuery)!==normalize(keyword)))throw Error('Search query mismatch on page '+page+'. Requested "'+keyword+'", provider returned "'+String(displayedQuery||returnedQuery).slice(0,200)+'". Search stopped; no ranking assigned.');
 const resultState=data.search_information?.organic_results_state||'';
 if(/fixed spelling/i.test(resultState))throw Error('Google substituted corrected search results on page '+page+'. Search stopped; no ranking assigned for the original keyword.');
 if(!Array.isArray(data.organic_results)||!data.organic_results.length)throw Error('No organic results returned for this search. No ranking has been assigned.');
 const results=data.organic_results.flatMap(r=>{try{const u=new URL(r.link);return ['https:','http:'].includes(u.protocol)&&Number.isInteger(r.position)&&r.position>0?[{title:String(r.title||''),url:u.href,position:start+r.position}]:[];}catch{return [];}}).sort((a,b)=>a.position-b.position);
 if(!results.length)throw Error('Provider results did not contain usable organic positions.');
 allResults.push(...results);
 const match=results.find(r=>{const h=new URL(r.url).hostname;return h===domain||h.endsWith('.'+domain);});
 const result={keyword,domain,market,status:'done',position:match?.position??null,results:allResults,pagesChecked:page,searchSettings:{query:returnedQuery||keyword,displayedQuery:displayedQuery||null,location:data.search_parameters?.location_used||data.search_parameters?.location_requested||settings[1],language:'en',device:'desktop'},checkedAt:data.search_metadata?.processed_at||null,searchId:data.search_metadata?.id||null};
 if(match)return {...result,message:'Organic position: '+match.position+'. Found after '+page+' page(s).'};
 const next=data.serpapi_pagination?.next||data.serpapi_pagination?.next_link;
 if(!next)return {...result,message:'Not found among '+allResults.length+' results across '+page+' page(s). Google supplied no further page.'};
 if(page===10)return {...result,message:'Not found after the 10-page limit ('+allResults.length+' returned results). Search stopped to limit API usage.'};
 let offset;try{const nextURL=new URL(next);const value=nextURL.searchParams.get('start');offset=value===null?NaN:Number(value);}catch{offset=NaN;}
 if(!Number.isInteger(offset)||offset<=start||offset>1000)throw Error('Provider pagination could not advance safely. No ranking assigned.');
 start=offset;
 }
}
export {checkRanking};

