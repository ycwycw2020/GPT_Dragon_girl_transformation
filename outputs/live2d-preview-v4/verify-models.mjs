import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { MODEL_CATALOG, selectModelId } from './model-catalog.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const reportPath=path.resolve(option('--report')||path.join(HERE,'../../work/preview-v4/two-model-validation.json'));
const requested=option('--model');
if(requested&&selectModelId(requested)!==requested)throw new Error('Unknown --model');
const selected=requested?MODEL_CATALOG.filter(model=>model.id===requested):MODEL_CATALOG;
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.DRAGON_PLAYWRIGHT_MODULE || 'playwright');
const server=await startServer({port:0});
let browser;
const report={checkedAt:new Date().toISOString(),runtime:'Cubism SDK for Web 5-r.5',models:[],
  note:'Only actual exported dragon moc3 models are tested. Missing exports remain pending. Visual eye/alpha/seam review remains required.'};
try {
  browser=await chromium.launch({channel:process.env.DRAGON_BROWSER_CHANNEL||'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
  for(const entry of selected) {
    const page=await browser.newPage({viewport:{width:1150,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/?model=${entry.id}`);
      await page.waitForFunction(()=>['missing_model','rendering','error'].includes(window.dragonPreview?.status),null,{timeout:30000});
      const evidence=await page.evaluate(()=>window.dragonPreview);
      const modelReport={id:entry.id,evidence,errors};
      if(evidence.status==='rendering') {
        modelReport.geometry=await page.evaluate(()=>window.dragonModelQA.inspect());
        modelReport.status=modelReport.geometry.allRequiredVerified&&errors.length===0?'parameters_verified_visual_review_required':'needs_binding_review';
        if(args.includes('--screenshots')) {
          const directory=path.join(path.dirname(reportPath),entry.id);await mkdir(directory,{recursive:true});
          modelReport.poseScreenshots=[];
          // Render the actual WebGL canvas at exported canvas resolution. Saving
          // its PNG preserves alpha; this is not an OS/UI screenshot or a source
          // illustration pasted onto the page.
          const canvasInfo=modelReport.geometry.canvasInfo;
          const width=Math.round(canvasInfo.CanvasWidth),height=Math.round(canvasInfo.CanvasHeight);
          if(!(width>0&&height>0&&width<=8192&&height<=8192))throw new Error('Invalid exported canvas dimensions');
          await page.evaluate(({width,height})=>{
            const canvas=document.getElementById('canvas');canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
            canvas.style.minHeight='0';
          },{width,height});
          await page.waitForFunction(({width,height})=>{const canvas=document.getElementById('canvas');return canvas.width===width&&canvas.height===height;},{width,height});
          modelReport.poseImageDimensions={width,height,note:'Fitted full model with preview margin; alpha preserved'};
          for(const [name,pose] of Object.entries({open:{ParamEyeLOpen:1,ParamEyeROpen:1},half:{ParamEyeLOpen:.5,ParamEyeROpen:.5},closed:{ParamEyeLOpen:0,ParamEyeROpen:0},left_only:{ParamEyeLOpen:0,ParamEyeROpen:1},right_only:{ParamEyeLOpen:1,ParamEyeROpen:0}})) {
            await page.evaluate(pose=>window.dragonModelQA.setPose(pose),pose);
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            const target=path.join(directory,`${name}.png`);
            const png=await page.evaluate(()=>document.getElementById('canvas').toDataURL('image/png'));
            await writeFile(target,Buffer.from(png.split(',')[1],'base64'));modelReport.poseScreenshots.push(target);
          }
        }
      } else modelReport.status=evidence.status==='missing_model'?'pending_export':'failed_to_render';
      report.models.push(modelReport);
      console.log(JSON.stringify({id:entry.id,status:modelReport.status,mocLoaded:evidence.mocLoaded,
        pixels:evidence.nonTransparentPixels,parameters:modelReport.geometry?.parameters.map(item=>({id:item.id,status:item.status,maxPx:Math.max(0,...item.tests.map(test=>test.maxDistancePx))}))}));
    } finally {await page.close();}
  }
} finally {
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  await mkdir(path.dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2));
}
if(report.models.some(model=>model.status==='pending_export'))process.exitCode=2;
else if(report.models.some(model=>model.status!=='parameters_verified_visual_review_required'))process.exitCode=1;
