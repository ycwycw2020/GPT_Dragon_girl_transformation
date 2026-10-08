import { CubismFramework } from './vendor/Framework/live2dcubismframework.js';
import { CubismMoc } from './vendor/Framework/model/cubismmoc.js';
import { CubismRenderer_WebGL } from './vendor/Framework/rendering/cubismrenderer_webgl.js';
import { CubismShaderManager_WebGL } from './vendor/Framework/rendering/cubismshader_webgl.js';
import { CubismMatrix44 } from './vendor/Framework/math/cubismmatrix44.js';
import { DragonCompanionController } from './controller.mjs';
import { BINDINGS, inspectBindings, applySupportedParameters, applyPresentationPolicy } from './bindings.mjs';
import { selectModelId, inputForModel, visualForState, MODEL_CATALOG } from './model-catalog.mjs';
import { inspectParameterEffects } from './model-qa.mjs';
import { bindPetDrag } from './pet-drag.mjs';
import { createAmbientMotion } from './ambient-motion.mjs';
import {createTouchInteractions,createPageTurn,createEarringBacking,pickTouch,viewTransform,sampleTouch} from './touch-interactions.mjs';
import {sourceTextureModel,restoreCutEdgeCoverage} from './source-textures.mjs';
import {createLegRepair,createChairLogoRepair} from './leg-repair.mjs';
import {createLeftEyeBlink,blinkClosure,clickBlinkClosure} from './eye-blink.mjs';
import {createIdleRig} from './idle-rig.mjs';
import {createBrowRepair} from './brow-repair.mjs';
import {createReactionController,sampleReaction,REACTIONS,unlockedReactions,AFFECTION_TARGETS,AFFECTION_TARGET_METADATA} from './affection-reactions.mjs';
import {createExtraTouchController,createExtraTouchHitTest,drawExtraTouchOverlay,sampleExtraTouch} from './extra-touch.mjs';
import {createReactionVisuals} from './reaction-visuals.mjs';
import {createPresentationWatcher,reflectClientX} from './view-presentation.mjs';

const $=id=>document.getElementById(id);
const canvas=$('canvas');
const modelId=selectModelId(new URL(location.href).searchParams.get('model'));
const petView=new URL(location.href).searchParams.get('view')==='pet';
let visualOverride=new URL(location.href).searchParams.get('auto')==='1'?null:modelId;
let activeVisual='working_thinking';const idleRigs=new Map();
if(petView){document.body.classList.add('pet');document.documentElement.classList.add('pet-root');}
if(petView)bindPetDrag(canvas);
const evidence={status:'waiting',mocLoaded:false,renderedFrames:0,nonTransparentPixels:0,
  parameterInspection:[],modelId,modelUrl:'/model/dragon-working.model3.json'};
