const W=2426,H=2592,TAU=Math.PI*2;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:0));
const smooth=(a,b,x)=>{const p=clamp((x-a)/(b-a));return p*p*(3-2*p);};
const ellipse=(x,y,cx,cy,rx,ry)=>Math.max(0,1-((x-cx)/rx)**2-((y-cy)/ry)**2)**2;
export const EXTRA_TOUCH_TARGETS=Object.freeze([
  {id:'head',kind:'character',label:'摸摸头发'}, {id:'horn',kind:'character',label:'轻碰龙角'},
  {id:'cheek',kind:'character',label:'轻戳脸颊'}, {id:'hand',kind:'character',label:'轻碰手背'},
  {id:'cup',kind:'object',label:'点点水杯',duration:2.2,text:'叮～水面泛起小星星啦。'},
  {id:'plant',kind:'object',label:'碰碰小植物',duration:2.4,text:'叶子摇摇，也在向你问好～'},
  {id:'mascot',kind:'object',label:'戳戳小龙摆件',duration:1.8,text:'小龙扑棱扑棱，陪我一起加油！'},
  {id:'keyboard',kind:'object',label:'敲敲键盘',duration:1.15,text:'哒哒哒，认真记下来啦～'},
]);
const OBJECTS=EXTRA_TOUCH_TARGETS.filter(t=>t.kind==='object');
export function sampleExtraTouch(id,age){
  const record=OBJECTS.find(t=>t.id===id);
  if(!record||!Number.isFinite(age)||age<=0||age>=record.duration)return 0;
  const p=age/record.duration,envelope=Math.sin(Math.PI*p)**2;
  if(id==='cup')return p;
  if(id==='plant')return .035*envelope*Math.sin(TAU*2.1*p);
  if(id==='mascot')return envelope*Math.sin(TAU*2.2*p);
  return envelope*(.25+.75*Math.sin(7*Math.PI*p)**2);
}
export function createExtraTouchController(){
  const active=new Map();let last=null;
  return {trigger(id,time){const item=OBJECTS.find(t=>t.id===id);if(!item||!Number.isFinite(time))return false;
      if(active.has(id)&&time-active.get(id)<item.duration)return false;
      active.set(id,time);last={id,time};return true;},
    sample(time){const values={plant:0,mascot:0,keyboard:0,cup:0},playing=[];
      for(const [id,start] of active){const item=OBJECTS.find(t=>t.id===id),age=time-start;
        if(age>=item.duration){active.delete(id);continue;}
        values[id]=sampleExtraTouch(id,age);playing.push(id);
      }return {values,playing,last};},
    clear(){active.clear();last=null;}};
}

// Smooth compact fields return to exactly zero at every attachment. The idle
// single-surface inverse warp uses these same fields, so no new art is painted.
export function extraObjectDisplacement(x,y,touch={}){
  const plant=clamp(touch.plant,-.035,.035),mascot=clamp(touch.mascot,-1,1),keyboard=clamp(touch.keyboard);
  const pw=ellipse(x,y,2150,1270,295,215)*(1-smooth(1390,1450,y));
  const mw=ellipse(x,y,1821,1510,211,133)*(1-smooth(1574,1630,y));
  const wings=smooth(65,155,Math.abs(x-1821));
  const kw=ellipse(x,y,1520,1414,285,81);
  return [plant*(1450-y)*pw+mascot*5*Math.sign(x-1821)*wings*mw,
    (-6*Math.abs(mascot)-mascot*7*wings)*mw+keyboard*3*kw];
}
export function extraCharacterDisplacement(x,y,reaction={}){
  const hair=clamp(reaction.hair,-10,10),ahoge=clamp(reaction.ahoge,-15,15),ear=clamp(reaction.ear,-.025,.025);
  // Hair tips and ahoge move independently; compact support excludes horns,
  // eyes, mouth, desk contacts and the supporting hand in all idle states.
  const hw=ellipse(x,y,804,1110,265,275)*smooth(1000,1120,y)+ellipse(x,y,1684,1100,142,250)*smooth(900,1020,y);
  const aw=ellipse(x,y,1152,119,178,189)*(1-smooth(1232,1288,x))*(1-smooth(235,320,y));
  const left=ellipse(x,y,962,963,92,53),right=ellipse(x,y,1654,758,59,49);
  return [hair*hw+ahoge*aw+ear*(y-973)*left-ear*(y-790)*right,
    ear*(x-1020)*left-ear*(x-1615)*right];
}
export const EXTRA_DISPLACEMENT_GLSL=`
  float extraEllipse(vec2 q,vec2 c,vec2 radius){vec2 n=(q-c)/radius;float w=max(0.,1.-dot(n,n));return w*w;}
  vec2 extraObject(vec2 q,vec3 touch){
    float pw=extraEllipse(q,vec2(2150.,1270.),vec2(295.,215.))*(1.-smoothstep(1390.,1450.,q.y));
    float mw=extraEllipse(q,vec2(1821.,1510.),vec2(211.,133.))*(1.-smoothstep(1574.,1630.,q.y));
    float wings=smoothstep(65.,155.,abs(q.x-1821.));
    float kw=extraEllipse(q,vec2(1520.,1414.),vec2(285.,81.));
    return vec2(touch.x*(1450.-q.y)*pw+touch.y*5.*sign(q.x-1821.)*wings*mw,(-6.*abs(touch.y)-touch.y*7.*wings)*mw+touch.z*3.*kw);
  }
  vec2 extraCharacter(vec2 q,vec3 reaction){
    float hw=extraEllipse(q,vec2(804.,1110.),vec2(265.,275.))*smoothstep(1000.,1120.,q.y)+extraEllipse(q,vec2(1684.,1100.),vec2(142.,250.))*smoothstep(900.,1020.,q.y);
    float aw=extraEllipse(q,vec2(1152.,119.),vec2(178.,189.))*(1.-smoothstep(1232.,1288.,q.x))*(1.-smoothstep(235.,320.,q.y));
    float l=extraEllipse(q,vec2(962.,963.),vec2(92.,53.)),r=extraEllipse(q,vec2(1654.,758.),vec2(59.,49.));
    return vec2(reaction.x*hw+reaction.y*aw+reaction.z*(q.y-973.)*l-reaction.z*(q.y-790.)*r,reaction.z*(q.x-1020.)*l-reaction.z*(q.x-1615.)*r);
  }
`;

