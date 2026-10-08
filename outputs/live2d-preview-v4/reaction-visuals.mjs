// Short, registered expression and fist patches for the affection animations.
// This is a runtime art rig, not an exported Cubism model. The source scene,
// head silhouette, hair ornament, furniture and full body are never replaced.
const W=2426,H=2592;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:0));
const smooth=v=>{v=clamp(v);return v*v*(3-2*v);};
const POSES=['angry','shy','affectionate','sleep'];
export const REACTION_PATCH_BOUNDS=Object.freeze({face:[1050,570,1580,1025],hand:[930,1290,1255,1530]});
const FACE_LAYERS=[
  ['12_face.png',1078,577],['15_eye_R.png',1076,778],['16_eye_L.png',1410,662],
  ['17_brow_R.png',1154,708],['18_brow_L.png',1396,606],['19_mouth.png',1372,908],
];
const HAND_POLYGON=[[953,1358],[1028,1328],[1100,1322],[1177,1360],[1213,1432],
  [1212,1492],[1162,1513],[1042,1490],[965,1432]];
const surface=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const loadImage=async path=>{const image=new Image();image.src=path;await image.decode();return image;};

/** Smooth entering/leaving poses, including deterministic QA samples. */
export function reactionOpacity(reaction){
  if(!reaction?.active||!POSES.includes(reaction.record?.pose))return 0;
  if(reaction.record.pose==='sleep')return 1;
  const p=clamp(reaction.progress);
  return smooth(p/.075)*(1-smooth((p-.82)/.18));
}

/** Bounded hand movement, pinned at the sleeve and desk contact edge. */
export function reactionHandPoint(x,y,channels={}){
  const wx=smooth((x-973)/67)*(1-smooth((x-1182)/51));
  const wy=smooth((y-1300)/90)*(1-smooth((y-1453)/58));
  const weight=wx*wy,angle=clamp(channels.handAngle,-.08,.08)*weight;
  const dy=clamp(channels.handY,-30,12)*weight,dx=x-995,py=y-1364;
  return [995+dx*Math.cos(angle)-py*Math.sin(angle),1364+dx*Math.sin(angle)+py*Math.cos(angle)+dy];
}

async function faceMask(){
  const bounds=REACTION_PATCH_BOUNDS.face,c=surface(bounds[2]-bounds[0],bounds[3]-bounds[1]);
  const ctx=c.getContext('2d',{willReadFrequently:true});
  const layers=await Promise.all(FACE_LAYERS.map(async ([file,x,y])=>({image:await loadImage('/assets/source-layers/'+file),x,y})));
  for(const layer of layers)ctx.drawImage(layer.image,layer.x-bounds[0],layer.y-bounds[1]);
  // Keep the actual facial silhouette. Erode the generated replacement a few
  // pixels so the approved jaw line and bordering hair remain authoritative.
  const pixels=ctx.getImageData(0,0,c.width,c.height),src=pixels.data.slice(),w=c.width,h=c.height;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let a=255;
    for(const [dx,dy] of [[0,0],[-3,0],[3,0],[0,-3],[0,3],[-2,-2],[2,-2],[-2,2],[2,2]]){
      const xx=x+dx,yy=y+dy;a=Math.min(a,xx<0||yy<0||xx>=w||yy>=h?0:src[(yy*w+xx)*4+3]);
    }
    const i=(y*w+x)*4;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=255;pixels.data[i+3]=a;
  }
  ctx.putImageData(pixels,0,0);
  // Thin eyebrows / lash tips must be completely replaced when closed. Their
  // alpha footprints are dilated separately after the jaw-edge erosion;
  // eroding them with the face would leave little open-eye fragments behind.
  ctx.globalCompositeOperation='source-over';
  for(const layer of layers.slice(1))for(const [dx,dy] of [[0,0],[-5,0],[5,0],[0,-5],[0,5],[-4,-4],[4,-4],[-4,4],[4,4]]){
    ctx.drawImage(layer.image,layer.x-bounds[0]+dx,layer.y-bounds[1]+dy);
  }
  // Closed lashes extend below/outside the old open-eye footprint. Cover their
  // complete sweep, including the sparse brow strokes drawn over front hair.
  const features=[
    [[1060,824],[1092,782],[1153,750],[1264,747],[1304,795],[1303,907],[1267,943],[1130,948],[1050,920]],
    [[1391,663],[1411,639],[1497,641],[1556,667],[1580,708],[1580,844],[1494,861],[1401,830],[1384,760]],
    [[1138,700],[1268,698],[1276,769],[1136,771]],
    [[1378,593],[1490,594],[1491,646],[1377,646]],
  ];
  ctx.fillStyle='white';
  for(const polygon of features){ctx.beginPath();polygon.forEach(([x,y],i)=>i?ctx.lineTo(x-bounds[0],y-bounds[1]):ctx.moveTo(x-bounds[0],y-bounds[1]));ctx.closePath();ctx.fill();}
  const softened=surface(w,h),out=softened.getContext('2d');out.filter='blur(2px)';out.drawImage(c,0,0);return softened;
}
async function protectIdleContact(mask,state){
  const b=REACTION_PATCH_BOUNDS.face,w=mask.width,h=mask.height;
  const hand=await loadImage(`/assets/reactions/${state}-support.png`);
  const output=surface(w,h),ctx=output.getContext('2d');ctx.drawImage(mask,0,0);
  // Use the exact semantic hand alpha, not its broad deformation weight: the
  // latter also pins the mouth and would retain a smiling mouth during anger.
  ctx.globalCompositeOperation='destination-out';
  for(const [dx,dy] of [[0,0],[-2,0],[2,0],[0,-2],[0,2]])ctx.drawImage(hand,1394-b[0]+dx,888-b[1]+dy);
  return output;
}
function handMask(){
  const b=REACTION_PATCH_BOUNDS.hand,c=surface(b[2]-b[0],b[3]-b[1]),ctx=c.getContext('2d');
  ctx.translate(-b[0],-b[1]);ctx.fillStyle='white';ctx.beginPath();
  HAND_POLYGON.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();
  const soft=surface(c.width,c.height),out=soft.getContext('2d');out.filter='blur(3px)';out.drawImage(c,0,0);return soft;
}

