import { CubismFramework } from './vendor/Framework/live2dcubismframework.js';
import { CubismMoc } from './vendor/Framework/model/cubismmoc.js';
import { CubismRenderer_WebGL } from './vendor/Framework/rendering/cubismrenderer_webgl.js';
import { CubismShaderManager_WebGL } from './vendor/Framework/rendering/cubismshader_webgl.js';
import { CubismMatrix44 } from './vendor/Framework/math/cubismmatrix44.js';
import { DragonCompanionController } from './controller.mjs';
import { BINDINGS, inspectBindings, applySupportedParameters, applyPresentationPolicy } from './bindings.mjs';
import { selectModelId, inputForModel } from './model-catalog.mjs';
import { inspectParameterEffects } from './model-qa.mjs';
import { bindPetDrag } from './pet-drag.mjs';

const $=id=>document.getElementById(id);
const canvas=$('canvas');
const modelId=selectModelId(new URL(location.href).searchParams.get('model'));
const petView=new URL(location.href).searchParams.get('view')==='pet';
if(petView){document.body.classList.add('pet');document.documentElement.classList.add('pet-root');}
if(petView)bindPetDrag(canvas);
const evidence={status:'waiting',mocLoaded:false,renderedFrames:0,nonTransparentPixels:0,
  parameterInspection:[],modelId,modelUrl:'/model/dragon-working.model3.json'};
window.dragonPreview=evidence;
let paused=false,driver=new DragonCompanionController({quotaDebounceSeconds:0});
let manual=new Map();
let model, renderer, gl, moc, frameId, lastTime, inspection=[];
let bridgeInput=null,bridgeTimer;
let bridgeQuotaKnown=null;
let bridgeConnection=null;
let winkStarted=null;
let speechTimer;
function showSpeech(text){
  if(!petView||!text)return;
  let speech=$('petSpeech');if(!speech){speech=document.createElement('div');speech.id='petSpeech';speech.setAttribute('role','status');document.body.append(speech);}
  speech.textContent=text;speech.classList.add('shown');clearTimeout(speechTimer);speechTimer=setTimeout(()=>speech.classList.remove('shown'),4000);
}
function receiveLife(value){
  evidence.life=value;
  const result=value?.result;if(!result)return;
  if(result.greeting?.text)showSpeech(result.greeting.text);
  else if(result.kind==='mode')showSpeech(result.mode==='gaming_mode'?'陪你玩一会儿～':result.mode==='sleep_mode'?'休息一下，有工作时我会先陪你处理。':'回来啦，继续陪你。');
  else if(result.feedback==='sleepy_reaction')showSpeech('唔……让我再休息一小会儿。');
  else if(result.feedback==='petting_reaction')showSpeech(result.xpGained?`收到摸摸～ 经验 +${result.xpGained} · 好感 +${result.affectionGained}`:'我在呢～');
}
const labels={working_thinking:'认真工作 · 有一点迷糊',idle_high_energy:'精神抖擞',idle_mid_energy:'略有疲惫',idle_low_energy:'非常疲惫',idle_neutral:'额度未知 · 中性待机'};

