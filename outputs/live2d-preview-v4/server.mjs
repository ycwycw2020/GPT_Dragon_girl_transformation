import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_CATALOG } from './model-catalog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg',
  '.moc3':'application/octet-stream','.frag':'text/plain','.vert':'text/plain',
  '.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};

export async function startServer({port=4174, modelDirectory=path.resolve(HERE,'../live2d-model-v4'),
  modelFileName,stateProvider}={}) {
  async function listModels() {
    return Promise.all(MODEL_CATALOG.map(async model=>{
      const candidates=model.id==='working_thinking'&&modelFileName?[modelFileName]:model.files;
      let available=false,file=candidates[0];
      for(const candidate of candidates) {
        try {if((await stat(path.join(modelDirectory,candidate))).isFile()) {available=true;file=candidate;break;}} catch {}
      }
      return {id:model.id,label:model.label,modelManifestAvailable:available,
        modelUrl:`/model/${file.split('/').map(encodeURIComponent).join('/')}`,file,
        genuineRenderVerified:false};
    }));
  }
  const server=http.createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' blob:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'"};
    const reply=(status,text,type='text/plain; charset=utf-8')=>{
      res.writeHead(status,{...headers,'Content-Type':type}); res.end(req.method==='HEAD'?'':text);
    };
    if(!['GET','HEAD'].includes(req.method)) return reply(405,'Method not allowed');
    if(!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host||''))return reply(403,'Local access only');
    try {
      const address=new URL(req.url,'http://127.0.0.1');
      const pathname=decodeURIComponent(address.pathname);
      if(pathname==='/favicon.ico'){res.writeHead(204,headers);return res.end();}
      if(pathname.includes('\0') || pathname.includes('\\')) return reply(400,'Invalid path');
      if(pathname==='/api/companion-state') {
        const state=stateProvider?await stateProvider():{connection:'standalone_preview'};
        return reply(200,JSON.stringify(state),'application/json; charset=utf-8');
      }
      if(pathname==='/api/status') {
        const models=await listModels(),selected=models[0];
        return reply(200,JSON.stringify({modelManifestAvailable:selected.modelManifestAvailable,
          modelUrl:selected.modelUrl,models,runtime:'Cubism SDK for Web 5-r.5',
          note:selected.modelManifestAvailable?'Manifest found; browser must still validate and load moc3.':'等待 Cubism Editor 导出工作模型、moc3 与贴图。',
          genuineRenderVerified:false}), 'application/json; charset=utf-8');
      }
      const isModel=pathname.startsWith('/model/');
      const base=isModel?modelDirectory:HERE;
      let rel=isModel?pathname.slice(7):pathname.slice(1)||'index.html';
      if(isModel && rel==='dragon.model3.json') rel=(await listModels())[0].file;
      const candidate=path.resolve(base,rel);
      const baseAbs=path.resolve(base);
      if(!candidate.startsWith(baseAbs+path.sep)) return reply(403,'Forbidden');
      const actual=await realpath(candidate);
      const actualBase=await realpath(base);
      if(!actual.startsWith(actualBase+path.sep)) return reply(403,'Forbidden');
      if(!(await stat(actual)).isFile()) return reply(404,'Not found');
      const ext=path.extname(actual).toLowerCase();
      if(!Object.hasOwn(MIME,ext)) return reply(403,'Unsupported file type');
      reply(200,await readFile(actual),MIME[ext]);
    } catch(error) {
      reply(error.code==='ENOENT'?404:400,error.code==='ENOENT'?'Not found':'Cannot read resource');
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return server;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.DRAGON_PREVIEW_PORT||4174);
  const server=await startServer({port});
  console.log(`Dragon companion local preview: http://127.0.0.1:${server.address().port}`);
}
