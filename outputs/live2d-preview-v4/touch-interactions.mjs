const TAU=2*Math.PI;
export const TOUCH_TARGETS=Object.freeze([
  {id:'book',label:'翻一页笔记',meshes:['ArtMesh3'],duration:1.5,text:'翻一页，继续认真记笔记～'},
  {id:'mouse',label:'点点鼠标',meshes:['ArtMesh9','ArtMesh10'],duration:.5,text:'哒哒，收到啦～'},
  {id:'earring',label:'轻晃耳饰',meshes:['ArtMesh29'],duration:2.6,text:'叮铃～轻轻晃一下 ♡'},
  {id:'tail',label:'摸摸尾巴',meshes:['ArtMesh38'],duration:2.4,text:'尾巴也收到摸摸啦～'},
]);
export function sampleTouch(id,age){
  const item=TOUCH_TARGETS.find(t=>t.id===id);
  if(!item||!Number.isFinite(age)||age<=0||age>=item.duration)return 0;
  const p=age/item.duration;
  if(id==='book')return p;
  if(id==='mouse')return 4*Math.sin(Math.PI*p)**2*(.7+.3*Math.cos(4*Math.PI*p));
  // Soft entry and exit; no instantaneous jump when the user touches a part.
  const envelope=Math.sin(Math.PI*p)**2*(1-.45*p);
  return .07*envelope*Math.sin(TAU*(id==='tail'?1.8:2.4)*p);
}
export function createTouchInteractions(){
  const active=new Map();let last=null;
  return {
    trigger(id,time){const target=TOUCH_TARGETS.find(t=>t.id===id);if(!target||!Number.isFinite(time))return false;
      if(active.has(id)&&time-active.get(id)<target.duration)return false;
      active.set(id,time);last={id,time};return true;},
    sample(time){const values={tail:0,earring:0,mouse:0,book:0},playing=[];
      for(const [id,start] of active){const age=time-start,target=TOUCH_TARGETS.find(t=>t.id===id);
        if(age>=target.duration){active.delete(id);continue;}
        values[id]=sampleTouch(id,age);playing.push(id);
      }return {values,playing,last};},
    clear(){active.clear();last=null;},
  };
}
export function pickTouch(hit){return TOUCH_TARGETS.find(t=>t.meshes.some(hit))??null;}
export function viewTransform(bounds,rect,c){
  const [minX,minY,maxX,maxY]=bounds,aspect=rect.width/rect.height;
  const scale=Math.min(1.76/(maxY-minY),1.76*aspect/(maxX-minX));
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  return {
    project(x,y){const wx=(x-c.CanvasOriginX)/c.PixelsPerUnit,wy=(c.CanvasOriginY-y)/c.PixelsPerUnit;
      return [((wx-cx)*scale/aspect+1)*rect.width/2,(1-(wy-cy)*scale)*rect.height/2];},
    unproject(x,y){return [(((x-rect.left)/rect.width*2-1)*aspect/scale+cx)*c.PixelsPerUnit+c.CanvasOriginX,
      c.CanvasOriginY-((1-(y-rect.top)/rect.height*2)/scale+cy)*c.PixelsPerUnit];},
  };
}