const eyeHoles=[[1177,840,155,128],[1482,737,132,132]];
const rect=(x,y,a)=>x>=a[0]&&y>=a[1]&&x<=a[2]&&y<=a[3];
const poly=(x,y,points)=>{let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
  const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
}return inside;};
const ZONES=[
  {id:'horn',meshes:['ArtMesh31','ArtMesh32'],polygons:[[[786,45],[900,105],[901,220],[955,386],[970,490],[919,549],[803,529],[714,380],[731,186]],[[1288,120],[1427,170],[1510,237],[1577,344],[1609,481],[1554,447],[1474,317],[1364,242]]]},
  {id:'hand',meshes:['ArtMesh9'],polygons:[[[970,1387],[1014,1351],[1064,1347],[1145,1384],[1182,1450],[1132,1452],[1088,1417],[1054,1412],[1072,1449],[1014,1426]]]},
  {id:'hand',idleOnly:true,meshes:['ArtMesh12'],polygons:[[[1411,955],[1457,926],[1492,909],[1541,916],[1561,958],[1534,1000],[1481,1042],[1461,1101],[1435,1086]]]},
  {id:'hand',workingOnly:true,meshes:['ArtMesh12','ArtMesh8','ArtMesh6','ArtMesh7'],polygons:[[[1590,1335],[1602,1292],[1673,1289],[1735,1320],[1764,1380],[1712,1375],[1661,1340]]]},
  {id:'cheek',meshes:['ArtMesh28'],polygons:[[[1218,918],[1263,885],[1311,872],[1340,913],[1315,958],[1250,963]],[[1450,842],[1504,815],[1542,835],[1528,890],[1470,911],[1427,885]]]},
  {id:'head',meshes:['ArtMesh33','ArtMesh34','ArtMesh35'],polygons:[[[948,301],[1081,225],[1243,228],[1393,283],[1481,381],[1480,535],[1348,636],[1308,724],[1261,693],[1258,516],[1103,513],[982,414]],[[1052,19],[1175,0],[1267,84],[1305,166],[1268,240],[1209,205],[1173,126],[1043,90]]]},
  {id:'cup',meshes:['ArtMesh2'],bounds:[714,1355,930,1690]},
  {id:'plant',meshes:['ArtMesh0'],bounds:[1888,1123,2416,1638]},
  {id:'mascot',meshes:['ArtMesh1'],bounds:[1638,1427,2013,1636]},
  {id:'keyboard',meshes:['ArtMesh11'],polygons:[[[1243,1418],[1378,1380],[1773,1357],[1827,1398],[1775,1463],[1357,1500],[1252,1473]]]},
];
export function pickExtraTouch(x,y,{state='working_thinking',inversePoint=(x,y)=>[x,y],workingInverse=(_id,x,y)=>[x,y],alphaAt=()=>0,maskAt}={}){
  if(![x,y].every(Number.isFinite)||state==='sleep_mode')return null;
  const working=state==='working_thinking';
  if(!working&&!['idle_high_energy','idle_mid_energy','idle_low_energy'].includes(state))return null;
  for(const zone of ZONES){
    if(zone.idleOnly&&working||zone.workingOnly&&!working)continue;
    for(const mesh of zone.meshes){
      const [sx,sy]=working?workingInverse(mesh,x,y):inversePoint(x,y);
      if(![sx,sy].every(Number.isFinite)||alphaAt(sx,sy)<=128)continue;
      if(zone.id==='head'||zone.id==='cheek')if(eyeHoles.some(([cx,cy,rx,ry])=>((sx-cx)/rx)**2+((sy-cy)/ry)**2<1))continue;
      if(zone.bounds?!rect(sx,sy,zone.bounds):!zone.polygons.some(p=>poly(sx,sy,p)))continue;
      if(working&&maskAt&&maskAt(mesh,sx,sy)<=128)continue;
      return EXTRA_TOUCH_TARGETS.find(t=>t.id===zone.id);
    }
  }return null;
}
export async function createExtraTouchHitTest(){
  const read=async url=>{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,alpha=new Uint8Array(canvas.width*canvas.height);
    for(let p=0;p<alpha.length;p++)alpha[p]=rgba[p*4+3];canvas.width=canvas.height=1;return {alpha,width:image.width,height:image.height};};
  const lookup=(data,x,y)=>{const xx=Math.floor(x),yy=Math.floor(y);return xx>=0&&yy>=0&&xx<data.width&&yy<data.height?data.alpha[yy*data.width+xx]:0;};
  const states=['working_thinking','idle_high_energy','idle_mid_energy','idle_low_energy'];
  const alphas=new Map(await Promise.all(states.map(async state=>[state,await read(state==='working_thinking'?'/assets/reference-working.png':`/assets/idle/${state}/original.png`)])));
  const manifest=await fetch('/assets/source-layers/manifest.json').then(r=>{if(!r.ok)throw new Error('Touch source layer manifest unavailable');return r.json();});
  const ids=new Set(ZONES.flatMap(z=>z.meshes)),masks=new Map(await Promise.all(manifest.layers.filter(l=>ids.has(l.mesh)).map(async layer=>[layer.mesh,{...layer,...await read('/assets/source-layers/'+layer.file)}])));
  return {pick(x,y,options={}){const state=options.state||'working_thinking',alpha=alphas.get(state);if(!alpha)return null;
      return pickExtraTouch(x,y,{...options,state,alphaAt:(x,y)=>lookup(alpha,x,y),maskAt:(id,x,y)=>{const mask=masks.get(id);return mask?lookup(mask,x-mask.bounds[0],y-mask.bounds[1]):0;}});},
    evidence(){return {ready:true,states:states.length,targets:EXTRA_TOUCH_TARGETS.map(t=>t.id),alphaThreshold:128,eyeRegionsExcluded:true};},
    release(){alphas.clear();masks.clear();}};
}

