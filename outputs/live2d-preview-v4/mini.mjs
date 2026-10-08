import {bindPetDrag} from './pet-drag.mjs';
import {createPresentationWatcher} from './view-presentation.mjs';
import {pickBubbleTask,bubbleOperation,validAssistantActivity} from './task-bubble-state.mjs';
const $=id=>document.getElementById(id),card=$('card');
const TERMINAL_EVENTS=new Set(['Stop','Interrupt','SessionEnd']);
const BAD_CONNECTIONS=new Set(['expired','unavailable','task_unknown','unknown','error']);
let busy=false,mirrored=false,chosen=null,currentKey='',canPop=false,connected=false,lastState={};
let popTimer=null,popKey='',popIdentity='',manualIdentity='',hiddenIdentity='',lastIdentity='',popCount=0;
let lastAssistantId='',openingTask=false;
let jumpTaskId='',jumpUntil=0,jumpTimer=null,jumpSequence=0;
const JUMP_RETURN_MS=6500;
let feedbackText='',feedbackUntil=0;
const dismissed=new Set();

// The original cloud is cut into real, separately moving SVG fragments. Each
// clip polygon remains in the 168 × 66 artwork coordinates at every scale.
const pieces=[
  ['0,0 47,0 42,28 0,32',25,19,-9,-5,-18],
  ['47,0 81,0 86,24 63,36 42,28',64,17,-3,-8,14],
  ['81,0 120,0 125,26 102,35 86,24',103,17,4,-7,-15],
  ['120,0 168,0 168,34 145,38 125,26',145,21,9,-4,18],
  ['0,32 42,28 63,36 56,66 0,66',30,45,-9,6,16],
  ['63,36 86,24 102,35 105,66 56,66',80,44,-2,7,-13],
  ['102,35 125,26 145,38 142,66 105,66',122,45,5,7,15],
  ['145,38 168,34 168,66 142,66',153,47,9,4,-20]
];
const ns='http://www.w3.org/2000/svg',defs=$('thoughtCloud').querySelector('defs');
pieces.forEach(([points,x,y,dx,dy,rotation],i)=>{
  const clip=document.createElementNS(ns,'clipPath'),polygon=document.createElementNS(ns,'polygon');
  clip.id=`cloudPiece${i}`;polygon.setAttribute('points',points);clip.append(polygon);defs.append(clip);
  const fragment=document.createElementNS(ns,'g'),clipped=document.createElementNS(ns,'g');
  fragment.setAttribute('class','cloudShard');clipped.setAttribute('clip-path',`url(#${clip.id})`);
  fragment.style.cssText=`--ox:${x}px;--oy:${y}px;--dx:${dx}px;--dy:${dy}px;--r:${rotation}deg`;
  const artwork=$('cloudArtwork').cloneNode(true);artwork.removeAttribute('id');
  artwork.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
  clipped.append(artwork);fragment.append(clipped);$('cloudShards').append(fragment);
});

function applyView(view){
  if(typeof view?.mirrored!=='boolean')return;
  mirrored=view.mirrored;card.classList.toggle('mirrored',mirrored);updateEvidence();
}
const presentation=createPresentationWatcher({onChange:applyView});
window.addEventListener('beforeunload',()=>presentation.dispose());

