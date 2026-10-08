import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startServer} from '../../outputs/live2d-preview-v4/server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const A='a'.repeat(64),B='b'.repeat(64);
let selected=A,active=true,fail=false;
const fixture=()=>({connection:'local_file',taskKnown:true,followSession:selected,
  tasks:[{id:A,threadId:'00000000-0000-4000-8000-000000000001',turn:'test-a',active,stale:false,
    terminalEvent:active?null:'Stop',updatedAt:Date.now(),expiresAt:Date.now()+900000,label:active?'执行命令':'本轮已结束'},
    {id:B,threadId:'00000000-0000-4000-8000-000000000002',turn:'test-b',active:true,stale:false,
      updatedAt:Date.now(),expiresAt:Date.now()+900000,label:'修改文件'}]});
const server=await startServer({port:0,stateProvider:fixture});
const browser=await chromium.launch({headless:true,channel:'msedge'}),results=[];
async function page(){
  const context=await browser.newContext({viewport:{width:168,height:66}});
  const p=await context.newPage();
  await p.addInitScript(({fail})=>{
    window.__opens=[];window.__visibility=[];
    window.dragonDesktop={view:async()=>({mirrored:false}),onView:()=>()=>{},
      onAction:cb=>{window.__action=cb;},
      bubbleVisibility:async visible=>window.__visibility.push(visible),
      openTask:async id=>{window.__opens.push({id,at:Date.now()});return {opened:!fail};},panel:async()=>{}};
  },{fail});
  await p.goto(`http://127.0.0.1:${server.address().port}/mini.html`);
  await p.waitForFunction(()=>window.miniEvidence?.connected);
  return {context,p};
}
try{
  selected=A;active=true;fail=false;
  {
    const {context,p}=await page(),clicked=Date.now();
    await p.locator('#card').click({position:{x:85,y:32}});
    assert.equal(await p.evaluate(()=>window.miniEvidence.popping),true);
    assert.equal(await p.evaluate(()=>window.__opens.length),0);
    await p.waitForFunction(()=>window.__opens.length===1);
    const opened=await p.evaluate(()=>window.__opens[0]);
    assert.equal(opened.id,A);assert.ok(opened.at-clicked>=500);
    await p.waitForTimeout(1300);
    assert.equal(await p.evaluate(()=>window.miniEvidence.dismissed),true);
    assert.equal(await p.evaluate(()=>window.miniEvidence.popCount),1);
    await p.waitForFunction(()=>!window.miniEvidence.dismissed&&window.miniEvidence.jumpTaskId===null,{},{timeout:8000});
    const elapsed=Date.now()-clicked;assert.ok(elapsed>=6400&&elapsed<8000);
    assert.equal(await p.evaluate(()=>window.__opens.length),1);
    results.push({test:'shatter-before-exact-navigation-and-6.5-second-active-return',passed:true,elapsedMs:elapsed});
    await context.close();
  }
  {
    selected=A;active=true;
    const {context,p}=await page();
    await p.locator('#card').click({position:{x:85,y:32}});
    await p.waitForFunction(()=>window.__opens.length===1);active=false;
    await p.waitForTimeout(6300);
    assert.equal(await p.evaluate(()=>window.miniEvidence.dismissed),true);
    assert.equal(await p.evaluate(()=>window.miniEvidence.popCount),1);
    active=true;
    await p.waitForFunction(()=>!window.miniEvidence.dismissed);
    results.push({test:'completed-stays-hidden-new-activity-reveals-without-second-pop',passed:true});
    await context.close();
  }
  {
    fail=true;active=true;
    const {context,p}=await page();
    await p.locator('#card').click({position:{x:85,y:32}});
    await p.waitForFunction(()=>window.miniEvidence.lastOpenResult==='unavailable');
    assert.equal(await p.evaluate(()=>window.miniEvidence.dismissed),false);
    assert.equal(await p.evaluate(()=>window.miniEvidence.jumpTaskId),null);
    results.push({test:'failed-navigation-restores-bubble',passed:true});
    await context.close();
  }
  {
    fail=false;selected=A;active=true;
    const {context,p}=await page();
    // A pointer drag must not run the click navigation or its shatter.
    await p.mouse.move(45,32);await p.mouse.down();await p.mouse.move(90,32);await p.mouse.up();
    await p.waitForTimeout(600);
    assert.equal(await p.evaluate(()=>window.__opens.length),0);
    assert.equal(await p.evaluate(()=>window.miniEvidence.popCount),0);
    await p.locator('#card').click({position:{x:85,y:32}});
    await p.waitForFunction(()=>window.__opens.length===1);
    selected=B;
    await p.waitForFunction(()=>window.miniEvidence.taskId==='b'.repeat(64)&&!window.miniEvidence.dismissed);
    assert.equal(await p.evaluate(()=>window.__opens[0].id),A);
    results.push({test:'drag-does-not-navigate-different-selected-task-reveals',passed:true});
    await context.close();
  }
  {
    selected=A;active=true;fail=false;
    const {context,p}=await page();
    // Align the next 750 ms poll inside the 560 ms shatter. The navigation
    // must retain A even though automatic following reveals B beforehand.
    await p.waitForTimeout(500);
    await p.locator('#card').click({position:{x:85,y:32}});selected=B;
    await p.waitForFunction(()=>window.miniEvidence.taskId==='b'.repeat(64));
    await p.waitForFunction(()=>window.__opens.length===1);
    assert.equal(await p.evaluate(()=>window.__opens[0].id),A);
    assert.equal(await p.evaluate(()=>window.miniEvidence.dismissed),false);
    results.push({test:'selection-changes-during-shatter-still-navigates-original-task',passed:true});
    await context.close();
  }
  {
    selected=A;active=false;fail=false;
    const {context,p}=await page();
    await p.waitForFunction(()=>window.miniEvidence.canPop);
    await p.locator('#pop').dispatchEvent('click');
    await p.waitForFunction(()=>window.miniEvidence.dismissed);
    assert.equal(await p.evaluate(()=>window.__opens.length),0);
    assert.equal(await p.evaluate(()=>window.miniEvidence.popCount),1);
    assert.equal(await p.evaluate(()=>window.miniEvidence.popping),false);
    results.push({test:'completed-only-close-shatters-once-without-navigation',passed:true});
    await context.close();
  }
  const reportDirectory=new URL('../../work/qa/',import.meta.url);
  await mkdir(reportDirectory,{recursive:true});
  await writeFile(new URL('bubble-jump-ui-report.json',reportDirectory),JSON.stringify({passed:true,results},null,2));
  console.log(JSON.stringify({passed:true,results}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