// Runtime paper overlay: turn the left sheet without bending the cover or pen.
// Reuses the unchanged notebook artwork and projects into the same scene space.
export function createPageTurn(canvas){
  const overlay=document.createElement('canvas');overlay.id='pageTurn';overlay.setAttribute('aria-hidden','true');
  document.body.append(overlay);const ctx=overlay.getContext('2d'),paper=new Image();paper.src='/assets/notebook.png';
  let loaded=false;paper.onload=()=>{loaded=true;};
  const A=[964,1596],B=[1155,1555],C=[1320,1658],D=[1097,1692];
  const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
  function point(u,v,p){const spine=lerp(B,C,v),edge=lerp(A,D,v),angle=Math.PI*(p*p*(3-2*p));
    return [spine[0]+(edge[0]-spine[0])*u*Math.cos(angle),
      spine[1]+(edge[1]-spine[1])*u*Math.cos(angle)-Math.sin(angle)*(100*u+28*Math.sin(Math.PI*u))];}
  function triangle(src,dst){
    const [a,b,c]=src,[p,q,r]=dst,den=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);
    const aa=((q[0]-p[0])*(c[1]-a[1])-(r[0]-p[0])*(b[1]-a[1]))/den;
    const cc=((b[0]-a[0])*(r[0]-p[0])-(c[0]-a[0])*(q[0]-p[0]))/den;
    const bb=((q[1]-p[1])*(c[1]-a[1])-(r[1]-p[1])*(b[1]-a[1]))/den;
    const dd=((b[0]-a[0])*(r[1]-p[1])-(c[0]-a[0])*(q[1]-p[1]))/den;
    ctx.save();ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...q);ctx.lineTo(...r);ctx.closePath();ctx.clip();
    ctx.transform(aa,bb,cc,dd,p[0]-aa*a[0]-cc*a[1],p[1]-bb*a[0]-dd*a[1]);ctx.drawImage(paper,0,0);ctx.restore();
  }
  return {draw(progress,project){
    overlay.hidden=!loaded||progress<=0;if(overlay.hidden)return;
    const rect=canvas.getBoundingClientRect(),dpr=canvas.width/rect.width;
    if(overlay.width!==canvas.width||overlay.height!==canvas.height){overlay.width=canvas.width;overlay.height=canvas.height;}
    Object.assign(overlay.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height);
    ctx.globalAlpha=progress>.84?(1-progress)/.16:1;
    const strips=16;
    for(let i=0;i<strips;i++){
      const uv=[[i/strips,0],[(i+1)/strips,0],[(i+1)/strips,1],[i/strips,1]];
      const source=uv.map(([u,v])=>point(u,v,0).map((n,k)=>n-[944,1516][k]));
      const dest=uv.map(([u,v])=>project(...point(u,v,progress)));
      for(const ids of [[0,1,2],[0,2,3]])triangle(ids.map(j=>source[j]),ids.map(j=>dest[j]));
    }
    ctx.globalAlpha=1;
    ctx.beginPath();for(let i=0;i<=16;i++){const p=project(...point(i/16,0,progress));i?ctx.lineTo(...p):ctx.moveTo(...p);}ctx.lineTo(...project(...point(1,1,progress)));
    ctx.strokeStyle='#d8bed9';ctx.lineWidth=.65;ctx.stroke();
  },get loaded(){return loaded;}};
}

// The extracted pendant has a transparent hole underneath in the original rig.
// Paint only that hidden silhouette, beneath WebGL, with a soft hair-colour fill.
export function createEarringBacking(canvas){
  const layer=document.createElement('canvas');layer.id='earringBacking';layer.setAttribute('aria-hidden','true');
  document.body.append(layer);const ctx=layer.getContext('2d'),mask=new Image();mask.src='/assets/earring-mask.png';
  let painted=null;mask.onload=()=>{
    painted=document.createElement('canvas');painted.width=mask.width;painted.height=mask.height;const p=painted.getContext('2d');
    p.drawImage(mask,0,0);p.globalCompositeOperation='source-in';
    const colour=p.createLinearGradient(0,0,mask.width,mask.height);colour.addColorStop(0,'#dad4f0');colour.addColorStop(.35,'#eee7fb');colour.addColorStop(.7,'#c5b6e8');colour.addColorStop(1,'#aaa0cc');p.fillStyle=colour;p.fillRect(0,0,mask.width,mask.height);
  };
  return {draw(active,project,restPoint){
    layer.hidden=!active||!painted;if(layer.hidden)return;
    const rect=canvas.getBoundingClientRect(),dpr=canvas.width/rect.width;
    if(layer.width!==canvas.width||layer.height!==canvas.height){layer.width=canvas.width;layer.height=canvas.height;}
    Object.assign(layer.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height);
    // Narrow horizontal strips follow the same head/hair deformation as the cutout.
    for(let y=0;y<painted.height;y+=4){
      const h=Math.min(4,painted.height-y),a=project(...restPoint('ArtMesh29',790,700+y)),b=project(...restPoint('ArtMesh29',790+painted.width,700+y)),c=project(...restPoint('ArtMesh29',790,700+y+h));
      ctx.save();ctx.transform((b[0]-a[0])/painted.width,(b[1]-a[1])/painted.width,(c[0]-a[0])/h,(c[1]-a[1])/h,a[0],a[1]);
      ctx.drawImage(painted,0,y,painted.width,h,0,0,painted.width,h+.4);ctx.restore();
    }
  },get loaded(){return !!painted;}};
}
