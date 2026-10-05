let activeAccount=null;
let state={rows:[],sheets:[],keywords:[],markets:[]};
let monthChart,historyChart,reportChart,rankDonut;
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];

function toast(t,kind){let x=document.getElementById('toast');x.textContent=t;x.classList.toggle('ranking-warning-toast',kind==='warning');x.classList.add('show');setTimeout(()=>x.classList.remove('show'),2500)}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function num(v){if(v===null||v===undefined||v==='')return null; if(typeof v==='number')return isFinite(v)?v:null; let s=String(v).trim().toLowerCase(); if(['na','n/a','-','—','new','not found','>100'].includes(s))return s==='>100'?101:null; let n=parseFloat(s.replace(/,/g,'')); return isFinite(n)?n:null}
function dateISO(v){
  if(v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
  if(typeof v==='number'){let d=XLSX.SSF.parse_date_code(v); if(d)return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`}
  let s=String(v||'').trim(); if(!s)return null;
  let d=new Date(s); if(!isNaN(d))return d.toISOString().slice(0,10);
  let m=s.match(/^(\\d{1,2})[\\/.-](\\d{1,2})[\\/.-](\\d{4})$/); if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}
function monthOf(d){return d?d.slice(0,7):''}
function countryName(sheet){
  let s=sheet.toLowerCase();
  const map=[['saudi','Saudi Arabia'],['india','India'],['oman','Oman'],['jordan','Jordan'],['bahrain','Bahrain'],['azerbaijan','Azerbaijan'],['us','United States'],['usa','United States']];
  for(const [k,v] of map)if(s.includes(k))return v;
  return 'UAE / Main';
}
function rebuildFilters(opts={}){
  const rows=state.rows.filter(r=>r.date!=='2099-12-31');
  // Keep a separate market registry so Manual Entry always has the markets
  // even when a newly created keyword has no ranking rows yet.
  if(!Array.isArray(state.markets)) state.markets=[];
  rows.forEach(r=>{if(r.country&&!state.markets.includes(r.country))state.markets.push(r.country)});
  state.markets=[...new Set(state.markets)].sort();
  const countries=state.markets;
  const kws=allKeywords();
  const dates=[...new Set(rows.map(r=>r.date))].sort();
  const ym=[...new Set(rows.map(r=>r.date.slice(0,7)))].sort().reverse();
  fillSelect('rankMonth',ym.map(x=>[x,x]),true);fillSelect('reportMonth',ym.map(x=>[x,x]),true);fillSelect('dashMonth',ym.map(x=>[x,x]),true);
  fillSelect('rankCountry',countries.map(x=>[x,x]),true);fillSelect('reportCountry',countries.map(x=>[x,x]),true);fillSelect('dashCountry',countries.map(x=>[x,x]),true);
  fillSelect('histCountry',countries.map(x=>[x,x]),true);fillSelect('histKeyword',kws.map(x=>[x,x]),false);fillSelect('entryKeyword',kws.map(x=>[x,x]),false);fillSelect('entryCountry',countries.map(x=>[x,x]),false);fillSelect('keywordMarket',countries.map(x=>[x,x]),false);
  ['rankMonth','reportMonth','dashMonth'].forEach(id=>{let el=document.getElementById(id);if(el&&ym.length&&!el.value)el.value=ym[0]});
  ['rankCountry','reportCountry','dashCountry','histCountry'].forEach(id=>{let el=document.getElementById(id);if(el&&(!el.value||![...el.options].some(o=>o.value===el.value)))el.value='ALL'});
  if(document.getElementById('entryCountry')&&countries.length&&!document.getElementById('entryCountry').value)document.getElementById('entryCountry').value=countries[0];
  refreshEntryKeywords();
  renderActivePage();
}
function fillSelect(id,items,all){
  const el=document.getElementById(id);if(!el)return; const old=el.value;el.innerHTML=(all?'<option value="ALL">All</option>':'')+items.map(x=>`<option value="${esc(x[0])}">${esc(x[1])}</option>`).join('');
  if([...el.options].some(o=>o.value===old))el.value=old;
}
function filtered(opts={}){
  return state.rows.filter(r=>r.date!=='2099-12-31').filter(r=>
    (!opts.month||opts.month==='ALL'||r.date.startsWith(opts.month)) &&
    (!opts.country||opts.country==='ALL'||r.country===opts.country) &&
    (!opts.keyword||opts.keyword==='ALL'||r.keyword===opts.keyword) &&
    (!opts.date||opts.date==='ALL'||r.date===opts.date)
  );
}
function avg(a){let x=a.filter(v=>v!==null);return x.length?x.reduce((p,c)=>p+c,0)/x.length:null}
function fmtPos(n){return n===null?'—':(Number.isInteger(n)?n:n.toFixed(1))}
function delta(start,end){if(start===null||end===null)return null;return +(start-end).toFixed(1)}
function deltaHTML(d){if(d===null)return '<span class="flat">—</span>';if(d>0)return `<span class="up">▲ ${d}</span>`;if(d<0)return `<span class="down">▼ ${Math.abs(d)}</span>`;return '<span class="flat">— 0</span>'}
function monthlyRows(month,country){
 const grouped=new Map();
 for(const r of filtered({month,country})){const key=JSON.stringify([r.keyword,r.country]);let item=grouped.get(key);if(!item){item={name:r.keyword,market:r.country,rows:[]};grouped.set(key,item);}item.rows.push(r);}
 for(const k of state.keywords){if(country&&country!=='ALL'&&k.market!==country)continue;const key=JSON.stringify([k.name,k.market]);if(!grouped.has(key)&&(!month||month==='ALL'||k.addedAt.slice(0,7)<=month))grouped.set(key,{name:k.name,market:k.market,rows:[]});}
 return [...grouped.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.market.localeCompare(b.market)).map(k=>{const rows=k.rows.sort((a,b)=>a.date.localeCompare(b.date));return {keyword:k.name+(!country||country==='ALL'?' · '+(k.market||'Unassigned'):''),start:rows[0]?.position??null,end:rows.at(-1)?.position??null,rows};});
}
function updateRankDonut(month,country){
  const rr=monthlyRows(month,country);
  const cats={"Top 1":0,"Top 10":0,"Top 100":0,"Not Ranked":0};
  rr.forEach(x=>{const p=x.end; if(p===1)cats["Top 1"]++; else if(p!==null&&p>=2&&p<=10)cats["Top 10"]++; else if(p!==null&&p>=11&&p<=100)cats["Top 100"]++; else cats["Not Ranked"]++;});
  const labels=Object.keys(cats), vals=labels.map(k=>cats[k]), total=vals.reduce((a,b)=>a+b,0);
  document.getElementById('donutTotal').textContent=total;
  document.getElementById('donutScope').textContent=(month?month:'All months')+' · '+(country==='ALL'?'All countries':country);
  if(rankDonut)rankDonut.destroy();
  rankDonut=new SafeChart(document.getElementById('rankDonut'),{type:'doughnut',data:{labels,datasets:[{data:vals,backgroundColor:['#16a34a','#2563eb','#d97706','#475569'],borderColor:'#fff',borderWidth:3,hoverOffset:7}]},options:{cutout:'68%',plugins:{legend:{display:false},tooltip:{callbacks:{label:(ctx)=>{const v=ctx.raw||0;const pct=total?(v/total*100).toFixed(1):0;return ` ${ctx.label}: ${v} (${pct}%)`;}}}}}});
  document.getElementById('donutLegend').innerHTML=labels.map((l,i)=>{const pct=total?(vals[i]/total*100).toFixed(1):0;const colors=['#16a34a','#2563eb','#d97706','#475569'];return `<div class="legend-row"><span class="legend-dot" style="background:${colors[i]}"></span><span>${l}</span><b>${vals[i]} <small style="color:var(--muted);font-weight:500">(${pct}%)</small></b></div>`}).join('');
}
function updateDashboard(){
  const rs=state.rows.filter(r=>r.date!=='2099-12-31'), countries=[...new Set([...(state.markets||[]),...rs.map(r=>r.country)])];
  document.getElementById('mKeywords').textContent=(state.keywords||[]).length;
  document.getElementById('mCountries').textContent=countries.length;
  document.getElementById('mEntries').textContent=rs.length.toLocaleString();
  let top=rs.filter(r=>r.position!==null);document.getElementById('mTop10').textContent=top.length?(top.filter(r=>r.position<=10).length/top.length*100).toFixed(1)+'%':'—';
  document.getElementById('dataStatus').textContent=rs.length?`${rs.length.toLocaleString()} observations`:'No data';
  let months=[...new Set(rs.map(r=>r.date.slice(0,7)))].sort();
  const totals=new Map();for(const r of rs){const m=r.date.slice(0,7),v=totals.get(m)||[0,0];if(r.position!==null){v[0]+=r.position;v[1]++;}totals.set(m,v);}let vals=months.map(m=>{const v=totals.get(m);return v[1]?v[0]/v[1]:null;});
  if(monthChart)monthChart.destroy();
  monthChart=new SafeChart(document.getElementById('monthChart'),{type:'line',data:{labels:months,datasets:[{label:'Average position',data:vals,borderWidth:2,tension:.25,pointRadius:3}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{reverse:true,title:{display:true,text:'Position'}},x:{grid:{display:false}}}}});
  let latest=rs.reduce((latest,r)=>!latest||r.date>latest.date?r:latest,null);
  document.getElementById('latestSnapshot').innerHTML=latest?`<b>${esc(latest.date)}</b><br>${esc(latest.country)}<br><br>Latest recorded keyword: <b>${esc(latest.keyword)}</b><br>Position: <b>${displayPosition(latest.position,latest.date)}</b>`:'No rankings yet. Import a workbook or add a manual ranking.';
  const m=document.getElementById('dashMonth').value||months.at(-1)||'';
  const c=document.getElementById('dashCountry').value||'ALL';updateDashStats(m,c);updateRankDonut(m,c);
}
function updateDashStats(m,c){
  let rr=monthlyRows(m,c), valid=rr.filter(x=>x.start!==null||x.end!==null), improved=rr.filter(x=>x.start!==null&&x.end!==null&&x.end<x.start).length;
  document.getElementById('dashReportStats').innerHTML=`
  <div class="item"><span>Tracked keywords</span><b>${valid.length}</b></div>
  <div class="item"><span>Improved during month</span><b>${improved}</b></div>
  <div class="item"><span>Avg end position</span><b>${fmtPos(avg(valid.map(x=>x.end)))}</b></div>`;
}

function renderReport(){
  let m=document.getElementById('reportMonth').value,c=document.getElementById('reportCountry').value;
  const dateLabel=document.getElementById('reportDateLabel'),countryLabel=document.getElementById('reportCountryLabel');
  if(dateLabel)dateLabel.textContent=m&&m!=='ALL'?new Date(m+'-01T00:00:00').toLocaleString('en-US',{month:'long',year:'numeric'}):'—';
  if(countryLabel)countryLabel.textContent=c==='ALL'||!c?'All Countries / Markets':c;
  let rr=monthlyRows(m,c),valid=rr.filter(x=>x.start!==null||x.end!==null),im=rr.filter(x=>x.start!==null&&x.end!==null&&x.end<x.start).length,decl=rr.filter(x=>x.start!==null&&x.end!==null&&x.end>x.start).length;
  document.getElementById('reportStats').innerHTML=`
  <div class="item"><span>Keywords tracked</span><b>${valid.length}</b></div>
  <div class="item"><span>Improved / declined</span><b>${im} / ${decl}</b></div>
  <div class="item"><span>Average position</span><b>${fmtPos(avg(valid.map(x=>x.end)))}</b></div>`;
  const pageRows=pageSlice('report',rr,100,'reportBody',renderReport);
  document.getElementById('reportBody').innerHTML=pageRows.items.map((x,i)=>{const first=x.rows.find(r=>r.position!==null)||x.rows[0],last=[...x.rows].reverse().find(r=>r.position!==null)||x.rows.at(-1);return `<tr><td>${pageRows.offset+i+1}</td><td><b>${esc(x.keyword)}</b></td><td>${displayPosition(x.start,first?.date)}</td><td>${displayPosition(x.end,last?.date)}</td><td>${deltaHTML(delta(x.start,x.end))}</td><td>${x.start===null||x.end===null?'Partial':x.end<x.start?'Improved':x.end>x.start?'Declined':'Stable'}</td></tr>`;}).join('')||'<tr><td colspan="6" class="empty">No data for this month.</td></tr>';
  let rs=filtered({month:m,country:c}),days=[...new Set(rs.map(r=>r.date))].sort(),vals=dailyAverages(rs,days);
  if(reportChart)reportChart.destroy();
  reportChart=new SafeChart(document.getElementById('reportChart'),{type:'line',data:{labels:days,datasets:[{label:'Average position',data:vals,borderWidth:2,tension:.25,pointRadius:2}]},options:{scales:{y:{reverse:true,title:{display:true,text:'Position'}},x:{grid:{display:false}}}}});
}

function goToReports(){document.querySelector('[data-page="reports"]').click();document.getElementById('reportMonth').value=document.getElementById('dashMonth').value;document.getElementById('reportCountry').value=document.getElementById('dashCountry').value;renderReport()}
function rankingBucket(pos){if(pos===1)return ['Top 1','p1'];if(pos!==null&&pos>=2&&pos<=10)return ['Top 10','p10'];if(pos!==null&&pos>=11&&pos<=100)return ['Top 100','p100'];return ['Not Ranked','pna']}
function allKeywords(market){
  // Build the keyword list from BOTH the keyword registry and imported ranking rows.
  // This makes imported Excel keywords immediately available in Manual Entry even
  // if an older browser state has an incomplete keyword registry.
  const names=[];
  (state.keywords||[]).forEach(k=>{
    const name=typeof k==='string'?k:k.name;
    const km=typeof k==='string'?'':(k.market||'');
    if(name&&(!market||market==='ALL'||!km||km===market))names.push(name);
  });
  (state.rows||[]).forEach(r=>{
    if(r.keyword&&r.date!=='2099-12-31'&&(!market||market==='ALL'||!r.country||r.country===market))names.push(r.keyword);
  });
  return [...new Set(names)].sort((a,b)=>a.localeCompare(b));
}
function generateCurrentPDF(){
  if(!state.rows.length){toast('Import your Excel data first');return}
  const {jsPDF}=window.jspdf;let doc=new jsPDF('l','mm','a4');
  let m=document.getElementById('reportMonth').value||document.getElementById('dashMonth').value,c=document.getElementById('reportCountry').value||'ALL';
  if(!m){toast('Select a month first');return}
  let rr=monthlyRows(m,c),valid=rr.filter(x=>x.start!==null||x.end!==null),im=rr.filter(x=>x.start!==null&&x.end!==null&&x.end<x.start).length,decl=rr.filter(x=>x.start!==null&&x.end!==null&&x.end>x.start).length;
  let monthLabel=m==='ALL'?'All months':new Date(m+'-01').toLocaleString('en-US',{month:'long',year:'numeric'});
  doc.setFontSize(22);doc.text('SERP TRACK — '+companyLabel(),14,17);doc.setFontSize(13);doc.text('Monthly SERP Performance Report',14,25);
  doc.setFontSize(10);doc.text(`Reporting period: ${monthLabel}`,14,32);doc.text(`Market: ${c==='ALL'?'All countries':c}`,95,32);doc.text(`Generated: ${new Date().toLocaleDateString()}`,200,32);
  doc.setFontSize(10);doc.text(`Keywords tracked: ${valid.length}`,14,42);doc.text(`Improved: ${im}`,75,42);doc.text(`Declined: ${decl}`,125,42);doc.text(`Average end position: ${fmtPos(avg(valid.map(x=>x.end)))}`,190,42);
  doc.autoTable({startY:48,head:[['#','Keyword','Start position','End position','Change','Status']],body:rr.map((x,i)=>[i+1,x.keyword,fmtPos(x.start),fmtPos(x.end),delta(x.start,x.end)===null?'—':delta(x.start,x.end),x.start===null||x.end===null?'Partial':x.end<x.start?'Improved':x.end>x.start?'Declined':'Stable']),styles:{fontSize:8,cellPadding:2.2},headStyles:{fillColor:[15,23,42],textColor:255},alternateRowStyles:{fillColor:[248,250,252]},margin:{left:14,right:14}});
  let y=doc.lastAutoTable.finalY+10;if(y>175){doc.addPage();y=18}doc.setFontSize(13);doc.text('Daily average position',14,y);
  let rs=filtered({month:m,country:c}),days=[...new Set(rs.map(r=>r.date))].sort(),vals=dailyAverages(rs,days);
  if(days.length && vals.some(v=>v!==null)){doc.setFontSize(8);let max=170,min=60;doc.line(14,y+max/4,280,y+max/4);let maxv=Math.max(...vals.filter(Boolean),10),minv=Math.min(...vals.filter(Boolean),1);for(let i=1;i<days.length;i++){if(vals[i-1]===null||vals[i]===null)continue;let x1=14+(i-1)*(260/(days.length-1)),x2=14+i*(260/(days.length-1));let f=v=>y+5+(v-minv)/(Math.max(1,maxv-minv))*35;doc.line(x1,f(vals[i-1]),x2,f(vals[i]));}doc.text('Lower position number = better ranking',14,y+48)}
  doc.save(`${activeCompany().slug}-${m}-${c==='ALL'?'All-Countries':c.replace(/\\s+/g,'-')}.pdf`);toast('PDF generated');
}

// Keep password visibility a local display preference only.
(()=>{const field=document.getElementById('password'),toggle=document.getElementById('togglePassword');if(!field||!toggle)return;function setVisible(show){field.type=show?'text':'password';toggle.textContent=show?'Hide':'Show';toggle.setAttribute('aria-label',show?'Hide password':'Show password');toggle.setAttribute('aria-pressed',String(show));}toggle.addEventListener('click',()=>setVisible(field.type==='password'));document.getElementById('authForm').addEventListener('submit',()=>setVisible(false));})();