export function drawExtraTouchOverlay(ctx,{values={},project,state='working_thinking'}={}){
  const p=clamp(values.cup);if(!ctx||!project||p<=0||p>=1||state==='sleep_mode')return;
  const origin=project(817,1410),right=project(901,1410),down=project(817,1434),sx=(right[0]-origin[0])/84,sy=(down[1]-origin[1])/24;
  ctx.save();ctx.translate(...origin);ctx.scale(sx,sy);ctx.beginPath();ctx.ellipse(0,0,83,27,0,0,TAU);ctx.clip();
  ctx.globalAlpha=Math.sin(Math.PI*p)**2*.86;ctx.strokeStyle='#f7e9ff';ctx.lineWidth=2.5;
  for(let i=0;i<3;i++){const phase=(p+i/3)%1;ctx.beginPath();ctx.ellipse(0,1,8+72*phase,3+23*phase,0,0,TAU);ctx.stroke();}
  ctx.fillStyle='#ffffff';for(const [x,y,k] of [[-37,-8,.2],[25,3,.5],[51,-4,.75]]){const size=3+3*Math.sin(Math.PI*clamp((p-k+.3)/.6));ctx.beginPath();ctx.moveTo(x,y-size);ctx.lineTo(x+size*.6,y);ctx.lineTo(x,y+size);ctx.lineTo(x-size*.6,y);ctx.closePath();ctx.fill();}
  ctx.restore();
}
