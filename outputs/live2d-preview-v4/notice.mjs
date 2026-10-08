import {createPresentationWatcher} from './view-presentation.mjs';
const open=document.getElementById('open-question'),status=document.getElementById('open-status');
let opening=false;
const defaultHint='点我去 Codex 回答 ♡';
const failureHint=result=>{
  if(['missing_thread','missing_thread_id','invalid_thread','unavailable_thread'].includes(result?.reason))return '这条提醒没有会话地址，请回 Codex 查看 ♡';
  if(['no_notice','expired_notice','notice_expired'].includes(result?.reason))return '这条提醒已结束，请回 Codex 查看 ♡';
  if(['rate_limited','busy'].includes(result?.reason))return '稍等一下，再点我试试 ♡';
  return '暂时没能打开，点我重试或回 Codex 查看 ♡';
};
open.onclick=async()=>{
  if(opening)return;
  opening=true;open.disabled=true;open.setAttribute('aria-busy','true');status.textContent='正在带你去 Codex…';
  try{
    const result=await window.dragonDesktop?.openQuestion();
    status.textContent=result?.opened===true?'已前往对应聊天 ♡':failureHint(result);
    window.noticeEvidence={opening:false,opened:result?.opened===true,reason:result?.reason??null};
  }catch{
    status.textContent=failureHint();window.noticeEvidence={opening:false,opened:false,reason:'open_failed'};
  }finally{opening=false;open.disabled=false;open.removeAttribute('aria-busy');}
};
document.getElementById('dismiss').onclick=event=>{event.stopPropagation();window.dragonDesktop?.dismissNotice().catch(()=>{});};
function applyView(view){
  if(typeof view?.mirrored==='boolean')document.body.classList.toggle('mirrored',view.mirrored);
}
const presentation=createPresentationWatcher({onChange:applyView});
window.addEventListener('beforeunload',()=>presentation.dispose());
window.dragonDesktop?.onNotice(()=>{
  if(!opening)status.textContent=defaultHint;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const bubble=document.querySelector('.bubble');bubble.getAnimations().forEach(a=>a.cancel());
  bubble.animate([{opacity:0,transform:'translateY(4px) scale(.96)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:280,easing:'ease-out'});
});