function updateInput(){
  driver.setInput(bridgeInput||inputForModel(modelId));
}
$('model').value=modelId;
$('model').addEventListener('change',()=>{
  const next=new URL(location.href);next.searchParams.set('model',selectModelId($('model').value));location.assign(next);
});
$('reload').addEventListener('click',()=>location.reload());
$('pause').addEventListener('click',()=>{paused=!paused;$('pause').textContent=paused?'继续动作':'暂停动作';});
$('reset').addEventListener('click',()=>{manual.clear();driver=new DragonCompanionController({quotaDebounceSeconds:0});updateInput();for(const e of document.querySelectorAll('.binding input'))e.value=inspection.find(b=>b.id===e.dataset.id).modelDefault;});
window.dragonDesktop?.onAction(action=>{
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
canvas.addEventListener('click',async()=>{
  if(!petView)return;
  if(window.dragonDesktop) {
    try{const value=await window.dragonDesktop.life('click');if(value.result?.feedback==='petting_reaction')winkStarted=performance.now();}
    catch(error){evidence.interactionError=error.message;}
  } else winkStarted=performance.now();
});
async function refreshBridge(){
  try {
    const state=await(await checkedFetch('/api/companion-state')).json();
    evidence.bridge=state;
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
async function loadTexture(url,index){
  const response=await checkedFetch(url);const blob=await response.blob();
  evidence.textureSha256??=[];evidence.textureSha256[index]=await sha256(await blob.arrayBuffer());
  const texture=gl.createTexture();
  // ImageBitmap ignores UNPACK_PREMULTIPLY; create a regular HTML image to retain
  // the official sample's premultiplied-alpha texture upload behavior.
  const imageUrl=URL.createObjectURL(blob),element=new Image();
  try{element.src=imageUrl;await element.decode();
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,element);
  }finally{URL.revokeObjectURL(imageUrl);}
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  renderer.bindTexture(index,texture);gl.bindTexture(gl.TEXTURE_2D,null);
}
function render(now){
  try{
    const dt=lastTime===undefined?0:(now-lastTime)/1000;lastTime=now;
    const frame=driver.update(paused?0:dt);
    const values={...applyPresentationPolicy(frame.parameters,modelId,frame),...Object.fromEntries(manual)};
    if(evidence.bridge?.presentationMode==='sleep_mode'&&!bridgeInput?.isWorking){
      if(!manual.has('ParamBreath'))values.ParamBreath=.4+(values.ParamBreath-.5)*.25;
      if(!manual.has('ParamDragonAhoge'))values.ParamDragonAhoge*=.12;
      if(!manual.has('ParamDragonTailBase'))values.ParamDragonTailBase*=.12;
    }
    if(winkStarted!==null&&!manual.has('ParamEyeROpen')) {
      const age=(now-winkStarted)/1000;
      if(age>=.28)winkStarted=null;else values.ParamEyeROpen=1-Math.sin(Math.PI*age/.28)**2;
    }
    applySupportedParameters(model,inspection,values);
    model.update();
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.setMvpMatrix(fitMatrix());renderer.setRenderState(null,[0,0,canvas.width,canvas.height]);renderer.drawModel();
    const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error(`WebGL error ${error}`);
    evidence.renderedFrames++;
    if(evidence.renderedFrames===1){
      const pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)evidence.nonTransparentPixels++;
      if(!evidence.nonTransparentPixels)throw new Error('moc3 已加载，但首帧没有可见像素');
      evidence.status='rendering';$('empty').hidden=true;$('badge').textContent='真实 moc3 已加载';showDiagnostics();
    }
    $('state').textContent=`${labels[frame.state]} · ${frame.action}${paused?' · 已暂停':''}`;
    evidence.state=frame.state;evidence.action=frame.action;
    frameId=requestAnimationFrame(render);
  }catch(error){fail(error.message);}
}
async function main(){
  updateInput();buildControls();
  if(petView){await refreshBridge();bridgeTimer=setInterval(refreshBridge,1000);}
  const catalog=await(await checkedFetch('/api/status')).json();
  evidence.availableModels=catalog.models;
  const selected=catalog.models.find(item=>item.id===modelId);
  evidence.modelUrl=selected.modelUrl;
  for(const option of $('model').options){
    const item=catalog.models.find(model=>model.id===option.value);
    option.textContent=`${item.label}${item.modelManifestAvailable?'':' · 等待导出'}`;
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
    setPose(values){paused=true;manual=new Map(inspection.filter(item=>item.exists).map(item=>[item.id,item.modelDefault]));
      for(const [id,value] of Object.entries(values))manual.set(id,value);$('pause').textContent='继续动作';},
    reset(){manual.clear();paused=false;updateInput();}};
  gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:true,preserveDrawingBuffer:true});
  if(!gl)throw new Error('浏览器无法创建 WebGL 上下文');
  resize();new ResizeObserver(resize).observe(canvas);
  renderer=new CubismRenderer_WebGL(canvas.width,canvas.height);renderer.initialize(model);renderer.startUp(gl);
  renderer.setIsPremultipliedAlpha(true);renderer.loadShaders('/vendor/Shaders/WebGL/');
  await Promise.all(references.Textures.map((file,index)=>loadTexture(localAssetUrl(file,base),index)));
  const shader=CubismShaderManager_WebGL.getInstance().getShader(gl),deadline=performance.now()+15000;
  while(!shader._isShaderLoaded){if(performance.now()>deadline)throw new Error('官方着色器加载超时');await new Promise(resolve=>setTimeout(resolve,30));}
  evidence.status='model_loaded';showDiagnostics();frameId=requestAnimationFrame(render);
}
main().catch(error=>fail(error.message));
window.addEventListener('beforeunload',()=>{if(bridgeTimer)clearInterval(bridgeTimer);if(frameId)cancelAnimationFrame(frameId);if(renderer)renderer.release();if(moc&&model)moc.deleteModel(model);if(moc)moc.release();});