/**
 * options.assets may override one pose with {file,crop:[x,y,w,h],registration:
 * [a,b,c,d,e,f]}. Registration maps approved art coordinates to source art
 * coordinates before dividing by crop. faceRegistration/handRegistration can
 * independently register those areas if an image edit drifted locally.
 * Default assets are full-frame 2426x2592
 * compositions, optionally downsampled uniformly by the image generator.
 * Caller saves/restores its Cubism renderer GL profile around draw().
 */
export async function createReactionVisuals(gl,options={}){
  const definitions=Object.fromEntries(POSES.map(pose=>[pose,{
    file:`/assets/reactions/${pose}.png`,crop:[0,0,W,H],registration:[1,0,0,1,0,0],
    ...options.assets?.[pose],
  }]));
  const loaded=await Promise.all(POSES.map(async pose=>({pose,image:await loadImage(definitions[pose].file)})));
  const masks=await Promise.all([faceMask(),Promise.resolve(handMask())]);
  const idleMasks=await Promise.all(['idle_high_energy','idle_mid_energy','idle_low_energy'].map(async state=>[state,await protectIdleContact(masks[0],state)]));
  const shaders=[],textures=[];
  function shader(kind,source){const s=gl.createShader(kind);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));shaders.push(s);return s;}
  const program=gl.createProgram();
  gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 p;attribute vec2 uv;varying vec2 t;void main(){t=uv;gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`
    precision highp float;varying vec2 t;
    uniform sampler2D art;uniform sampler2D coverage;uniform sampler2D scene;
    uniform vec2 screenSize;uniform vec4 bounds;uniform vec4 sourceCrop;
    uniform mat3 registration;uniform vec2 hand;uniform float isHand;uniform float opacity;
    float weight(vec2 p){return smoothstep(973.,1040.,p.x)*(1.-smoothstep(1182.,1233.,p.x))*smoothstep(1300.,1390.,p.y)*(1.-smoothstep(1453.,1511.,p.y));}
    vec2 forwardHand(vec2 p){float w=weight(p),angle=hand.y*w;vec2 o=p-vec2(995.,1364.);return vec2(995.,1364.)+vec2(o.x*cos(angle)-o.y*sin(angle),o.x*sin(angle)+o.y*cos(angle))+vec2(0.,hand.x*w);}
    void main(){
      vec2 target=bounds.xy+t*bounds.zw,at=target;
      if(isHand>.5){for(int i=0;i<5;i++)at=target-(forwardHand(at)-at);}
      vec2 source=(registration*vec3(at,1.)).xy;
      vec4 patch=texture2D(art,(source-sourceCrop.xy)/sourceCrop.zw);
      float a=texture2D(coverage,t).a*opacity;
      // Premultiplied single-pass replacement never leaves old iris/finger
      // ghosts and avoids the MSAA holes caused by erase/add operations.
      gl_FragColor=mix(texture2D(scene,gl_FragCoord.xy/screenSize),patch,a);
    }`));
  gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
  function upload(image){const tex=gl.createTexture();textures.push(tex);gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR);for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);return tex;}
  const art=Object.fromEntries(loaded.map(({pose,image})=>[pose,upload(image)]));
  const coverage={face:upload(masks[0]),hand:upload(masks[1]),...Object.fromEntries(idleMasks.map(([state,mask])=>[state,upload(mask)]))},scene=gl.createTexture();textures.push(scene);
  const buffer=gl.createBuffer(),p=gl.getAttribLocation(program,'p'),uv=gl.getAttribLocation(program,'uv');
  const uniforms=Object.fromEntries(['art','coverage','scene','screenSize','bounds','sourceCrop','registration','hand','isHand','opacity'].map(n=>[n,gl.getUniformLocation(program,n)]));
  let sceneWidth=0,sceneHeight=0,last={ready:true,active:false,pose:null,patches:[],profile:'registered-affection-patches-v0412'};
  function drawPatch(kind,{reaction,project,follow,width,height,state},opacity){
    const pose=reaction.record.pose,b=REACTION_PATCH_BOUNDS[kind],definition=definitions[pose],c=reaction.channels||{};
    const point=(x,y)=>{const moved=kind==='face'?follow('ArtMesh28',x,y):[x,y];const [px,py]=project(...moved);return [px/width*2-1,1-py/height*2];};
    const a=point(b[0],b[1]),bb=point(b[0],b[3]),cc=point(b[2],b[1]),d=point(b[2],b[3]);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,scene);
    if(sceneWidth!==gl.drawingBufferWidth||sceneHeight!==gl.drawingBufferHeight){
      sceneWidth=gl.drawingBufferWidth;sceneHeight=gl.drawingBufferHeight;
      gl.copyTexImage2D(gl.TEXTURE_2D,0,gl.RGBA,0,0,sceneWidth,sceneHeight,0);
      for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);
      for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);
    }else gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,sceneWidth,sceneHeight);
    gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([...a,0,0,...bb,0,1,...cc,1,0,...d,1,1]),gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,16,8);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,art[pose]);gl.uniform1i(uniforms.art,0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,kind==='face'?(coverage[state]||coverage.face):coverage.hand);gl.uniform1i(uniforms.coverage,1);
    gl.uniform1i(uniforms.scene,2);gl.uniform2f(uniforms.screenSize,sceneWidth,sceneHeight);
    gl.uniform4f(uniforms.bounds,b[0],b[1],b[2]-b[0],b[3]-b[1]);gl.uniform4fv(uniforms.sourceCrop,definition.crop);
    const [ra,rb,rc,rd,re,rf]=definition[kind+'Registration']||definition.registration;gl.uniformMatrix3fv(uniforms.registration,false,new Float32Array([ra,rb,0,rc,rd,0,re,rf,1]));
    gl.uniform2f(uniforms.hand,clamp(c.handY,-30,12),clamp(c.handAngle,-.08,.08));gl.uniform1f(uniforms.isHand,kind==='hand'?1:0);gl.uniform1f(uniforms.opacity,opacity);
    gl.disable(gl.CULL_FACE);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.disableVertexAttribArray(p);gl.disableVertexAttribArray(uv);
  }
  return {
    draw(args){
      const opacity=reactionOpacity(args.reaction);last={...last,active:opacity>0,pose:args.reaction?.record?.pose||null,opacity,patches:[]};
      if(opacity<=0)return;
      const follow=args.follow||((_mesh,x,y)=>[x,y]),argumentsWithFollow={...args,follow};
      // Cubism's profile does not preserve TEXTURE2; restore its previous
      // binding explicitly because the framebuffer-copy sampler uses that unit.
      gl.activeTexture(gl.TEXTURE2);const previous=gl.getParameter(gl.TEXTURE_BINDING_2D);
      try{
        drawPatch('face',argumentsWithFollow,opacity);last.patches.push('face');
        const pose=args.reaction.record.pose,c=args.reaction.channels||{};
        if(pose==='angry'||(pose!=='sleep'&&(Math.abs(c.handY||0)>.001||Math.abs(c.handAngle||0)>.00001))){
          drawPatch('hand',argumentsWithFollow,opacity);last.patches.push(pose==='angry'?'pinned-fist':'pinned-hand');
        }
      }finally{gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,previous);gl.activeTexture(gl.TEXTURE0);}
    },
    drawOverlay,
    evidence(){return {...last,patches:[...last.patches],assets:POSES.map(pose=>({pose,file:definitions[pose].file}))};},
    release(){for(const t of textures)gl.deleteTexture(t);for(const s of shaders)gl.deleteShader(s);gl.deleteBuffer(buffer);gl.deleteProgram(program);},
  };
}

