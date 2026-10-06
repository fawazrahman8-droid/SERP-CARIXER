(()=>{
 const root=document.querySelector('.auth-showcase'),track=document.querySelector('.brand-track');if(!root||!track)return;
 const slides=[...root.querySelectorAll('.brand-slide')],dots=[...root.querySelectorAll('[data-brand-slide]')],motion=window.matchMedia('(prefers-reduced-motion: reduce)');
 let index=0,timer=null,paused=motion.matches,lastIndex=-1,direction=1;
 function render(){if(index!==lastIndex){slides.forEach((slide,i)=>{slide.classList.remove("is-active","slide-in-right","slide-out-right","slide-in-left","slide-out-left");if(i===index){slide.classList.add("is-active");if(lastIndex>=0&&!motion.matches)slide.classList.add(direction>0?"slide-in-right":"slide-in-left");}else if(i===lastIndex&&!motion.matches)slide.classList.add(direction>0?"slide-out-right":"slide-out-left");});lastIndex=index;}slides.forEach((slide,i)=>{slide.setAttribute('aria-hidden',String(i!==index));slide.inert=i!==index;});dots.forEach((dot,i)=>dot.setAttribute('aria-current',String(i===index)));document.getElementById('brandCounter').textContent=String(index+1).padStart(2,'0')+' / 04';const pause=document.getElementById('pauseBrands');pause.textContent=paused?'▶':'Ⅱ';pause.setAttribute('aria-label',paused?'Play brand slideshow':'Pause brand slideshow');pause.setAttribute('aria-pressed',String(paused));}
 function schedule(){clearInterval(timer);if(!paused&&!document.hidden)timer=setInterval(()=>{if(document.getElementById('authScreen').hidden)return;direction=1;index=(index+1)%slides.length;render();},5500);}
 function go(next){direction=next<index?-1:1;index=(next+slides.length)%slides.length;render();schedule();}
 dots.forEach((dot,i)=>dot.onclick=()=>go(i));document.getElementById('previousBrand').onclick=()=>go(index-1);document.getElementById('nextBrand').onclick=()=>go(index+1);
 document.getElementById('pauseBrands').onclick=()=>{paused=!paused;render();schedule();};
 root.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();go(index+(e.key==='ArrowRight'?1:-1));}});
 document.addEventListener('visibilitychange',schedule);motion.addEventListener('change',()=>{paused=motion.matches;render();schedule();});render();schedule();
})();