window.dragonPreview=evidence;
function setPresentationView(value){
  evidence.presentationView=value;
  document.body.classList.toggle('mirrored',value.mirrored);
}
setPresentationView({mirrored:false,screenSide:'left',displayId:null});
const presentationWatcher=createPresentationWatcher({onChange:setPresentationView});
let paused=false,driver=new DragonCompanionController({quotaDebounceSeconds:0});
let manual=new Map();
let model, renderer, gl, moc, frameId, lastTime, inspection=[];
let bridgeInput=null,bridgeTimer;
let bridgeQuotaKnown=null;
let bridgeConnection=null;
let petBlinkStarted=null;
let speechTimer,reactionVisuals,reactionOverlay,reactionTest=null,sleepTest=null,interactionPending=false;
const reactions=createReactionController();
const reactionClock=()=>ambientTestTime??ambientTime;
const isSleeping=()=>sleepTest??(evidence.life?evidence.life.mode==='sleep_mode':evidence.bridge?.presentationMode==='sleep_mode');
let ambientMotion,ambientTime=0,ambientTestTime=null,ambientDisabled=false;
const touchController=createTouchInteractions();let pageTurn,earringBacking,legRepair,chairLogoRepair,leftEyeBlink,browRepair,touchTest=null;
const extraTouchController=createExtraTouchController();let extraHit,extraTouchTest=null;
function sceneView(){return viewTransform(evidence.bounds,canvas.getBoundingClientRect(),model.getModel().canvasinfo);}
function pointerArt(event){
  const rect=canvas.getBoundingClientRect();
  return sceneView().unproject(reflectClientX(event.clientX,rect,evidence.presentationView.mirrored),event.clientY);
}
function touchTarget(x,y){
  if(isSleeping())return null;
  if(legRepair?.hitTest(x,y))return {id:'leg',label:'轻轻碰脚尖'};
  const extra=extraHit?.pick(x,y,{state:activeVisual,
    inversePoint:(x,y)=>idleRigs.get(activeVisual)?.inversePoint(x,y)??[x,y],
    workingInverse:(id,x,y)=>ambientMotion.inversePoint(id,x,y)});
  if(extra)return extra;
  if(activeVisual!=='working_thinking')return idleRigs.get(activeVisual)?.hitTestTail?.(x,y)?{id:'tail',label:'摸摸尾巴',text:'尾巴也收到摸摸啦～'}:null;
  const target=ambientMotion?.evidence().enabled?pickTouch(id=>ambientMotion.hitTest(id,x,y)):null;
  if(target?.id==='book'&&!pageTurn?.loaded||target?.id==='earring'&&!earringBacking?.loaded)return {...target,unavailable:true};
  return target;
}
function showSpeech(text){
  if(!petView||!text)return;
  let speech=$('petSpeech');if(!speech){speech=document.createElement('div');speech.id='petSpeech';speech.setAttribute('role','status');document.body.append(speech);}
  speech.textContent=text;speech.classList.add('shown');clearTimeout(speechTimer);speechTimer=setTimeout(()=>speech.classList.remove('shown'),4000);
}
function receiveLife(value){
  evidence.life=value;
  const result=value?.result;if(!result)return;
  if(result.greeting?.text)showSpeech(result.greeting.text);
  else if(result.kind==='mode'){reactions.cancel();touchController.clear();extraTouchController.clear();showSpeech(result.mode==='sleep_mode'?(value.restControl?.message||'轻轻闭上眼，休息一下～'):'回来啦，继续陪你。');}
  else if(result.feedback==='sleepy_reaction')showSpeech('唔……让我再休息一小会儿。');
  else if(result.feedback==='petting_reaction'&&!interactionPending)showSpeech(result.xpGained?`收到摸摸～ 好感经验 +${result.xpGained}`:'我在呢～');
}
const labels={sleep_mode:'轻轻闭眼 · 休息中',working_thinking:'认真工作 · 有一点迷糊',idle_high_energy:'精神抖擞',idle_mid_energy:'略有疲惫',idle_low_energy:'非常疲惫',idle_neutral:'额度未知 · 中性待机'};

