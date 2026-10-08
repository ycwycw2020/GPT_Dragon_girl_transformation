import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import * as life from './life/index.mjs';
import * as wake from './rest-wakeup.mjs';
import * as control from './codex-rest-control.mjs';

// Run the real main-process life functions with inert Electron/filesystem
// boundaries. No desktop window, profile file, or Codex task is touched.
async function harness(rest=control){
  const file=fileURLToPath(new URL('./main.cjs',import.meta.url)),realRequire=createRequire(file),writes=[];
  const fakeElectron={app:{setPath(){},setName(){},requestSingleInstanceLock:()=>false,quit(){}},
    Menu:{buildFromTemplate:template=>({template})}};
  const sandbox={console,process:{argv:[],platform:process.platform},Buffer,setTimeout,clearTimeout,setInterval,clearInterval,
    __dirname:path.dirname(file),__modules:{life,wake,rest},
    require(name){if(name==='electron')return fakeElectron;if(name==='node:fs/promises')return {writeFile:async(file,value)=>writes.push({file,value}),rename:async()=>{}};return realRequire(name);}};
  vm.createContext(sandbox);
  const source=await readFile(file,'utf8');
  new vm.Script(source+`\n;
    lifeModule=__modules.life;restWakeModule=__modules.wake;restControlModule=__modules.rest;
    lifeState={...lifeModule.createLifeState(lifeOptions),totalXp:10};
    window={webContents:{send(){}},isDestroyed:()=>false};
    lastCombinedState={tasks:[{id:'a'.repeat(64),turn:'b'.repeat(64),active:true}]};
    globalThis.review={handleLife,snapshot:lifeSnapshot,getTracker:()=>restWakeTracker,menu:updateMenu};
  `,{filename:file}).runInContext(sandbox);
  return {...sandbox.review,writes};
}

test('main orders an asynchronous sleep request before concurrent clicks without losing saved growth',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const h=await harness({...control,requestCodexRest:async()=>{await gate;return control.getCodexRestCapability();}});
  const sleeping=h.handleLife('sleep');await Promise.resolve();
  const clicked=h.handleLife('click');release();
  const [sleep,click]=await Promise.all([sleeping,clicked]);
  assert.equal(sleep.mode,'sleep_mode');assert.equal(sleep.restControl.supported,false);assert.equal(sleep.restControl.allStopped,false);
  assert.equal(click.result.reason,'sleeping');assert.equal(click.progression.totalXp,10);
  const last=JSON.parse(h.writes.at(-1).value);
  assert.deepEqual(last.temporaryMode.restBaseline,[{id:'a'.repeat(64),turn:'b'.repeat(64)}]);
  assert.equal('expiresAt' in last.temporaryMode,false);
  assert(h.menu().template.some(item=>item.enabled===false&&item.label==='Codex任务未停止 · 控制接口未接通'));
});

test('a queued wake from a superseded rest snapshot cannot cancel a newer rest request',async()=>{
  const h=await harness();await h.handleLife('sleep');const oldTracker=h.getTracker();
  await h.handleLife('sleep');assert.notEqual(h.getTracker(),oldTracker);
  const ignored=await h.handleLife('normal',oldTracker);
  assert.equal(ignored.mode,'sleep_mode');assert.equal(ignored.result,null);
  const normal=await h.handleLife('normal');assert.equal(normal.mode,null);assert.equal(normal.restControl,null);
  assert(!h.menu().template.some(item=>item.label?.includes('控制接口未接通')));
  assert(!h.menu().template.some(item=>/游戏|gaming/u.test(item.label??'')));
});
