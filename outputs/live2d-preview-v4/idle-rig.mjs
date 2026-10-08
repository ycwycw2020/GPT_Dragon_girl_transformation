import {interpolateCurve} from './eye-blink.mjs';
import {extraObjectDisplacement,extraCharacterDisplacement,EXTRA_DISPLACEMENT_GLSL} from './extra-touch.mjs';

export const IDLE_STATES=['idle_high_energy','idle_mid_energy','idle_low_energy'];
const W=2426,H=2592,clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
export const IDLE_PROFILES=Object.freeze({
  idle_high_energy:{headX:1.6,headY:3.2,headPeriod:4.6,tailX:14,tailY:0,tailPeriod:2.8},
  idle_mid_energy:{headX:1.2,headY:2.5,headPeriod:6,tailX:7,tailY:0,tailPeriod:5},
  idle_low_energy:{headX:1.2,headY:1.8,headPeriod:8,tailX:3.5,tailY:.6,tailPeriod:7},
});
export function idleMotionSample(state,time,{disabled=false,touch={},reaction={}}={}){
  const p=IDLE_PROFILES[state];if(!p)throw new Error(`Unknown idle state: ${state}`);
  if(disabled)return {head:[0,0],tail:[0,0]};
  const t=Number.isFinite(time)?time:0,headPhase=t*2*Math.PI/p.headPeriod,tailPhase=t*2*Math.PI/p.tailPeriod;
  const tap=Number.isFinite(touch.nod)?clamp(touch.nod,-1,1):0;
  const tailTap=Number.isFinite(touch.tail)?clamp(touch.tail*8,-1,1):0;
  return {head:[p.headX*Math.sin(headPhase)+clamp(reaction.headX||0,-8,8)+clamp(reaction.headAngle||0,-.018,.018)*150,p.headY*clamp(Math.sin(headPhase-.45)+tap,-1,1)+clamp((reaction.headY||0)+(reaction.bounce||0),-10,10)],
    tail:[p.tailX*clamp(Math.sin(tailPhase)+tailTap,-1,1)+clamp(reaction.tail||0,-.08,.08)*240,p.tailY*clamp(Math.sin(tailPhase)*.8+tailTap,-1,1)]};
}
const canvas=(width,height)=>{const c=document.createElement('canvas');c.width=width;c.height=height;return c;};
async function loadImage(url){const image=new Image();image.src=url;await image.decode();return image;}
async function loadJson(url){const r=await fetch(url);if(!r.ok)throw new Error(`Missing idle asset: ${url}`);return r.json();}
function createProgram(gl){
  const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
  const v=shader(gl.VERTEX_SHADER,'attribute vec2 p;attribute vec2 uv;varying vec2 t;void main(){t=uv;gl_Position=vec4(p,0.,1.);}');
  const f=shader(gl.FRAGMENT_SHADER,`precision highp float;
    varying vec2 t;uniform sampler2D art;uniform sampler2D weights;uniform sampler2D eye;
    uniform vec2 headMotion;uniform vec2 tailMotion;uniform vec4 eyeBounds;uniform float blinkOnset;
    uniform vec2 artScale;uniform vec2 eyeScale;
    uniform vec3 extraTouch;uniform vec3 extraReaction;
    const vec2 size=vec2(2426.,2592.);
    ${EXTRA_DISPLACEMENT_GLSL}
    void main(){
      vec2 warped=t;
      // Compose the new smooth local field after the existing art rig. Keeping
      // these inversions separate preserves the approved zero-touch pixels.
      for(int i=0;i<5;i++){vec2 q=warped*size;warped=t-(extraObject(q,extraTouch)+extraCharacter(q,extraReaction))/size;}
      vec2 source=warped;
      // Invert a continuous, joint-pinned deformation of the approved artwork.
      // A single surface preserves alpha coverage across every internal join.
      for(int i=0;i<3;i++){vec2 w=texture2D(weights,source).rg;source=warped-(w.r*headMotion+w.g*tailMotion)/size;}
      if(source.x<0.||source.y<0.||source.x>1.||source.y>1.){gl_FragColor=vec4(0.);return;}
      vec4 color=texture2D(art,source*artScale);
      vec2 eyeUV=(source*size-eyeBounds.xy)/eyeBounds.zw;
      if(blinkOnset>0.&&eyeUV.x>=0.&&eyeUV.y>=0.&&eyeUV.x<=1.&&eyeUV.y<=1.){
        vec4 overlay=texture2D(eye,eyeUV*eyeScale)*blinkOnset;
        color=overlay+color*(1.-overlay.a);
      }
      gl_FragColor=color;
    }`);
  const program=gl.createProgram();gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);
  gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));return program;
}
async function createEyes(base,manifest){
  if(!manifest.blink.ready)return null;
  const records=manifest.blink.layers,geometry=await loadJson(base+manifest.blink.geometry);
  const recordsWithImages=await Promise.all(records.map(async item=>({...item,image:await loadImage(base+item.file)})));
  const item=id=>recordsWithImages.find(r=>r.id===id);
  const eyes=['R','L'].map((side,index)=>({side,skin:item(`${46+index}_eye_${side}_skin_base`),eye:item(`${48+index}_eye_${side}_stationary_eye`),lash:item(`${44+index}_eye_${side}_upperlash`),closed:item(`${42+index}_eye_${side}_closed`),keys:geometry.eyes[side].keyframes}));
  const bounds=[Math.min(...eyes.map(e=>e.skin.bounds[0])),Math.min(...eyes.map(e=>e.skin.bounds[1])),Math.max(...eyes.map(e=>e.skin.bounds[2])),Math.max(...eyes.map(e=>e.skin.bounds[3]))];
  const width=bounds[2]-bounds[0],height=bounds[3]-bounds[1],moving=canvas(width,height),closed=canvas(width,height),surface=canvas(width,height);
  const ctx=moving.getContext('2d'),out=surface.getContext('2d'),closedCtx=closed.getContext('2d');
  for(const e of eyes)closedCtx.drawImage(e.closed.image,e.closed.bounds[0]-bounds[0],e.closed.bounds[1]-bounds[1]);
  return {bounds,surface,paint(q){
    ctx.clearRect(0,0,width,height);
    for(const e of eyes){
      const [l,t,r,b]=e.skin.bounds,opened=e.keys[0],shut=e.keys.at(-1);
      ctx.drawImage(e.skin.image,l-bounds[0],t-bounds[1]);
      ctx.save();ctx.beginPath();
      for(let x=l;x<=r;x++){const y=(1-q)*interpolateCurve(opened.aperture_upper_9,x)+q*interpolateCurve(shut.aperture_upper_9,x);x===l?ctx.moveTo(x-bounds[0],y-bounds[1]):ctx.lineTo(x-bounds[0],y-bounds[1]);}
      for(let x=r;x>=l;x--){const y=(1-q**3)*interpolateCurve(opened.aperture_lower_9,x)+q**3*interpolateCurve(shut.aperture_lower_9,x);ctx.lineTo(x-bounds[0],y-bounds[1]);}
      ctx.closePath();ctx.clip();ctx.drawImage(e.eye.image,e.eye.bounds[0]-bounds[0],e.eye.bounds[1]-bounds[1]);ctx.restore();
      const [lx,ly]=e.lash.bounds;
      for(let x=0;x<e.lash.image.width;x++){const dy=q*interpolateCurve(shut.lash_dy_by_x,lx+x);ctx.drawImage(e.lash.image,x,0,1,e.lash.image.height,lx+x-bounds[0],ly+dy-bounds[1],1,e.lash.image.height);}
    }
    // Add premultiplied contributions. Source-over here would double the skin
    // coverage and darken feathered edges when switching to the closed endpoint.
    const endpoint=smooth((q-.86)/.14);out.clearRect(0,0,width,height);
    out.globalCompositeOperation='source-over';out.globalAlpha=1-endpoint;out.drawImage(moving,0,0);
    out.globalCompositeOperation='lighter';out.globalAlpha=endpoint;out.drawImage(closed,0,0);
    out.globalAlpha=1;out.globalCompositeOperation='source-over';
  }};
}