function completionIdentity(task){
  if(typeof task?.id!=='string'||!task.id||!TERMINAL_EVENTS.has(task.terminalEvent))return '';
  // Duplicate terminal hooks cannot unlock another pop for the same turn.
  return `${task.id}:${task.turn||`session-${task.updatedAt}`}:${task.assistantActivity?.id||''}`;
}
function completionKey(task,state,now=Date.now()){
  if(!task||task.active!==false||task.stale===true||state.taskKnown===false
    ||BAD_CONNECTIONS.has(state.connection)||!TERMINAL_EVENTS.has(task.terminalEvent)
    ||!Number.isFinite(task.expiresAt)||task.expiresAt<=now
    ||!Number.isFinite(task.updatedAt)||task.updatedAt>now+60000
    ||typeof task.id!=='string'||!task.id)return '';
  return completionIdentity(task);
}
function updateEvidence(extra={}){
  window.miniEvidence={...window.miniEvidence,connected,mirrored,layout:'thought-cloud-v0414',
    taskId:chosen?.id??null,followSession:lastState.followSession||'',
    operation:$('operation').textContent,active:chosen?.active===true,canPop,
    popping:!!popKey,dismissed:card.dataset.dismissed==='true',popCount,
    assistantKind:validAssistantActivity(chosen?.assistantActivity)?chosen.assistantActivity.kind:null,
    canOpenThread:typeof chosen?.threadId==='string',...extra};
  window.miniEvidence.jumpTaskId=jumpTaskId||null;
  window.miniEvidence.jumpUntil=jumpUntil;
  $('pop').hidden=!canPop;
}
function setDismissed(value){
  const next=value?'true':'false';
  if(card.dataset.dismissed===next)return;
  card.dataset.dismissed=next;
  // Optional host support releases this transparent window's mouse hit area.
  // This is temporary presentation state, never the saved panel preference.
  window.dragonDesktop?.bubbleVisibility?.(!value).catch(()=>{});
}
function cancelPop(){
  clearTimeout(popTimer);popTimer=null;popKey='';popIdentity='';card.classList.remove('popping','reduced-pop');
}
function cancelJump(){
  // Cancelling temporary concealment must not cancel a click's navigation.
  clearTimeout(jumpTimer);jumpTimer=null;jumpTaskId='';jumpUntil=0;
}
function showBubble(){
  cancelJump();cancelPop();manualIdentity=lastIdentity;hiddenIdentity='';setDismissed(false);
  canPop=!!currentKey&&completionKey(chosen,lastState)===currentKey&&!dismissed.has(currentKey);card.classList.toggle('completed',canPop);updateEvidence();
}
window.dragonDesktop?.onAction?.(action=>{if(action==='bubble:show')showBubble();});

bindPetDrag(card);
// Browser-only preview also guards drags; native bindPetDrag suppresses them
// first in Electron. A motion across the 4 px threshold must never pop a cloud.
let pointerStart=null,dragged=false,suppressUntil=0;
card.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.target.closest('button'))return;
  pointerStart={id:event.pointerId,x:event.screenX,y:event.screenY};dragged=false;
});
card.addEventListener('pointermove',event=>{
  if(pointerStart?.id===event.pointerId&&Math.hypot(event.screenX-pointerStart.x,event.screenY-pointerStart.y)>4)dragged=true;
});
for(const type of ['pointerup','pointercancel'])card.addEventListener(type,event=>{
  if(pointerStart?.id!==event.pointerId)return;
  if(dragged||type==='pointercancel')suppressUntil=performance.now()+500;
  pointerStart=null;
});
window.addEventListener('blur',()=>{pointerStart=null;suppressUntil=performance.now()+500;});
function popBubble(event){
  if(event.button!==undefined&&event.button!==0||performance.now()<suppressUntil||popKey
    ||!canPop||!currentKey||completionKey(chosen,lastState)!==currentKey||dismissed.has(currentKey))return;
  popKey=currentKey;popIdentity=lastIdentity;popCount++;canPop=false;card.classList.remove('completed');card.classList.add('popping');
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  card.classList.toggle('reduced-pop',reduce);updateEvidence();
  popTimer=setTimeout(()=>{
    if(popIdentity!==lastIdentity||chosen?.active===true){cancelPop();updateEvidence();return;}
    dismissed.add(popKey);if(dismissed.size>64)dismissed.delete(dismissed.values().next().value);
    hiddenIdentity=popIdentity;manualIdentity='';setDismissed(true);cancelPop();updateEvidence();
  },reduce?150:560);
}
$('pop').addEventListener('click',event=>{event.stopPropagation();popBubble(event);});
async function openCurrentTask(){
  if(openingTask||popKey||performance.now()<suppressUntil)return;
  const failed=()=>{feedbackText='这条提示请在 Codex 查看';feedbackUntil=Date.now()+3000;$('operation').textContent=feedbackText;$('operation').title=feedbackText;updateEvidence({lastOpenResult:'unavailable'});};
  if(!window.dragonDesktop?.openTask||!chosen?.id){failed();return;}
  const taskId=chosen.id,sequence=++jumpSequence;
  jumpTaskId=taskId;jumpUntil=Date.now()+JUMP_RETURN_MS;
  popKey=`jump:${taskId}:${sequence}`;popIdentity=lastIdentity;popCount++;canPop=false;
  card.classList.remove('completed');card.classList.add('popping');
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  card.classList.toggle('reduced-pop',reduce);updateEvidence();
  openingTask=true;
  try{
    await new Promise(resolve=>setTimeout(resolve,reduce?150:560));
    if(sequence!==jumpSequence)return;
    if(jumpTaskId===taskId){hiddenIdentity=popIdentity;manualIdentity='';setDismissed(true);cancelPop();updateEvidence();}
    // Preserve the clicked identity across the animation, even if another
    // conversation emits a newer update before the native navigation runs.
    const result=await window.dragonDesktop.openTask(taskId);
    if(sequence!==jumpSequence)return;
    if(result?.opened===true){
      feedbackUntil=0;updateEvidence({lastOpenResult:'opened'});
      if(jumpTaskId===taskId)jumpTimer=setTimeout(()=>{jumpTimer=null;refresh();},Math.max(0,jumpUntil-Date.now()));
    }else if(chosen?.id===taskId){showBubble();failed();}
  }
  catch{if(sequence===jumpSequence&&chosen?.id===taskId){showBubble();failed();}}
  finally{openingTask=false;}
}
card.addEventListener('click',event=>{if(!event.target.closest('button')&&event.button===0)openCurrentTask();});
card.addEventListener('keydown',event=>{if(event.target===card&&['Enter',' '].includes(event.key)){event.preventDefault();openCurrentTask();}});
$('collapse').onclick=()=>window.dragonDesktop?.panel('hide');