function heart(ctx,x,y,size,angle=0){
  ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.beginPath();ctx.moveTo(0,size*.32);
  ctx.bezierCurveTo(-size*.95,-size*.25,-size*.7,-size*.9,0,-size*.38);
  ctx.bezierCurveTo(size*.7,-size*.9,size*.95,-size*.25,0,size*.32);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}
function sparkle(ctx,x,y,r){ctx.beginPath();ctx.moveTo(x,y-r);ctx.quadraticCurveTo(x+r*.15,y-r*.15,x+r,y);ctx.quadraticCurveTo(x+r*.15,y+r*.15,x,y+r);ctx.quadraticCurveTo(x-r*.15,y+r*.15,x-r,y);ctx.quadraticCurveTo(x-r*.15,y-r*.15,x,y-r);ctx.fill();ctx.stroke();}

/** Editable vector accents accompany real face, hand, head, tail and leg rigs. */
export function drawOverlay(ctx,{reaction,project,follow=(_mesh,x,y)=>[x,y],width,height,time=0,mirrored=false}){
  const opacity=reactionOpacity(reaction);if(!ctx||opacity<=0)return;
  const c=reaction.channels||{},pose=reaction.record.pose,t=Number.isFinite(time)?time:0;
  const point=(x,y)=>project(...follow('ArtMesh28',x,y));
  const scale=Math.max(.8,Math.min(2.4,width/400)),unit=Math.max(3,8*width/540);
  ctx.save();ctx.globalAlpha=opacity;ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=1.15*scale;
  if(pose==='angry'){
    const [x,y]=point(1580,550),r=unit*(1+.12*Math.sin(t*12)),anger=clamp(c.anger||.5);
    ctx.globalAlpha=opacity*(.45+.55*anger);ctx.strokeStyle='#ff91b1';ctx.shadowColor='#fff4fa';ctx.shadowBlur=3;
    for(let turn=0;turn<4;turn++){
      ctx.save();ctx.translate(x,y);ctx.rotate(turn*Math.PI/2+.08*Math.sin(t*9));
      ctx.beginPath();ctx.moveTo(-r*.25,-r);ctx.lineTo(-r*.25,-r*.42);ctx.quadraticCurveTo(-r*.25,-r*.25,-r*.42,-r*.25);ctx.lineTo(-r,-r*.25);ctx.stroke();ctx.restore();
    }
  }else if(pose==='shy'){
    const blush=clamp(c.blush||.45),[x,y]=point(1568,578),r=unit*.72;
    ctx.strokeStyle='#e9a3c9';ctx.fillStyle='#fff5fb';ctx.globalAlpha=opacity*(.5+.5*blush);
    sparkle(ctx,x+Math.sin(t*2.3)*unit*.4,y-Math.sin(t*1.5)*unit*.8,r);
    for(const [cx,cy] of [[1197,930],[1500,874]]){
      const [px,py]=point(cx,cy),s=unit*.32;
      ctx.strokeStyle='#eb87ae';ctx.globalAlpha=opacity*blush*.58;
      for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(px+i*s-s*.2,py-s*.2);ctx.lineTo(px+i*s+s*.18,py+s*.38);ctx.stroke();}
    }
  }else if(pose==='sleep'){
    const [x,y]=point(1610,600);ctx.strokeStyle='#e4cdff';ctx.shadowColor='#fff7ff';ctx.shadowBlur=2;
    for(let i=0;i<3;i++){
      const age=(t*.18+i*.28)%1,r=unit*(.5+.23*i),xx=x+unit*i*.92,yy=y-unit*i*1.1-unit*age;
      ctx.save();if(mirrored){ctx.translate(xx*2,0);ctx.scale(-1,1);}
      ctx.globalAlpha=opacity*(.4+.5*Math.sin(Math.PI*age));ctx.beginPath();
      ctx.moveTo(xx-r*.4,yy-r*.4);ctx.lineTo(xx+r*.4,yy-r*.4);ctx.lineTo(xx-r*.4,yy+r*.4);ctx.lineTo(xx+r*.4,yy+r*.4);ctx.stroke();
      ctx.restore();
    }
  }else{
    const hearts=clamp(c.hearts||.5),[x,y]=point(1622,650);
    for(let i=0;i<3;i++){
      const age=((reaction.progress*1.8+i*.29)%1),rise=unit*(1.2+3.6*age);
      ctx.globalAlpha=opacity*hearts*Math.sin(Math.PI*age)*.9;
      ctx.fillStyle=i%2?'#e8c4ff':'#ffaaca';ctx.strokeStyle='#fff6fd';
      heart(ctx,x+(i-1)*unit*1.25+Math.sin(t*2+i)*unit*.22,y-rise,unit*(.65+.14*i),Math.sin(t+i)*.15);
    }
  }
  ctx.restore();
}
