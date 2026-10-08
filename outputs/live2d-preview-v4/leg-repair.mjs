// Local artwork correction, generated from the approved original. The rest of
// the model keeps its original textures and rig. The correction mask stays
// stationary while a bounded inverse warp adds gentle motion below the knees.
import {legMotionSample,legHitTest,LEG_MOTION_PROFILE,LEG_WARP_GLSL} from './leg-motion.mjs';
const REGION=[[980,1820],[1440,1770],[1500,1930],[1580,2080],[1720,2280],[1780,2420],[1770,2530],[1390,2540],[1320,2440],[1300,2260],[1190,2150],[1140,1990],[1080,1920],[970,1880]];
export function createLegRepair(gl){return createArtworkPatch(gl,'/assets/legs-corrected.png',REGION,[940,1740,1820,2580],true);}
// The original rough split accidentally included pieces of the chair emblem in
// both hair layers. Restore this stationary area from the exact approved image.
export function createChairLogoRepair(gl){return createArtworkPatch(gl,'/assets/reference-working.png',[[545,585],[671,585],[718,617],[736,655],[750,690],[744,747],[718,807],[551,807]],[530,570,770,825]);}
async function createArtworkPatch(gl,source,region,bounds,movingLegs=false){
  const image=new Image();image.src=source;await image.decode();
  let lastMotion={front:0,back:0},alphaAt=()=>0;
  if(movingLegs){
    const pixels=document.createElement('canvas');pixels.width=image.naturalWidth;pixels.height=image.naturalHeight;
    const pixelContext=pixels.getContext('2d',{willReadFrequently:true});pixelContext.drawImage(image,0,0);
    const rgba=pixelContext.getImageData(0,0,pixels.width,pixels.height).data;
    const alpha=new Uint8Array(pixels.width*pixels.height);for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];
    const imageWidth=pixels.width,imageHeight=pixels.height;
    alphaAt=(x,y)=>{
      const px=Math.floor(x/2426*imageWidth),py=Math.floor(y/2592*imageHeight);
      return px>=0&&py>=0&&px<imageWidth&&py<imageHeight?alpha[py*imageWidth+px]:0;
    };
  }
  const mask=document.createElement('canvas');mask.width=1024;mask.height=1024;
  const ctx=mask.getContext('2d');
  ctx.scale(1024/(bounds[2]-bounds[0]),1024/(bounds[3]-bounds[1]));ctx.translate(-bounds[0],-bounds[1]);
  ctx.fillStyle='white';ctx.shadowColor='white';ctx.shadowBlur=3;
  ctx.beginPath();region.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();
  const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
  const vertex=shader(gl.VERTEX_SHADER,'attribute vec2 p;attribute vec2 uv;varying vec2 t;void main(){t=uv;gl_Position=vec4(p,0.,1.);}');
  const fragment=shader(gl.FRAGMENT_SHADER,`precision highp float;varying vec2 t;uniform sampler2D art;uniform sampler2D coverage;uniform sampler2D scene;uniform vec2 size;uniform vec4 region;${LEG_WARP_GLSL}void main(){float a=texture2D(coverage,t).a;vec2 at=legInverse(region.xy+t*region.zw)/vec2(2426.,2592.);gl_FragColor=mix(texture2D(scene,gl_FragCoord.xy/size),texture2D(art,at),a);}`);
  const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
  const upload=source=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;};
  const art=upload(image),coverage=upload(mask),buffer=gl.createBuffer(),p=gl.getAttribLocation(program,'p'),uv=gl.getAttribLocation(program,'uv');
  const uniforms=Object.fromEntries(['art','coverage','scene','size','region','legAngles'].map(n=>[n,gl.getUniformLocation(program,n)]));
  const scene=gl.createTexture();let sceneWidth=0,sceneHeight=0;
  return {region,motionProfile:movingLegs?LEG_MOTION_PROFILE:null,
  get motionSample(){return {...lastMotion};},
  hitTest(x,y){return movingLegs&&legHitTest(x,y,lastMotion,alphaAt);},
  draw(project,width,height,options={}){
    const motion=movingLegs?legMotionSample(options.time??0,options):{front:0,back:0};
    lastMotion=motion;
    const a=project(bounds[0],bounds[1]),b=project(bounds[2],bounds[3]);
    gl.activeTexture(gl.TEXTURE2);const previousScene=gl.getParameter(gl.TEXTURE_BINDING_2D);gl.bindTexture(gl.TEXTURE_2D,scene);
    if(sceneWidth!==gl.drawingBufferWidth||sceneHeight!==gl.drawingBufferHeight){
      sceneWidth=gl.drawingBufferWidth;sceneHeight=gl.drawingBufferHeight;
      gl.copyTexImage2D(gl.TEXTURE_2D,0,gl.RGBA,0,0,sceneWidth,sceneHeight,0);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    }else gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,sceneWidth,sceneHeight);
    const x1=a[0]/width*2-1,y1=1-a[1]/height*2,x2=b[0]/width*2-1,y2=1-b[1]/height*2;
    gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([x1,y1,0,0,x1,y2,0,1,x2,y1,1,0,x2,y2,1,1]),gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,16,8);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,art);gl.uniform1i(uniforms.art,0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,coverage);gl.uniform1i(uniforms.coverage,1);
    gl.uniform1i(uniforms.scene,2);gl.uniform2f(uniforms.size,sceneWidth,sceneHeight);
    gl.uniform4f(uniforms.region,bounds[0],bounds[1],bounds[2]-bounds[0],bounds[3]-bounds[1]);
    gl.uniform2f(uniforms.legAngles,motion.front,motion.back);
    gl.disable(gl.CULL_FACE);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.BLEND);
    // Resolve the old framebuffer once and blend premultiplied colours in one
    // pass. Separate erase/add passes cause MSAA pinholes on soft mask edges.
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,previousScene);
    gl.disableVertexAttribArray(p);gl.disableVertexAttribArray(uv);gl.activeTexture(gl.TEXTURE0);
  }};
}
