const {clampPosition}=require('./window-interaction.cjs');
function noticeBounds(pet,area){
  const width=Math.min(278,area.width),height=Math.min(104,area.height);
  return clampPosition({x:pet.x+(pet.width-width)/2,y:pet.y-height-6,width,height},area);
}
function chooseNotice(tasks,followSession,dismissed,now=Date.now()){
  return (tasks||[]).filter(t=>(!followSession||t.id===followSession)&&t.questionNotice?.expiresAt>now)
    .map(t=>({key:t.id+':'+t.questionNotice.id,expiresAt:t.questionNotice.expiresAt,createdAt:t.questionNotice.createdAt}))
    .filter(n=>!dismissed.has(n.key)).sort((a,b)=>b.createdAt-a.createdAt)[0]||null;
}
module.exports={noticeBounds,chooseNotice};