function updateInput(){
  driver.setInput(bridgeInput||inputForModel(modelId));
}
$('model').value=visualOverride??'auto';
$('model').addEventListener('change',()=>{
  visualOverride=$('model').value==='auto'?null:selectModelId($('model').value);
});
$('reload').addEventListener('click',()=>location.reload());
$('pause').addEventListener('click',()=>{paused=!paused;$('pause').textContent=paused?'继续动作':'暂停动作';});
$('reset').addEventListener('click',()=>{manual.clear();ambientTestTime=null;ambientDisabled=false;touchTest=null;extraTouchTest=null;touchController.clear();extraTouchController.clear();driver=new DragonCompanionController({quotaDebounceSeconds:0});updateInput();for(const e of document.querySelectorAll('.binding input'))e.value=inspection.find(b=>b.id===e.dataset.id).modelDefault;});
window.dragonDesktop?.onAction(action=>{
  if(action==='growth')showGrowth();
  if(action.startsWith('state:')){const next=action.slice(6);visualOverride=next==='auto'?null:selectModelId(next);$('model').value=next;}
  if(action==='pause')$('pause').click();
  if(action==='reset')$('reset').click();
  if(action==='reload')location.reload();
});
window.dragonDesktop?.onLife(receiveLife);
let lastZoomWheel=-Infinity;
window.addEventListener('wheel',event=>{
  if(!petView||!window.dragonDesktop||!event.ctrlKey)return;
  event.preventDefault();
  if(!event.deltaY||performance.now()-lastZoomWheel<60)return;
  lastZoomWheel=performance.now();
  window.dragonDesktop.scale(event.deltaY<0?'in':'out').catch(error=>{evidence.scaleError=error.message;});
},{passive:false});
canvas.addEventListener('pointermove',event=>{
  if(!petView||!model||evidence.status!=='rendering')return;
  const target=touchTarget(...pointerArt(event));
  canvas.title=target?.label||'拖动移动 · 点击摸摸';canvas.style.cursor=event.buttons?'grabbing':target?'pointer':'grab';
});
let touchPointer=null,touchMoved=false,suppressTouchUntil=0;
canvas.addEventListener('pointerdown',event=>{if(event.button===0){touchPointer={id:event.pointerId,x:event.clientX,y:event.clientY};touchMoved=false;}});
canvas.addEventListener('pointermove',event=>{if(touchPointer?.id===event.pointerId&&Math.hypot(event.clientX-touchPointer.x,event.clientY-touchPointer.y)>4)touchMoved=true;});
for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,event=>{if(touchPointer?.id===event.pointerId){if(touchMoved||name==='pointercancel')suppressTouchUntil=performance.now()+500;touchPointer=null;}});
canvas.addEventListener('click',async event=>{
  if(!petView||event.defaultPrevented||event.button!==0||performance.now()<suppressTouchUntil||interactionPending||!model||evidence.status!=='rendering'||reactions.sample(reactionClock()).active)return;
  const target=touchTarget(...pointerArt(event));if(target?.unavailable)return;
  const affinityTarget=target&&AFFECTION_TARGETS.includes(target.id);
  interactionPending=true;
  try{
    const value=window.dragonDesktop?await window.dragonDesktop.life('click'):{progression:{reactionLevel:1},result:{accepted:true,feedback:isSleeping()?'sleepy_reaction':'petting_reaction'}};
    evidence.life=value;
    if(value.result?.accepted!==true)return;
    if(isSleeping()){showSpeech('唔……让我再休息一小会儿。(－ω－) zzZ');return;}
    if(affinityTarget){
      const result=reactions.trigger(target.id,value.progression?.reactionLevel??1,reactionClock());
      if(result.accepted)showSpeech(`${result.record.icon} ${result.record.text}`);
    }else if(target){const controller=target.kind==='object'?extraTouchController:touchController;
      if(controller.trigger(target.id,performance.now()/1000))showSpeech(target.text);}
    else{petBlinkStarted=performance.now();showSpeech(value.result?.xpGained?`收到摸摸～ 好感经验 +${value.result.xpGained}`:'我在呢～');}
  }catch(error){evidence.interactionError=error.message;}
  finally{interactionPending=false;}
});
async function showGrowth(){
  const life=window.dragonDesktop?await window.dragonDesktop.life('get'):evidence.bridge?.life;
  const p=life?.progression;if(!p)return;
  let card=$('growthCard');if(card){card.remove();return;}
  card=document.createElement('section');card.id='growthCard';card.setAttribute('aria-label','好感成长');
  const title=document.createElement('strong');title.textContent=p.isMax?'♡ 好感 Lv.100 · MAX':`♡ 好感 Lv.${p.level}`;
  const meter=document.createElement('progress');meter.max=1;meter.value=p.progress;meter.setAttribute('aria-label',p.isMax?'好感度已满 MAX':'好感度升级进度');
  const text=document.createElement('span');text.textContent=p.isMax?'MAX · 我会一直陪着你～':`${p.levelXp} / ${p.levelXpCost} · ${p.tier==='low'?'慢慢熟悉':p.tier==='mid'?'悄悄心动':'亲近陪伴'}`;
  const count=document.createElement('small');count.textContent=`6处部位 · 本档动作 ${AFFECTION_TARGETS.reduce((n,id)=>n+unlockedReactions(p.reactionLevel,id).length,0)}/30`;
  count.title=AFFECTION_TARGET_METADATA.map(({id,label})=>`${label} ${unlockedReactions(p.reactionLevel,id).length}/5`).join(' · ');
  const close=document.createElement('button');close.textContent='收起';close.onclick=()=>card.remove();card.append(title,meter,text,count,close);document.body.append(card);
}
async function refreshBridge(){
  try {
    const state=await(await checkedFetch('/api/companion-state')).json();
    evidence.bridge=state;presentationWatcher.fromBridge(state.presentationView);if(state.life)evidence.life=state.life;
    const quotaKnown=['local_file','task_unknown'].includes(state.connection)&&Number.isFinite(state.remainingPercent);
    const externalInput=['local_file','expired','task_unknown'].includes(state.connection);
    if((bridgeQuotaKnown===true&&!quotaKnown)
      ||(externalInput&&!['local_file','expired','task_unknown'].includes(bridgeConnection))) {
      driver=new DragonCompanionController({quotaDebounceSeconds:0});
    }
    bridgeQuotaKnown=quotaKnown;
    bridgeConnection=state.connection;
    if(['local_file','task_unknown'].includes(state.connection))bridgeInput={isWorking:state.isWorking===true,remainingPercent:state.remainingPercent??null};
    else if(state.connection==='expired')bridgeInput={isWorking:false,remainingPercent:null};
    else bridgeInput=null;
    updateInput();
  } catch(error){evidence.bridge={connection:'unavailable',error:error.message};
    if(bridgeConnection!=='unavailable')driver=new DragonCompanionController({quotaDebounceSeconds:0});
    bridgeConnection='unavailable';bridgeQuotaKnown=false;bridgeInput={isWorking:false,remainingPercent:null};updateInput();}
}