async function refresh(){
  if(busy)return;busy=true;
  try {
    const response=await fetch('/api/companion-state',{cache:'no-store'});if(!response.ok)throw new Error('unavailable');
    const state=await response.json(),tasks=state.tasks||[];lastState=state;
    chosen=pickBubbleTask(state);
    connected=true;presentation.fromBridge(state.presentationView);
    const identity=chosen?`${chosen.id}:${chosen.turn||'session'}`:'';
    const nextKey=completionIdentity(chosen),eligibleKey=completionKey(chosen,state);
    const assistantId=validAssistantActivity(chosen?.assistantActivity)?chosen.assistantActivity.id:'';
    const freshMessage=!!assistantId&&assistantId!==lastAssistantId;
    if(jumpTaskId&&chosen&&chosen.id!==jumpTaskId)cancelJump();
    const jumpHeld=!!jumpTaskId&&(!chosen||chosen.id===jumpTaskId)&&
      (Date.now()<jumpUntil||chosen?.active!==true||chosen.stale===true||!Number.isFinite(chosen?.expiresAt)||chosen.expiresAt<=Date.now()||BAD_CONNECTIONS.has(state.connection));
    if(jumpTaskId&&!jumpHeld)cancelJump();
    if(!jumpHeld&&(identity&&identity!==lastIdentity||chosen?.active===true||freshMessage)){
      cancelPop();manualIdentity='';hiddenIdentity='';setDismissed(false);
    }
    if(freshMessage&&eligibleKey)dismissed.delete(eligibleKey);
    lastAssistantId=assistantId;
    if(identity)lastIdentity=identity;currentKey=nextKey;
    // A dropped/expired terminal record cannot resurrect an already dismissed
    // bubble. Keep it hidden until a confirmed new turn or explicit menu show.
    if(!popKey)setDismissed(jumpHeld||!!hiddenIdentity||!!currentKey&&dismissed.has(currentKey)&&manualIdentity!==identity);
    canPop=!jumpHeld&&!!eligibleKey&&!popKey&&!dismissed.has(eligibleKey);card.classList.toggle('completed',canPop);
    // Only safe operation text belongs in this bubble, never directories,
    // affection data, commands, or unfiltered hook tool arguments.
    const operation=Date.now()<feedbackUntil?feedbackText:bubbleOperation(chosen,state);
    $('operation').textContent=operation;$('operation').title=`${operation} · 点击回到这段对话`;
    card.setAttribute('aria-label',`${operation}，点击回到这段对话`);
    $('dot').classList.toggle('busy',!!chosen?.active);updateEvidence({taskCount:tasks.length});
  }catch{
    connected=false;chosen=null;currentKey='';canPop=false;cancelPop();card.classList.remove('completed');
    $('operation').textContent='连接暂时中断';$('operation').title='连接暂时中断';$('dot').classList.remove('busy');updateEvidence();
  }finally{busy=false;}
}
refresh();setInterval(refresh,750);
