document.getElementById('dismiss').onclick=()=>window.dragonDesktop?.dismissNotice().catch(()=>{});
window.dragonDesktop?.onNotice(()=>{
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const bubble=document.querySelector('.bubble');bubble.getAnimations().forEach(a=>a.cancel());
  bubble.animate([{opacity:0,transform:'translateY(4px) scale(.96)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:280,easing:'ease-out'});
});