function showDiagnostics(){ $('diagnostic').textContent=JSON.stringify(evidence,null,2); }
async function sha256(buffer){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),byte=>byte.toString(16).padStart(2,'0')).join('');}
function fail(message,status='error'){
  evidence.status=status;evidence.error=message;showDiagnostics();
  $('badge').textContent=status==='missing_model'?'等待模型导出':'需要检查';
  $('empty').hidden=false;$('empty').querySelector('strong').textContent=status==='missing_model'?'等待模型导出':'暂时无法加载模型';
  $('empty').querySelector('p').textContent=message;
  if(frameId)cancelAnimationFrame(frameId);
}
async function checkedFetch(url){
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw new Error(`${response.status}: ${url}`);
  return response;
}
function localAssetUrl(value,base){
  if(typeof value!=='string'||!value)throw new Error('模型资源路径为空');
  const url=new URL(value,base);
  if(url.origin!==location.origin||!url.pathname.startsWith('/model/'))throw new Error('模型只能引用同一本地模型目录的文件');
  return url.href;
}
function buildControls(){
  $('bindings').replaceChildren();
  for(const binding of inspection){
    if(binding.optional&&!binding.exists)continue;
    const row=document.createElement('div');row.className='binding';
    const title=document.createElement('b');title.textContent=binding.label;
    const state=document.createElement('span');state.textContent=binding.exists?(binding.rangeMatches?'已检测到':'范围不同'):'未检测到';
    const id=document.createElement('code');id.textContent=binding.id;
    row.append(title,state,id);
    if(binding.exists){
      const slider=document.createElement('input');slider.type='range';slider.min=binding.modelMin;slider.max=binding.modelMax;
      slider.step=(binding.modelMax-binding.modelMin)/100||.01;slider.value=binding.modelDefault;slider.dataset.id=binding.id;
      slider.title='手动检查关键形；重置恢复自动动作';
      slider.addEventListener('input',()=>manual.set(binding.id,Number(slider.value)));row.append(slider);
    }
    $('bindings').append(row);
  }
}
function resize(){
  const size=canvas.getBoundingClientRect(),scale=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.max(1,Math.round(size.width*scale));canvas.height=Math.max(1,Math.round(size.height*scale));
}
function fitMatrix(){
  // Compute once per frame from neutral drawable bounds, not the current pose.
  const [minX,minY,maxX,maxY]=evidence.bounds;
  const aspect=canvas.width/canvas.height;
  const scale=Math.min(1.76/(maxY-minY),1.76*aspect/(maxX-minX));
  const matrix=new CubismMatrix44();
  matrix.setMatrix(new Float32Array([scale/aspect,0,0,0, 0,scale,0,0, 0,0,1,0,
    -(minX+maxX)/2*scale/aspect,-(minY+maxY)/2*scale,0,1]));
  return matrix;
}
function measureNeutralBounds(){
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];
  for(let i=0;i<model.getDrawableCount();i++){
    const vertices=model.getDrawableVertices(i);
    for(let j=0;j<vertices.length;j+=2){bounds[0]=Math.min(bounds[0],vertices[j]);bounds[1]=Math.min(bounds[1],vertices[j+1]);bounds[2]=Math.max(bounds[2],vertices[j]);bounds[3]=Math.max(bounds[3],vertices[j+1]);}
  }
  if(!bounds.every(Number.isFinite)||bounds[0]===bounds[2]||bounds[1]===bounds[3])throw new Error('模型网格为空');
  return bounds;
}
async function loadTexture(url,index,padding=0,storageWidth,storageHeight,reference,sourceBounds){
  const response=await checkedFetch(url);const blob=await response.blob();
  evidence.textureSha256??=[];evidence.textureSha256[index]=await sha256(await blob.arrayBuffer());
  const texture=gl.createTexture();
  // ImageBitmap ignores UNPACK_PREMULTIPLY; create a regular HTML image to retain
  // the official sample's premultiplied-alpha texture upload behavior.
  const imageUrl=URL.createObjectURL(blob),element=new Image();
  try{element.src=imageUrl;await element.decode();
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    let pixels=element;
    if(padding){pixels=document.createElement('canvas');pixels.width=storageWidth;pixels.height=storageHeight;const context=pixels.getContext('2d',{willReadFrequently:true});context.drawImage(element,padding,padding);
      if(reference)restoreCutEdgeCoverage(context,element,reference,padding,sourceBounds[0],sourceBounds[1]);}
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  }finally{URL.revokeObjectURL(imageUrl);}
  if(padding)gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,padding?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  renderer.bindTexture(index,texture);gl.bindTexture(gl.TEXTURE_2D,null);
}
function render(now){
  try{
    const dt=lastTime===undefined?0:(now-lastTime)/1000;lastTime=now;
    if(!paused)ambientTime+=Math.max(0,Math.min(.1,dt));
    const frame=driver.update(paused?0:dt);
    const sleeping=isSleeping(),timeNow=reactionClock();
    activeVisual=sleeping?'sleep_mode':visualOverride??visualForState(frame.state,{sleep:false,isWorking:bridgeInput?.isWorking===true});
    const reaction=sleeping?{active:true,record:{id:'rest',pose:'sleep'},progress:.5,channels:{}}:reactionTest?sampleReaction(reactionTest.id,reactionTest.age):reactions.sample(timeNow);
    const reactionChannels=reaction.channels||{};evidence.reaction={...reaction};
    const values={...applyPresentationPolicy(frame.parameters,'working_thinking',frame),...Object.fromEntries(manual)};
    const clickAge=petBlinkStarted===null?Infinity:(now-petBlinkStarted)/1000;
    const clickBlink=clickBlinkClosure(clickAge);
    if(clickAge>=.28)petBlinkStarted=null;
    const blink=sleeping?1:Math.max(blinkClosure(ambientTestTime??ambientTime),clickBlink,reactionChannels.blink||0);
    const leftClosure=manual.has('ParamEyeLOpen')?1-manual.get('ParamEyeLOpen'):blink;
    if(leftEyeBlink){values.ParamEyeLOpen=1;if(!manual.has('ParamEyeROpen'))values.ParamEyeROpen=1-blink;}
    if(sleeping){
      values.ParamDragonMouseX=0;values.ParamDragonKeyIndex=0;values.ParamDragonKeyMiddle=0;
      if(!manual.has('ParamBreath'))values.ParamBreath=.4+(values.ParamBreath-.5)*.25;
      if(!manual.has('ParamDragonAhoge'))values.ParamDragonAhoge*=.12;
      if(!manual.has('ParamDragonTailBase'))values.ParamDragonTailBase*=.12;
    }
    if(reaction.active&&reaction.record.pose==='angry')values.ParamDragonMouseX=0;
    applySupportedParameters(model,inspection,values);
    model.update();
    const touch=touchController.sample(now/1000);
    if(touchTest){touch.values={tail:0,earring:0,mouse:0,book:0,[touchTest.id]:sampleTouch(touchTest.id,touchTest.age)};touch.playing=[touchTest.id];}
    const extraTouch=extraTouchController.sample(now/1000);
    if(extraTouchTest){extraTouch.values={plant:0,mascot:0,keyboard:0,cup:0,[extraTouchTest.id]:sampleExtraTouch(extraTouchTest.id,extraTouchTest.age)};extraTouch.playing=[extraTouchTest.id];}
    touch.values={...touch.values,...extraTouch.values};touch.playing.push(...extraTouch.playing);
    if(sleeping){touch.values={tail:0,earring:0,mouse:0,book:0};touch.playing=[];}
    evidence.touch={...touch,extraLast:extraTouch.last,extraReady:extraHit?.evidence(),pageReady:pageTurn.loaded,earringReady:earringBacking.loaded};
    evidence.ambient=ambientMotion.update(ambientTestTime??ambientTime,{live:ambientTestTime===null,state:frame.state,touch:touch.values,sleep:sleeping,reaction:reactionChannels,disabled:ambientDisabled||manual.size>0&&ambientTestTime===null});
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    const view=sceneView(),rect=canvas.getBoundingClientRect(),time=ambientTestTime??ambientTime;
    const idleRig=idleRigs.get(activeVisual);
    if(idleRig){
      renderer.saveProfile();try{idleRig.draw({time,project:view.project,width:rect.width,height:rect.height,blinkClosure:blink,touch:touch.values,reaction:reactionChannels,disabled:ambientDisabled});}finally{renderer.restoreProfile();}
      evidence.idleRig=idleRig.evidence();
    }else{
      renderer.setMvpMatrix(fitMatrix());renderer.setRenderState(null,[0,0,canvas.width,canvas.height]);renderer.drawModel();
      if(chairLogoRepair){renderer.saveProfile();try{chairLogoRepair.draw(view.project,rect.width,rect.height);}finally{renderer.restoreProfile();}}
    }
    if(legRepair){renderer.saveProfile();try{legRepair.draw(view.project,rect.width,rect.height,{time,state:activeVisual,sleep:sleeping,reactionLeg:reactionChannels.leg||0,disabled:ambientDisabled});}finally{renderer.restoreProfile();}}
    if(!idleRig&&leftEyeBlink){renderer.saveProfile();try{leftEyeBlink.draw(leftClosure,view.project,ambientMotion.restPoint,rect.width,rect.height);}finally{renderer.restoreProfile();}}
    if(!idleRig&&browRepair){renderer.saveProfile();try{browRepair.draw(view.project,ambientMotion.restPoint,rect.width,rect.height);}finally{renderer.restoreProfile();}}
    if(reactionVisuals){const follow=idleRig?(_id,x,y)=>idleRig.followPoint(x,y):ambientMotion.restPoint;
      const args={reaction,project:view.project,follow,width:rect.width,height:rect.height,time,state:activeVisual,mirrored:evidence.presentationView.mirrored};
      renderer.saveProfile();try{reactionVisuals.draw(args);}finally{renderer.restoreProfile();}
      const ctx=reactionOverlay.getContext('2d');reactionOverlay.width=canvas.width;reactionOverlay.height=canvas.height;
      reactionOverlay.style.left=rect.left+'px';reactionOverlay.style.top=rect.top+'px';reactionOverlay.style.width=rect.width+'px';reactionOverlay.style.height=rect.height+'px';
      ctx.scale(canvas.width/rect.width,canvas.height/rect.height);reactionVisuals.drawOverlay(ctx,args);
      drawExtraTouchOverlay(ctx,{values:touch.values,project:view.project,state:activeVisual});evidence.reactionVisuals=reactionVisuals.evidence();}
    evidence.legSample=legRepair?.motionSample;
    evidence.activeVisual=activeVisual;evidence.activeRenderer=idleRig?'layered-runtime':'cubism-with-runtime-enhancements';
    $('workControls').hidden=!!idleRig;
    evidence.blink={leftReady:idleRig?!!evidence.idleRig?.blinkReady:!!leftEyeBlink,leftClosure:idleRig?(evidence.idleRig?.blinkReady?blink:0):leftClosure,rightClosure:idleRig?(evidence.idleRig?.blinkReady?blink:0):1-values.ParamEyeROpen,clickClosure:clickBlink,cadence:'paired-natural-and-click-v0410'};
    pageTurn.draw(idleRig?0:touch.values.book,view.project);
    earringBacking.draw(!idleRig&&Math.abs(touch.values.earring)>0,view.project,ambientMotion.restPoint);
    const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error(`WebGL error ${error}`);
    evidence.renderedFrames++;
    if(evidence.renderedFrames===1){
      const pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)evidence.nonTransparentPixels++;
      if(!evidence.nonTransparentPixels)throw new Error('moc3 已加载，但首帧没有可见像素');
      evidence.status='rendering';$('empty').hidden=true;showDiagnostics();
    }
    $('badge').textContent=idleRig?'分层动作运行中':'Cubism 模型运行中';
    $('state').textContent=`${labels[activeVisual]}${visualOverride?' · 预览':' · 自动'}${paused?' · 已暂停':''}`;
    evidence.state=frame.state;evidence.action=frame.action;
    frameId=requestAnimationFrame(render);
  }catch(error){fail(error.message);}
}
async function main(){
  updateInput();buildControls();
  if(petView){await refreshBridge();bridgeTimer=setInterval(refreshBridge,1000);}
  const catalog=await(await checkedFetch('/api/status')).json();
  evidence.availableModels=catalog.models;
  const selected=catalog.models.find(item=>item.id==='working_thinking');
  evidence.modelUrl=selected.modelUrl;
  for(const option of $('model').options){
    const item=catalog.models.find(model=>model.id===option.value);
    if(item)option.textContent=`${item.label}${item.available?'':' · 素材缺失'}`;
  }
  const response=await fetch(evidence.modelUrl,{cache:'no-store'});
  if(response.status===404)return fail(`请从 Cubism Editor 导出 ${selected.file}、对应 .moc3 和贴图到 outputs/live2d-model-v4/；完成后点击重新检查。`,'missing_model');
  if(!response.ok)throw new Error(`无法读取模型清单：${response.status}`);
  evidence.modelManifestSha256=await sha256(await response.clone().arrayBuffer());
  const settings=await response.json();const references=settings.FileReferences;
  if(!references?.Moc||!Array.isArray(references.Textures)||!references.Textures.length)throw new Error('model3.json 缺少 Moc 或 Textures');
  const base=new URL(evidence.modelUrl,location.href);
  const buffer=await(await checkedFetch(localAssetUrl(references.Moc,base))).arrayBuffer();
  evidence.mocSha256=await sha256(buffer);
  if(new TextDecoder().decode(new Uint8Array(buffer,0,Math.min(4,buffer.byteLength)))!=='MOC3')throw new Error('文件不是有效的 MOC3 数据');
  if(!globalThis.Live2DCubismCore)throw new Error('官方 Cubism Core 尚未加载');
  CubismFramework.startUp();CubismFramework.initialize();
  moc=CubismMoc.create(buffer,true);if(!moc)throw new Error('Cubism Core 未通过 moc3 一致性检查');
  model=moc.createModel();if(!model)throw new Error('Cubism Core 无法创建模型');
  evidence.mocLoaded=true;evidence.mocBytes=buffer.byteLength;evidence.mocVersion=moc.getMocVersion();
  evidence.drawableCount=model.getDrawableCount();inspection=inspectBindings(model.getModel().parameters);
  evidence.parameterInspection=inspection;evidence.bounds=measureNeutralBounds();buildControls();
  // Test hook does not manufacture bindings. It evaluates the loaded moc3's own
  // Core drawables synchronously and restores all parameter values afterward.
  const expectations=await(await checkedFetch('/binding-expectations.json')).json();
  window.dragonModelQA={inspect:(additional={})=>inspectParameterEffects(model,{modelId,expectations:{...expectations[modelId],...additional}}),
    setPose(values){paused=true;ambientTestTime=null;ambientDisabled=false;manual=new Map(inspection.filter(item=>item.exists).map(item=>[item.id,item.modelDefault]));
      for(const [id,value] of Object.entries(values))manual.set(id,value);$('pause').textContent='继续动作';},
    setAmbientSample(time,disabled=false){paused=true;manual.clear();ambientTestTime=time;ambientDisabled=disabled;},
    ambientSnapshot(){return ambientMotion.snapshot();},
    reactionCatalog:REACTIONS.map(({id,duration,target,tier,unlock})=>({id,duration,target,tier,unlock})),
    setReactionSample(id,age){reactionTest=id?{id,age}:null;},
    setSleeping(value){sleepTest=value;},
    setTouchSample(id,age){touchTest=id?{id,age}:null;},
    setExtraTouchSample(id,age){extraTouchTest=id?{id,age}:null;},
    touchTargetAt(x,y){return touchTarget(x,y)?.id??null;},
    projectPoint(x,y){const rect=canvas.getBoundingClientRect(),p=sceneView().project(x,y);return [reflectClientX(p[0]+rect.left,rect,evidence.presentationView.mirrored),p[1]+rect.top];},
    setMirror(value){setPresentationView({mirrored:!!value,screenSide:value?'right':'left',displayId:null});},
    setVisualState(id){visualOverride=id==='auto'?null:selectModelId(id);},
    reset(){reactionTest=null;sleepTest=null;reactions.cancel();manual.clear();paused=false;ambientTestTime=null;ambientDisabled=false;touchTest=null;extraTouchTest=null;touchController.clear();extraTouchController.clear();updateInput();}};
  gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:true,preserveDrawingBuffer:true});
  if(!gl)throw new Error('浏览器无法创建 WebGL 上下文');
  resize();new ResizeObserver(resize).observe(canvas);
  let originals=null;
  if(new URL(location.href).searchParams.get('textures')!=='atlas'){
    originals=sourceTextureModel(model,await(await checkedFetch('/assets/source-layers/manifest.json')).json());
  }
  ambientMotion=createAmbientMotion(originals?.model||model,'working_thinking');
  pageTurn=createPageTurn(canvas);
  earringBacking=createEarringBacking(canvas);
  renderer=new CubismRenderer_WebGL(canvas.width,canvas.height);renderer.initialize(ambientMotion.model);renderer.startUp(gl);
  renderer.setIsPremultipliedAlpha(true);renderer.loadShaders('/vendor/Shaders/WebGL/');
  await Promise.all(references.Textures.map((file,index)=>loadTexture(localAssetUrl(file,base),index)));
  if(originals){
    const reference=new Image();reference.src='/assets/reference-working.png';await reference.decode();
    for(const item of originals.textures)await loadTexture(`/assets/source-layers/${encodeURIComponent(item.file)}`,item.textureIndex,item.padding,item.storageWidth,item.storageHeight,reference,item.bounds);
  }
  evidence.textureMode=originals?'original-layer-resolution':'exported-atlas';
  if(originals&&new URL(location.href).searchParams.get('legs')!=='original')legRepair=await createLegRepair(gl);
  if(originals&&new URL(location.href).searchParams.get('chair')!=='original')chairLogoRepair=await createChairLogoRepair(gl);
  evidence.legRepair=legRepair?'local-anatomy-v048':'original';
  evidence.legMotion=legRepair?.motionProfile??null;
  evidence.chairLogoRepair=chairLogoRepair?'stationary-original-v048':'original';
  if(originals)leftEyeBlink=await createLeftEyeBlink(gl);
  if(originals)browRepair=await createBrowRepair(gl);
  evidence.browRepair=browRepair?'left-brow-local-removal-v0411':null;
  for(const item of MODEL_CATALOG.filter(item=>item.kind==='layered-runtime'))idleRigs.set(item.id,await createIdleRig(gl,item.id));
  extraHit=await createExtraTouchHitTest();
  reactionVisuals=await createReactionVisuals(gl);reactionOverlay=document.createElement('canvas');reactionOverlay.id='reactionOverlay';document.body.append(reactionOverlay);
  evidence.availableVisuals=[...idleRigs.keys(),'sleep_mode'];
  const shader=CubismShaderManager_WebGL.getInstance().getShader(gl),deadline=performance.now()+15000;
  while(!shader._isShaderLoaded){if(performance.now()>deadline)throw new Error('官方着色器加载超时');await new Promise(resolve=>setTimeout(resolve,30));}
  evidence.status='model_loaded';showDiagnostics();frameId=requestAnimationFrame(render);
}
main().catch(error=>fail(error.message));
window.addEventListener('beforeunload',()=>{presentationWatcher.dispose();extraHit?.release();if(bridgeTimer)clearInterval(bridgeTimer);if(frameId)cancelAnimationFrame(frameId);reactionVisuals?.release();for(const rig of idleRigs.values())rig.release();if(renderer)renderer.release();if(moc&&model)moc.deleteModel(model);if(moc)moc.release();});
