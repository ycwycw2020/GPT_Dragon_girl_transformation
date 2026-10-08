// Render-time secondary deformation for the exported working model only.
// Core model data and the moc3 remain untouched. Vertex/UV adapters feed the
// same positions to normal rendering and Cubism's clipping-mask renderer.
import {extraObjectDisplacement,extraCharacterDisplacement} from './extra-touch.mjs';
const UPPER=new Set(['ArtMesh15','ArtMesh16','ArtMesh20','ArtMesh21','ArtMesh22','ArtMesh23','ArtMesh24','ArtMesh25','ArtMesh26','ArtMesh27','ArtMesh28','ArtMesh29','ArtMesh30','ArtMesh31','ArtMesh32','ArtMesh33','ArtMesh34','ArtMesh35','ArtMesh36','ArtMesh37','ArtMesh41','ArtMesh48','ArtMesh50','ArtMesh52','ArtMesh46']);
const CURVED=new Set(['ArtMesh15','ArtMesh16','ArtMesh29','ArtMesh35','ArtMesh36','ArtMesh41']);
const HANDS=new Set(['ArtMesh6','ArtMesh7','ArtMesh8','ArtMesh9','ArtMesh10','ArtMesh12']);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
export function motionSample(time,{state='working_thinking',sleep=false,strength=1,phaseOverride,gainOverride}={}){
  const gain=gainOverride??clamp(Number.isFinite(strength)?strength:1,0,1.35)*(sleep ? .65 : state==='idle_low_energy' ? .7 : 1);
  const period=sleep?6.2:state==='working_thinking'?4.7:5.2;
  // Slightly shorter inhalation, longer exhalation, with zero endpoint velocity.
  const phase=(((phaseOverride??time/period)%1)+1)%1,breath=phase<.42?smooth(0,.42,phase):1-smooth(.42,1,phase);
  const sway=Math.sin(time*2*Math.PI/9.8)*.003+Math.sin(time*2*Math.PI/17.3)*.0007;
  // Gentle rise only: the old 24px lift stretched the anchored neck/torso.
  return {time,period,gain,breath,lift:6*breath*gain,angle:sway*gain,sin:Math.sin(sway*gain),cos:Math.cos(sway*gain),
    drift:1.5*Math.sin(time*2*Math.PI/12.7)*gain,hair:5*Math.sin(time*2*Math.PI/6.8-.5)*gain,
    tail:.045*Math.sin(time*2*Math.PI/7.8-.4)*gain,ahoge:12*Math.sin(time*2*Math.PI/5.9-.3)*gain,
    plant:.009*Math.sin(time*2*Math.PI/8.6-.9)*gain};
}
export function deformPoint(id,x,y,s){
  if((id==='ArtMesh26'||id==='ArtMesh27')&&s.ear){const d=extraCharacterDisplacement(x,y,{ear:s.ear});x+=d[0];y+=d[1];}
  if(id==='ArtMesh29'&&s.touch?.earring){
    const a=s.touch.earring*smooth(704,765,y),ox=x-875,oy=y-704;
    x=875+ox*Math.cos(a)-oy*Math.sin(a);y=704+ox*Math.sin(a)+oy*Math.cos(a);
  }
  if(UPPER.has(id)){
    let w=1-smooth(1030,1400,y);
    if(id==='ArtMesh15'||id==='ArtMesh16')w=1-smooth(990,1280,y);
    const ox=x-1260,oy=y-1150;
    let dx=(ox*s.cos-oy*s.sin-ox+s.drift)*w;
    let dy=(ox*s.sin+oy*s.cos-oy-s.lift)*w;
    // Preserve the body's width; no breathing-driven inflation or scaling.
    if(['ArtMesh35','ArtMesh36','ArtMesh29','ArtMesh41'].includes(id))dx+=s.hair*smooth(760,1220,y)*(1-smooth(1240,1430,y));
    if(id==='ArtMesh33')dx+=s.ahoge*(1-smooth(30,345,y));
    return [x+dx,y+dy];
  }
  if(id==='ArtMesh38'){
    const ox=x-351,oy=y-1217,w=smooth(30,260,Math.hypot(ox,oy)),a=(s.tail+(s.touch?.tail||0))*w;
    return [351+ox*Math.cos(a)-oy*Math.sin(a),1217+ox*Math.sin(a)+oy*Math.cos(a)];
  }
  // Only upper plant leaves sway; pot, books and other desk items stay fixed.
  if(id==='ArtMesh0'){const d=extraObjectDisplacement(x,y,{plant:s.touch?.plant});return [x+s.plant*(1450-y)*(1-smooth(1330,1450,y))+d[0],y+d[1]];}
  if(id==='ArtMesh1'){const d=extraObjectDisplacement(x,y,{mascot:s.touch?.mascot});return [x+d[0],y+d[1]];}
  if(id==='ArtMesh11'){const d=extraObjectDisplacement(x,y,{keyboard:s.touch?.keyboard});return [x+d[0],y+d[1]];}
  if(id==='ArtMesh6'||id==='ArtMesh7')return [x,y+clamp(s.touch?.keyboard||0,0,1)*2.6*smooth(1320,1383,y)];
  if(id==='ArtMesh9'||id==='ArtMesh10')return [x,y+(s.touch?.mouse||0)];
  return [x,y];
}
function topology(vertices,uvs,indices,subdivide,steps=8){
  if(!subdivide)return {weights:null,uvs,indices,positions:new Float32Array(vertices.length)};
  const weights=[],uv=[],newIndices=[];
  const add=(a,b,c,u,v)=>{const w=[1-u-v,u,v],ids=[a,b,c],index=weights.length;weights.push({ids,w});
    uv.push(w.reduce((s,n,i)=>s+n*uvs[ids[i]*2],0),w.reduce((s,n,i)=>s+n*uvs[ids[i]*2+1],0));newIndices.push(index);};
  for(let t=0;t<indices.length;t+=3){const [a,b,c]=indices.slice(t,t+3);
    for(let i=0;i<steps;i++)for(let j=0;j<steps-i;j++){
      add(a,b,c,i/steps,j/steps);add(a,b,c,(i+1)/steps,j/steps);add(a,b,c,i/steps,(j+1)/steps);
      if(i+j<steps-1){add(a,b,c,(i+1)/steps,j/steps);add(a,b,c,(i+1)/steps,(j+1)/steps);add(a,b,c,i/steps,(j+1)/steps);}
    }
  }
  return {weights,uvs:new Float32Array(uv),indices:new Uint16Array(newIndices),positions:new Float32Array(weights.length*2)};
}
export function createAmbientMotion(model,modelId){
  const core=model.getModel(),c=core.canvasinfo,ids=Array.from(core.drawables.ids);
  // Exact export shape: don't apply this rig-specific map to unrelated models.
  const enabled=modelId==='working_thinking'&&c.CanvasWidth===2426&&c.CanvasHeight===2592&&ids.includes('ArtMesh37')&&ids.includes('ArtMesh52');
  const parts=new Map();
  if(enabled)ids.forEach((id,index)=>{
    if(UPPER.has(id)||['ArtMesh38','ArtMesh0','ArtMesh1','ArtMesh6','ArtMesh7','ArtMesh9','ArtMesh10','ArtMesh11','ArtMesh40'].includes(id))parts.set(index,{id,...topology(model.getDrawableVertices(index),model.getDrawableVertexUvs(index),model.getDrawableVertexIndices(index),CURVED.has(id)||['ArtMesh0','ArtMesh1','ArtMesh11','ArtMesh40'].includes(id),id==='ArtMesh40'?32:['ArtMesh1','ArtMesh11'].includes(id)?12:8)});
  });
  const adapter=Object.create(model);
  let hideStatus=false;
  adapter.getDrawableOpacity=i=>hideStatus&&ids[i]==='ArtMesh'?0:model.getDrawableOpacity(i);
  adapter.getDrawableVertices=adapter.getDrawableVertexPositions=i=>parts.get(i)?.positions||model.getDrawableVertices(i);
  adapter.getDrawableVertexCount=i=>adapter.getDrawableVertices(i).length/2;
  adapter.getDrawableVertexIndices=i=>parts.get(i)?.indices||model.getDrawableVertexIndices(i);
  adapter.getDrawableVertexIndexCount=i=>adapter.getDrawableVertexIndices(i).length;
  adapter.getDrawableVertexUvs=i=>parts.get(i)?.uvs||model.getDrawableVertexUvs(i);
  adapter.getDrawableDynamicFlagVertexPositionsDidChange=i=>parts.has(i)||model.getDrawableDynamicFlagVertexPositionsDidChange(i);
  let last={enabled,movingMeshes:parts.size,maxDisplacementPx:0},liveClock=null,lastSample=motionSample(0),seamLinks=[];
  function update(time,options={}){
    hideStatus=options.sleep===true;
    let sample=motionSample(time,options);const ppu=c.PixelsPerUnit;let max=0;
    if(options.live){
      if(!liveClock||time<liveClock.time)liveClock={time,phase:time/sample.period,gain:sample.gain};
      const dt=Math.min(.25,Math.max(0,time-liveClock.time));
      liveClock.phase=(liveClock.phase+dt/sample.period)%1;
      liveClock.gain+=(sample.gain-liveClock.gain)*(1-Math.exp(-dt/.8));
      liveClock.time=time;
      sample=motionSample(time,{...options,phaseOverride:liveClock.phase,gainOverride:liveClock.gain});
    }else liveClock=null;
    sample.touch=options.touch;
    const reaction=options.reaction||{};
    sample.angle+=clamp(reaction.headAngle||0,-.018,.018);
    sample.sin=Math.sin(sample.angle);sample.cos=Math.cos(sample.angle);
    sample.drift+=clamp(reaction.headX||0,-8,8);
    sample.lift-=clamp((reaction.headY||0)+(reaction.bounce||0),-10,10);
    sample.tail+=clamp(reaction.tail||0,-.08,.08);
    sample.hair+=clamp(reaction.hair||0,-10,10);
    sample.ahoge+=clamp(reaction.ahoge||0,-15,15);
    sample.ear=clamp(reaction.ear||0,-.025,.025);
    lastSample=sample;
    for(const [index,part] of parts){const base=model.getDrawableVertices(index),out=part.positions;
      for(let n=0;n<out.length/2;n++){
        const weight=part.weights?.[n];let bx,by;
        if(weight){bx=weight.w.reduce((s,w,k)=>s+w*base[weight.ids[k]*2],0);by=weight.w.reduce((s,w,k)=>s+w*base[weight.ids[k]*2+1],0);}else{bx=base[n*2];by=base[n*2+1];}
        const x=bx*ppu+c.CanvasOriginX,y=c.CanvasOriginY-by*ppu;
        const [dx,dy]=options.disabled?[x,y]:deformPoint(part.id,x,y,sample);
        out[n*2]=(dx-c.CanvasOriginX)/ppu;out[n*2+1]=(c.CanvasOriginY-dy)/ppu;
        max=Math.max(max,Math.hypot(dx-x,dy-y));
      }
    }
    // Fragment vertices borrow exactly the neighbouring rendered triangle's
    // transform, including its Core motion, rather than approximating it again.
    if(!options.disabled)for(const link of seamLinks){
      const target=parts.get(link.target).positions,out=parts.get(link.part).positions;
      for(let k=0;k<2;k++)out[link.vertex*2+k]=link.weights.reduce((sum,w,i)=>sum+w*target[link.indices[i]*2+k],0);
    }
    last={enabled:enabled&&!options.disabled,profile:'gentle-touch-seams-v048',movingMeshes:parts.size,seamVertices:seamLinks.length,time,breath:sample.breath,breathLiftPx:Number(sample.lift.toFixed(3)),maxDisplacementPx:Number(max.toFixed(3)),extraTouch:{plant:sample.touch?.plant||0,mascot:sample.touch?.mascot||0,keyboard:sample.touch?.keyboard||0},reactionChannels:{hair:clamp(reaction.hair||0,-10,10),ahoge:clamp(reaction.ahoge||0,-15,15),ear:sample.ear},stationaryHands:[...HANDS].filter(id=>(!options.touch?.mouse||!['ArtMesh9','ArtMesh10'].includes(id))&&(!options.touch?.keyboard||!['ArtMesh6','ArtMesh7'].includes(id)))};return last;
  }
  update(0,{disabled:true});
  // The export's catch-all contains small head/hair fragments alongside static
  // desk/chair pixels. Only the head silhouette is allowed to follow animation.
  const fragmentIndex=ids.indexOf('ArtMesh40'),fragment=parts.get(fragmentIndex);
  if(fragment)for(let n=0;n<fragment.positions.length/2;n++){
    const wx=fragment.positions[2*n],wy=fragment.positions[2*n+1],x=wx*c.PixelsPerUnit+c.CanvasOriginX,y=c.CanvasOriginY-wy*c.PixelsPerUnit;
    const left=y<650?650:y<1050?600:280,right=y<1050?1800:y<1210?1840:1795;
    if(y<0||y>=1400||x<left||x>right)continue;
    const candidates=x>=1017&&x<=1323&&y<346?['ArtMesh33','ArtMesh35']:['ArtMesh35','ArtMesh36'];
    let linked=false;
    for(const id of candidates){const targetIndex=ids.indexOf(id),target=parts.get(targetIndex);if(!target)continue;
      for(let t=0;t<target.indices.length;t+=3){
        const tri=Array.from(target.indices.slice(t,t+3)),p=tri.map(i=>[target.positions[i*2],target.positions[i*2+1]]),[a,b,d]=p;
        const den=(b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]);if(Math.abs(den)<1e-12)continue;
        const u=((wx-a[0])*(d[1]-a[1])-(wy-a[1])*(d[0]-a[0]))/den,w=((b[0]-a[0])*(wy-a[1])-(b[1]-a[1])*(wx-a[0]))/den;
        if(u>=-1e-6&&w>=-1e-6&&u+w<=1+1e-6){seamLinks.push({part:fragmentIndex,vertex:n,target:targetIndex,indices:tri,weights:[1-u-w,u,w]});linked=true;break;}
      }if(linked)break;
    }
  }
  function hitTest(id,x,y){
    if(!enabled||![x,y].every(Number.isFinite))return false;
    const i=ids.indexOf(id);if(i<0)return false;
    const v=adapter.getDrawableVertices(i),indices=adapter.getDrawableVertexIndices(i);
    const px=(x-c.CanvasOriginX)/c.PixelsPerUnit,py=(c.CanvasOriginY-y)/c.PixelsPerUnit;
    for(let j=0;j<indices.length;j+=3){
      const [a,b,d]=indices.slice(j,j+3),ax=v[2*a],ay=v[2*a+1],bx=v[2*b],by=v[2*b+1],dx=v[2*d],dy=v[2*d+1];
      const area=(bx-ax)*(dy-ay)-(by-ay)*(dx-ax);if(Math.abs(area)<1e-12)continue;
      const u=((px-ax)*(dy-ay)-(py-ay)*(dx-ax))/area,w=((bx-ax)*(py-ay)-(by-ay)*(px-ax))/area;
      if(u>=0&&w>=0&&u+w<=1)return true;
    }return false;
  }
  function inversePoint(id,x,y){if(!last.enabled)return [x,y];let sx=x,sy=y;for(let n=0;n<6;n++){const [dx,dy]=deformPoint(id,sx,sy,lastSample);sx=x-(dx-sx);sy=y-(dy-sy);}return [sx,sy];}
  return {model:adapter,update,hitTest,inversePoint,restPoint:(id,x,y)=>last.enabled?deformPoint(id,x,y,{...lastSample,touch:null}):[x,y],evidence:()=>last,snapshot:()=>ids.map((id,i)=>({id,vertices:Array.from(adapter.getDrawableVertices(i))}))};
}