/** A programmatic weighted-art rig, not a fabricated Cubism model export. */
export async function createIdleRig(gl,state){
  if(!IDLE_STATES.includes(state))throw new Error(`Unknown idle state: ${state}`);
  const base=`/assets/idle/${state}/`,manifest=await loadJson(base+'manifest.json');
  if(manifest.state!==state||manifest.canvas[0]!==W||manifest.canvas[1]!==H)throw new Error('Idle rig manifest mismatch');
  const [art,weightImage,tailImage,eyes]=await Promise.all([loadImage(base+manifest.source.file),loadImage(base+manifest.weights.file),loadImage(base+manifest.tailHit.file),createEyes(base,manifest)]);
  const read=image=>{const c=canvas(image.width,image.height),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
  const weightPixels=read(weightImage),tailPixels=read(tailImage),tailBounds=manifest.tailHit.bounds;
  const textures=[],upload=image=>{const tex=gl.createTexture();textures.push(tex);gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);for(const parameter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.LINEAR);for(const parameter of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.CLAMP_TO_EDGE);return tex;};
  // WebGL 1 cannot mipmap NPOT textures. Pad the unchanged pixels to POT rather
  // than stretching or resaving the source. Premultiplied mip levels average
  // fine hair/alpha details when the pet is reduced to its small desktop size.
  const uploadMip=image=>{const width=2**Math.ceil(Math.log2(image.width)),height=2**Math.ceil(Math.log2(image.height)),padded=canvas(width,height);padded.getContext('2d').drawImage(image,0,0);const texture=upload(padded);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.generateMipmap(gl.TEXTURE_2D);return {texture,scale:[image.width/width,image.height/height],size:[width,height]};};
  const artMip=uploadMip(art),weightsTexture=upload(weightImage),eyeMip=uploadMip(eyes?.surface||canvas(1,1)),artTexture=artMip.texture,eyeTexture=eyeMip.texture;
  const program=createProgram(gl),buffer=gl.createBuffer(),p=gl.getAttribLocation(program,'p'),uv=gl.getAttribLocation(program,'uv');
  const uniforms=Object.fromEntries(['art','weights','eye','headMotion','tailMotion','eyeBounds','blinkOnset','artScale','eyeScale','extraTouch','extraReaction'].map(name=>[name,gl.getUniformLocation(program,name)]));
  let localTouch={},localReaction={};
  let lastQ=-1,sample=idleMotionSample(state,0,{disabled:true}),last={state,runtime:'weighted-art-runtime-v050',modelFormat:'programmatic-layer-rig',sourceUnchanged:true,blinkReady:Boolean(eyes),textureFilter:'premultiplied-pot-trilinear',artTextureSize:artMip.size,time:0,headMotion:[0,0],tailMotion:[0,0],blinkClosure:0};
  function weightAt(x,y,channel){
    const xx=clamp(x-.5,0,W-1),yy=clamp(y-.5,0,H-1),x0=Math.floor(xx),y0=Math.floor(yy),x1=Math.min(W-1,x0+1),y1=Math.min(H-1,y0+1),fx=xx-x0,fy=yy-y0;
    const at=(px,py)=>weightPixels[(py*W+px)*4+channel]/255;
    return (1-fy)*((1-fx)*at(x0,y0)+fx*at(x1,y0))+fy*((1-fx)*at(x0,y1)+fx*at(x1,y1));
  }
  function extraDisplacement(x,y){const o=extraObjectDisplacement(x,y,localTouch),r=extraCharacterDisplacement(x,y,localReaction);return [o[0]+r[0],o[1]+r[1]];}
  function displacement(x,y){const h=weightAt(x,y,0),t=weightAt(x,y,1),bx=x+h*sample.head[0]+t*sample.tail[0],by=y+h*sample.head[1]+t*sample.tail[1],d=extraDisplacement(bx,by);return [bx-x+d[0],by-y+d[1]];}
  function inversePoint(x,y){let bx=x,by=y;for(let n=0;n<5;n++){const d=extraDisplacement(bx,by);bx=x-d[0];by=y-d[1];}let sx=bx,sy=by;for(let n=0;n<3;n++){const h=weightAt(sx,sy,0),t=weightAt(sx,sy,1);sx=bx-h*sample.head[0]-t*sample.tail[0];sy=by-h*sample.head[1]-t*sample.tail[1];}return [sx,sy];}
  return {bounds:[0,0,W,H],manifest,
    draw({time=0,project,width,height,blinkClosure=0,touch={},disabled=false,reaction={}}){
      sample=idleMotionSample(state,time,{disabled,touch,reaction});const q=eyes?clamp(Number.isFinite(blinkClosure)?blinkClosure:0):0;
      localTouch=disabled?{}:{plant:clamp(touch.plant||0,-.035,.035),mascot:clamp(touch.mascot||0,-1,1),keyboard:clamp(touch.keyboard||0,0,1)};
      localReaction=disabled?{}:{hair:clamp(reaction.hair||0,-10,10),ahoge:clamp(reaction.ahoge||0,-15,15),ear:clamp(reaction.ear||0,-.025,.025)};
      if(eyes&&q>0&&q!==lastQ){eyes.paint(q);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,eyeTexture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,eyes.surface);gl.generateMipmap(gl.TEXTURE_2D);lastQ=q;}
      const point=(x,y)=>{const a=project(x,y);return [a[0]/width*2-1,1-a[1]/height*2];};
      const a=point(0,0),b=point(0,H),c=point(W,0),d=point(W,H);
      gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([...a,0,0,...b,0,1,...c,1,0,...d,1,1]),gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,16,8);
      for(const [unit,tex,name] of [[0,artTexture,'art'],[1,weightsTexture,'weights'],[2,eyeTexture,'eye']]){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(uniforms[name],unit);}
      gl.uniform2fv(uniforms.headMotion,sample.head);gl.uniform2fv(uniforms.tailMotion,sample.tail);
      gl.uniform3f(uniforms.extraTouch,localTouch.plant||0,localTouch.mascot||0,localTouch.keyboard||0);
      gl.uniform3f(uniforms.extraReaction,localReaction.hair||0,localReaction.ahoge||0,localReaction.ear||0);
      gl.uniform2fv(uniforms.artScale,artMip.scale);gl.uniform2fv(uniforms.eyeScale,eyeMip.scale);
      const eb=eyes?.bounds||[0,0,1,1];gl.uniform4f(uniforms.eyeBounds,eb[0],eb[1],eb[2]-eb[0],eb[3]-eb[1]);gl.uniform1f(uniforms.blinkOnset,smooth(q/.06));
      gl.disable(gl.CULL_FACE);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.STENCIL_TEST);gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.disableVertexAttribArray(p);gl.disableVertexAttribArray(uv);
      for(let unit=0;unit<3;unit++){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,null);}gl.activeTexture(gl.TEXTURE0);
      last={...last,time,headMotion:[...sample.head],tailMotion:[...sample.tail],extraTouch:{...localTouch},reactionChannels:{...localReaction},blinkClosure:q,disabled:Boolean(disabled),fixedContact:true};
    },
    hitTestTail(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))return false;const [sx,sy]=inversePoint(x,y),px=Math.floor(sx-tailBounds[0]),py=Math.floor(sy-tailBounds[1]);return px>=0&&py>=0&&px<tailImage.width&&py<tailImage.height&&tailPixels[(py*tailImage.width+px)*4+3]>128;},
    // Exposed for exact overlay alignment and backend QA, not user controls.
    inversePoint,
    followPoint(x,y){const d=displacement(x,y);return [x+d[0],y+d[1]];},
    evidence(){return {...last};},
    release(){for(const t of textures)gl.deleteTexture(t);gl.deleteBuffer(buffer);gl.deleteProgram(program);},
  };
}
