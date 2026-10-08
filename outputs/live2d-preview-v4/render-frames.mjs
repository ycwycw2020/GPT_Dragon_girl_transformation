import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { selectModelId, inputForModel } from './model-catalog.mjs';
import { DragonCompanionController } from './controller.mjs';
import { applyPresentationPolicy } from './bindings.mjs';
import { NATIVE_STATES, nativePose, directionPose } from './frame-profiles.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2);
const option=(name,fallback)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1];};
const modelId=option('--model','working_thinking'),profile=option('--profile','sequence');
if(selectModelId(modelId)!==modelId||!['sequence','codex-v2'].includes(profile))throw new Error('Unknown model/profile');
const width=Number(option('--width',384)),height=Number(option('--height',512));
const fps=Number(option('--fps',12)),seconds=Number(option('--seconds',12));
if(![width,height].every(value=>Number.isInteger(value)&&value>=128&&value<=4096))throw new Error('Dimensions must be 128..4096');
if(!Number.isFinite(fps)||fps<1||fps>60||!Number.isFinite(seconds)||seconds<=0||Math.ceil(fps*seconds)>2048)throw new Error('Invalid frame budget');
const output=path.resolve(option('--out',path.join(HERE,'../../work/cubism-frames-v4',profile)));
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.DRAGON_PLAYWRIGHT_MODULE || 'playwright');
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const server=await startServer({port:0});let browser;
try {
  browser=await chromium.launch({channel:process.env.DRAGON_BROWSER_CHANNEL||'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width,height}});
  await page.goto(`http://127.0.0.1:${server.address().port}/?model=${modelId}&view=pet`);
  await page.waitForFunction(()=>['missing_model','rendering','error'].includes(window.dragonPreview?.status),null,{timeout:30000});
  const evidence=await page.evaluate(()=>window.dragonPreview);
  if(evidence.status!=='rendering') {
    console.log(JSON.stringify({status:evidence.status==='missing_model'?'pending_export':evidence.status,modelId,error:evidence.error,framesWritten:0}));
    process.exitCode=evidence.status==='missing_model'?2:1;
  } else {
    const modelDirectory=await realpath(path.resolve(HERE,'../live2d-model-v4'));
    const sourceFile=async file=>{
      const absolute=await realpath(path.resolve(modelDirectory,file));
      if(!absolute.startsWith(modelDirectory+path.sep))throw new Error('Model resource escapes its directory');
      const buffer=await readFile(absolute);return {path:absolute,sha256:hash(buffer),bytes:buffer.length};
    };
    const manifestFile=decodeURIComponent(evidence.modelUrl.slice('/model/'.length));
    const sourceManifest=await sourceFile(manifestFile),settings=JSON.parse(await readFile(sourceManifest.path,'utf8'));
    const manifest={schema:'dragon-moc3-frames-v1',profile,modelId,createdAt:new Date().toISOString(),
      source:{model3:sourceManifest,moc3:await sourceFile(settings.FileReferences.Moc),
        textures:await Promise.all(settings.FileReferences.Textures.map(sourceFile))},
      renderer:{runtime:'Cubism SDK for Web 5-r.5',mocLoaded:true,mocVersion:evidence.mocVersion,
        drawableCount:evidence.drawableCount,nonTransparentPixels:evidence.nonTransparentPixels,width,height,transparent:true,fitMarginFraction:.12},
      states:{},look:{frames:[]},unsupportedDirections:[],warnings:[],
      presentation:'Both eyes held open automatically; current left-eye repair is deferred. Seated desk motions remain seated.',
    };
    if(manifest.source.model3.sha256!==evidence.modelManifestSha256||manifest.source.moc3.sha256!==evidence.mocSha256
      ||manifest.source.textures.some((texture,index)=>texture.sha256!==evidence.textureSha256[index])) {
      throw new Error('Export changed while loading; retry after Cubism finishes writing the model.');
    }
    await mkdir(output,{recursive:true});
    const capture=async(file,parameters,extra={})=>{
      await page.evaluate(values=>window.dragonModelQA.setPose(values),parameters);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const data=await page.evaluate(()=>document.getElementById('canvas').toDataURL('image/png'));
      const buffer=Buffer.from(data.split(',')[1],'base64'),target=path.join(output,file);
      await mkdir(path.dirname(target),{recursive:true});await writeFile(target,buffer);
      return {file,sha256:hash(buffer),parameters,...extra};
    };
    if(profile==='codex-v2') {
      for(const [state,durations] of Object.entries(NATIVE_STATES)) {
        const total=durations.reduce((sum,value)=>sum+value,0),frames=[];let elapsed=0;
        for(let index=0;index<durations.length;index++) {
          frames.push(await capture(`frames/${state}/${String(index).padStart(3,'0')}.png`,nativePose(state,elapsed/total),{durationMs:durations[index]}));
          elapsed+=durations[index];
        }
        manifest.states[state]={fps:durations.length/(total/1000),nativePlaybackDurationsMs:durations,frames};
        if(new Set(frames.map(frame=>frame.sha256)).size<2)manifest.warnings.push(`${state}: no visible pixel change; required motion may be unbound.`);
      }
      for(let index=0;index<16;index++)manifest.look.frames.push(await capture(`look/${String(index).padStart(3,'0')}.png`,directionPose(index),{angleDegrees:index*22.5}));
      const distinct=new Set(manifest.look.frames.map(frame=>frame.sha256)).size;
      if(distinct<16)manifest.unsupportedDirections.push({reason:'Current exported model does not provide 16 distinct look poses',distinctFrames:distinct,requiredFrames:16});
      manifest.geometry=await page.evaluate(()=>window.dragonModelQA.inspect({ParamEyeBallX:{required:false},ParamEyeBallY:{required:false},ParamAngleX:{required:false},ParamAngleY:{required:false}}));
    } else {
      const driver=new DragonCompanionController({quotaDebounceSeconds:0});driver.setInput(inputForModel(modelId));
      driver.update(2);const frames=[];
      for(let index=0;index<Math.ceil(fps*seconds);index++) {
        const frame=driver.update(index?1/fps:0),parameters=applyPresentationPolicy(frame.parameters,modelId,frame);
        frames.push(await capture(`frames/${modelId}/${String(index).padStart(3,'0')}.png`,parameters,{timeSeconds:index/fps,durationMs:1000/fps}));
      }
      manifest.states[modelId]={fps,frames};
      if(new Set(frames.map(frame=>frame.sha256)).size<2)manifest.warnings.push('No visible pixel change; motion may be unbound.');
    }
    await writeFile(path.join(output,'render-manifest.json'),JSON.stringify(manifest,null,2));
    console.log(JSON.stringify({status:'rendered_from_real_moc3',output,profile,
      frameCount:Object.values(manifest.states).reduce((sum,state)=>sum+state.frames.length,0)+manifest.look.frames.length,
      unsupportedDirections:manifest.unsupportedDirections,warnings:manifest.warnings}));
  }
} finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
