(()=>{
 const key='serp-track-theme',root=document.documentElement;
 let mode='light';try{const saved=localStorage.getItem(key);if(saved==='dark'||saved==='light')mode=saved;}catch{}
 root.dataset.theme=mode;
 const apply=()=>{
  root.dataset.theme=mode;
  if(window.Chart){Chart.defaults.color=mode==='dark'?'#cbd5e1':'#64748b';Chart.defaults.borderColor=mode==='dark'?'#334155':'#e5e9f2';}
  document.querySelectorAll('[data-theme-toggle]').forEach(button=>{
   button.textContent=mode==='dark'?'☀ Light mode':'☾ Dark mode';
   button.setAttribute('aria-label',mode==='dark'?'Switch to light mode':'Switch to dark mode');
   button.setAttribute('aria-pressed',String(mode==='dark'));
  });
 };
 document.addEventListener('DOMContentLoaded',()=>{
  for(const target of [document.querySelector('.top .actions'),document.querySelector('.auth-card')]){
   if(!target)continue;const button=document.createElement('button');button.type='button';button.className='btn theme-toggle';button.dataset.themeToggle='';
   button.onclick=()=>{mode=mode==='dark'?'light':'dark';try{localStorage.setItem(key,mode);}catch{}apply();if(typeof ready!=='undefined'&&ready&&typeof renderActivePage==='function')renderActivePage();};
   target.append(button);
  }
  apply();
 });
})();
