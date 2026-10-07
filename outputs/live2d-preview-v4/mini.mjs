import {bindPetDrag} from './pet-drag.mjs';
const $=id=>document.getElementById(id);
bindPetDrag($('card'));
let busy=false,lastOptions='',chatErrorUntil=0;
const folder=cwd=>cwd?.replace(/[\\/]+$/,'').split(/[\\/]/).pop()||'未提供目录';
$('collapse').onclick=()=>window.dragonDesktop?.panel('hide');
$('chat').onclick=async()=>{
  $('chat').disabled=true;
  try {await window.dragonDesktop.newChat();}
  catch{chatErrorUntil=Date.now()+10000;$('operation').textContent='无法打开 Codex，请确认已安装桌面版';}
  finally{$('chat').disabled=false;}
};
$('sessions').onchange=()=>window.dragonDesktop?.follow($('sessions').value).then(refresh).catch(()=>{});
async function refresh(){
  if(busy)return;busy=true;
  try {
    const response=await fetch('/api/companion-state',{cache:'no-store'});if(!response.ok)throw new Error('unavailable');
    const state=await response.json(),tasks=state.tasks||[];
    const chosen=state.followSession?tasks.find(t=>t.id===state.followSession):tasks[0];
    const signature=JSON.stringify(tasks.map(t=>[t.id,t.cwd,t.active]));
    if(signature!==lastOptions){
      lastOptions=signature;$('sessions').replaceChildren(new Option('自动跟随活跃目录',''));
      for(const task of tasks)$('sessions').add(new Option(`${task.active?'●':'○'} ${folder(task.cwd)} · ${task.id.slice(0,4)}`,task.id));
      if(state.followSession&&!tasks.some(t=>t.id===state.followSession))$('sessions').add(new Option('已选择的会话 · 暂无状态',state.followSession));
    }
    $('sessions').value=state.followSession||'';
    $('folder').textContent=chosen?folder(chosen.cwd):state.followSession?'所选会话暂无状态':'等待 Codex 任务';
    $('folder').title=chosen?.cwd||'';
    if(Date.now()>=chatErrorUntil)$('operation').textContent=chosen?.label||(state.taskKnown?'等待新任务':'等待任务回调');
    $('detail').textContent=chosen?.detail||(chosen?.active?'我在认真陪你处理～':'随时准备继续');
    $('detail').title=chosen?.detail||'';
    $('dot').classList.toggle('busy',!!chosen?.active);
    $('quota').textContent=Number.isFinite(state.remainingPercent)?`额度 ${state.remainingPercent}%`:'额度未知';
    const life=state.life,progression=life?.progression;
    $('affection').textContent=`♡ 好感 ${life?.affection??'—'}`;
    $('level').textContent=`Lv.${progression?.level??1}`;
    $('experience').value=progression?.progress??0;
    $('experience').title=progression?`总经验 ${progression.totalXp} · 距下一级 ${progression.xpToNextLevel}`:'等待成长数据';
    const seconds=chosen?Math.max(0,Math.floor((Date.now()-chosen.updatedAt)/1000)):null;
    $('age').textContent=seconds===null?'—':seconds<5?'刚刚':seconds<60?`${seconds} 秒前`:`${Math.floor(seconds/60)} 分前`;
    window.miniEvidence={connected:true,folder:$('folder').textContent,operation:$('operation').textContent,active:chosen?.active??false,cwd:chosen?.cwd||'',taskCount:tasks.length,affection:life?.affection,level:progression?.level};
  }catch{ $('operation').textContent='连接暂时中断';$('dot').classList.remove('busy');window.miniEvidence={connected:false}; }
  finally{busy=false;}
}
refresh();setInterval(refresh,750);
