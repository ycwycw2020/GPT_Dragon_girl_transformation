const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function createBridge(){
  let api,response={mirrored:false,displayId:7};const listeners=new Map(),invocations=[];
  const ipcRenderer={invoke:async(name,...args)=>{invocations.push([name,...args]);return response;},
    on:(name,handler)=>listeners.set(name,handler),removeListener:(name,handler)=>{if(listeners.get(name)===handler)listeners.delete(name);}};
  vm.runInNewContext(fs.readFileSync(require.resolve('./preload.cjs'),'utf8'),{require:name=>{
    assert.equal(name,'electron');return {ipcRenderer,contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}}};
  }});
  return {api,listeners,invocations,setResponse:value=>{response=value;}};
}
test('presentation IPC accepts only boolean direction and unsubscribes cleanly',async()=>{
  const bridge=createBridge();assert.equal((await bridge.api.view()).mirrored,false);
  assert.equal(bridge.invocations[0][0],'dragon:view');
  const received=[],off=bridge.api.onView(value=>received.push(value));
  const emit=value=>bridge.listeners.get('dragon:view-update')({},value);
  for(const invalid of [null,{},true,{mirrored:'true'},{mirrored:1}])emit(invalid);
  assert.equal(received.length,0);
  emit({mirrored:true,displayId:8,arbitrary:'not-forwarded'});
  assert.equal(received.length,1);assert.equal(received[0].screenSide,'right');
  assert.equal(received[0].arbitrary,undefined);assert(Object.isFrozen(received[0]));
  off();assert(!bridge.listeners.has('dragon:view-update'));
  bridge.setResponse({mirrored:'false'});await assert.rejects(bridge.api.view(),/Invalid presentation/);
});
test('explicit bubble show is allowed without exposing arbitrary actions',()=>{
  const bridge=createBridge(),received=[];bridge.api.onAction(value=>received.push(value));
  const emit=value=>bridge.listeners.get('dragon:action')({},value);
  emit('bubble:show');emit('bubble:inject');emit('sleep');
  assert.deepEqual(received,['bubble:show']);
});
test('temporary bubble visibility accepts booleans only',async()=>{
  const bridge=createBridge();
  await bridge.api.bubbleVisibility(false);assert.deepEqual(bridge.invocations[0],['dragon:bubble-visibility',false]);
  await assert.rejects(bridge.api.bubbleVisibility('false'),/Invalid bubble/);
  assert.equal(bridge.invocations.length,1);
});
test('question navigation exposes no caller-controlled thread, URL or extra arguments',async()=>{
  const bridge=createBridge();bridge.setResponse({opened:true});
  const result=await bridge.api.openQuestion('https://example.com','arbitrary-thread');
  assert.equal(result.opened,true);assert.deepEqual(bridge.invocations,[['dragon:open-question']]);
});
test('task navigation accepts only a display task hash, never a URL or thread UUID',async()=>{
  const bridge=createBridge();bridge.setResponse({opened:true});
  for(const invalid of [undefined,null,'','unknown','codex://threads/new','https://example.com','01999999-9999-7431-8fff-000000000001','a'.repeat(63),'a'.repeat(65),'g'.repeat(64),'a'.repeat(64)+'?command=run',{}])
    await assert.rejects(bridge.api.openTask(invalid),/Invalid task identifier/);
  assert.equal(bridge.invocations.length,0);
  const id='0123456789abcdef'.repeat(4),result=await bridge.api.openTask(id,{threadId:'injected'});
  assert.equal(result.opened,true);assert.deepEqual(bridge.invocations,[['dragon:open-task',id]]);
});
test('task follow accepts only automatic mode or a session hash and rejects supplied URLs',async()=>{
  const bridge=createBridge();
  for(const invalid of [null,{},false,'unknown','https://example.com','codex://threads/new','a'.repeat(63),'g'.repeat(64)])
    await assert.rejects(bridge.api.follow(invalid),/Invalid task identifier/);
  assert.equal(bridge.invocations.length,0);
  await bridge.api.follow();await bridge.api.follow('a'.repeat(64));
  assert.deepEqual(bridge.invocations,[['dragon:follow',''],['dragon:follow','a'.repeat(64)]]);
});
