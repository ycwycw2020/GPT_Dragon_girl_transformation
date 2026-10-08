// Procedural performance cues for the existing artwork, in seconds / HD pixels / radians.
// This module neither edits saved affection nor creates an independent Cubism model.
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
// Input is the 1–100 affection LEVEL, optionally with fractional level progress.
const affection=n=>finite(n)?clamp(n,1,100):1;
const TAU=Math.PI*2;
const envelope=p=>Math.sin(Math.PI*p)**2;
const wave=(p,cycles=1,phase=0)=>envelope(p)*Math.sin(TAU*cycles*p+phase);
const beat=(p,center,width=.16)=>{
  const d=Math.abs(p-center)/width;
  return d>=1?0:Math.cos(d*Math.PI/2)**2;
};
const limits=Object.freeze({
  headX:[-8,8],headY:[-8,8],headAngle:[-.018,.018],tail:[-.08,.08],
  leg:[-.012,.012],handY:[-30,12],handAngle:[-.08,.08],bounce:[-5,5],
  blink:[0,1],blush:[0,1],hearts:[0,1],anger:[0,1],embarrassed:[0,1],
  pulse:[0,1],fist:[0,1],
  hair:[-10,10],ahoge:[-15,15],ear:[-.025,.025],
});
export const REACTION_CHANNEL_LIMITS=limits;
export const AFFECTION_TARGETS=Object.freeze(['leg','tail','head','horn','cheek','hand']);
export const AFFECTION_TARGET_METADATA=Object.freeze([
  {id:'leg',label:'轻碰脚尖',description:'跟着摆动轻轻碰一下脚尖'},
  {id:'tail',label:'摸摸尾巴',description:'轻碰尾巴，看看她的小反应'},
  {id:'head',label:'摸头顺毛',description:'轻轻摸头，让发丝和呆毛一起回应'},
  {id:'horn',label:'轻碰龙角',description:'轻轻碰龙角，她会转头回应'},
  {id:'cheek',label:'轻戳脸颊',description:'轻轻戳脸颊，看她眨眼和歪头'},
  {id:'hand',label:'轻碰手背',description:'轻碰握鼠手的手背，收到小小应答'},
].map(Object.freeze));
const zero=()=>Object.fromEntries(Object.keys(limits).map(key=>[key,0]));
const profiles=new Map();
function action(id,target,tier,unlock,duration,label,text,icon,profile,options={}){
  profiles.set(id,profile);
  const oldPoints={low:[0,6,12,18,24],mid:[30,38,46,54,62],high:[70,76,82,88,94]};
  const levelPoints={low:[1,1.5,2,2.5,3],mid:[4,4.5,5,5.5,6],high:[7,7.75,8.5,9.25,10]};
  const unlockLevel=levelPoints[tier][oldPoints[tier].indexOf(unlock)];
  return Object.freeze({id,target,tier,unlock:unlockLevel,unlockLevel,duration,label,text,icon,
    pose:options.pose??(tier==='low'?'angry':tier==='mid'?'shy':'affectionate')});
}

const originalReactions=Object.freeze([
  action('leg-angry-knock','leg','low',0,2.15,'轻敲桌抗议','呜，先打声招呼啦！(｡•ˇ‸ˇ•｡)','💢',p=>({
    fist:envelope(p),handY:-27*beat(p,.30,.24)+10*beat(p,.54,.10),handAngle:-.065*beat(p,.34,.27),
    leg:-.010*beat(p,.25,.25),headY:4*beat(p,.55,.16),anger:envelope(p),pulse:beat(p,.54,.13),
  })),
  action('leg-angry-double-knock','leg','low',6,2.65,'双拍小抗议','咚、咚——认真工作中！(｀・ω・´)','💢',p=>({
    fist:envelope(p),handY:-24*beat(p,.22,.16)+9*beat(p,.38,.08)-21*beat(p,.53,.13)+11*beat(p,.67,.08),
    handAngle:-.05*(beat(p,.23,.19)+beat(p,.53,.17)),headY:3*(beat(p,.40,.13)+beat(p,.68,.13)),
    leg:-.009*beat(p,.5,.40),anger:envelope(p),pulse:Math.max(beat(p,.39,.1),beat(p,.68,.1)),
  })),
  action('leg-angry-pout-turn','leg','low',12,2.4,'鼓腮别头','哼，我可要鼓起脸颊了！( •̀⤙•́ )','☁️',p=>({
    headX:-7*envelope(p),headAngle:-.017*envelope(p),headY:-2*envelope(p),
    leg:-.010*beat(p,.48,.36),tail:.025*wave(p,1.4),blink:beat(p,.43,.13),
    anger:.8*envelope(p),pulse:.5*envelope(p),
  })),
  action('leg-angry-retract','leg','low',18,2.1,'轻缩腿提醒','吓了一跳，轻一点嘛！(｡>﹏<｡)','❕',p=>({
    leg:-.012*beat(p,.33,.30)+.004*beat(p,.74,.20),headY:-6*beat(p,.27,.22),
    headX:3*beat(p,.50,.32),handY:-14*beat(p,.34,.28),handAngle:.04*beat(p,.36,.3),
    blink:beat(p,.25,.1),anger:envelope(p),bounce:-3*beat(p,.28,.22),
  })),
  action('leg-angry-headshake','leg','low',24,2.9,'摇头划界线','不可以突然捣乱哦～(๑•̀ㅂ•́)و','💢',p=>({
    headX:6*wave(p,2.3),headAngle:.014*wave(p,2.3),leg:-.007*envelope(p),
    handY:-20*beat(p,.50,.38),handAngle:.07*wave(p,1.2),fist:.75*envelope(p),
    anger:.75*envelope(p),blink:beat(p,.72,.12),pulse:beat(p,.48,.18),
  })),
  action('tail-angry-tuck','tail','low',0,2.2,'收尾护住','尾巴先收好，禁止突袭！(｡•ˇ‸ˇ•｡)','💢',p=>({
    tail:-.075*beat(p,.4,.37),headX:5*envelope(p),headAngle:.014*envelope(p),
    leg:-.005*beat(p,.34,.3),anger:envelope(p),blink:beat(p,.3,.12),
  })),
  action('tail-angry-two-flicks','tail','low',6,2.7,'尾尖双甩','哼哼，尾尖也会抗议！( •̀ω•́ )','💢',p=>({
    tail:.072*beat(p,.28,.16)-.070*beat(p,.55,.19),headAngle:.011*wave(p,1.7),
    headX:4*wave(p,1.7),handY:-10*envelope(p),anger:.85*envelope(p),
    pulse:Math.max(beat(p,.3,.13),beat(p,.58,.13)),
  })),
  action('tail-angry-table-beat','tail','low',12,2.55,'握拳咚一下','咚！这是我的小尾巴呀！(｀^´)','💢',p=>({
    tail:-.06*envelope(p)+.014*wave(p,2),fist:envelope(p),handY:-30*beat(p,.32,.27)+12*beat(p,.64,.1),
    handAngle:-.07*beat(p,.35,.28),headY:5*beat(p,.65,.15),anger:envelope(p),pulse:beat(p,.64,.12),
  })),
  action('tail-angry-look-away','tail','low',18,2.8,'抱气别过头','我要把尾巴藏起来啦。(｡•́︿•̀｡)','☁️',p=>({
    headX:-8*envelope(p),headAngle:.016*envelope(p),headY:-3*beat(p,.55,.4),
    tail:-.065*beat(p,.65,.33),handY:-13*beat(p,.4,.34),blink:beat(p,.58,.17),
    anger:.7*envelope(p),pulse:.4*envelope(p),
  })),
  action('tail-angry-huff','tail','low',24,3.0,'摇尾哼一声','再突然一下，我就哼哼啦！(๑•̀н•́๑)','💢',p=>({
    tail:.060*wave(p,3.2),headY:-4*beat(p,.34,.28)+2*beat(p,.65,.2),headAngle:-.012*wave(p,1.3),
    handY:-18*envelope(p),handAngle:.045*wave(p,2),fist:.8*envelope(p),anger:envelope(p),
    blink:beat(p,.42,.11),bounce:-2*beat(p,.36,.25),
  })),
  action('leg-shy-tuck','leg','mid',30,2.8,'害羞收脚','欸……被你发现我在晃脚了。(⁄ ⁄•⁄ω⁄•⁄ ⁄)','🌸',p=>({
    leg:-.010*beat(p,.42,.35),headY:6*envelope(p),headAngle:.009*envelope(p),
    blush:envelope(p),embarrassed:envelope(p),blink:beat(p,.34,.14),tail:.020*wave(p,.8),
  })),
  action('leg-shy-cover','leg','mid',38,3.0,'低头缩手','等、等一下，让我躲一小会儿。(*/ω＼*)','🌸',p=>({
    headY:7*envelope(p),headX:-3*envelope(p),handY:-28*beat(p,.5,.43),handAngle:.06*envelope(p),
    leg:-.007*beat(p,.57,.32),blush:envelope(p),embarrassed:.85*envelope(p),blink:beat(p,.54,.21),
  })),
  action('leg-shy-nod','leg','mid',46,2.7,'羞怯点头','嗯……我听见啦，小声一点。(｡･ω･｡)ﾉ','🌷',p=>({
    headY:5*beat(p,.35,.16)+4*beat(p,.64,.18),headAngle:-.012*envelope(p),
    leg:.006*wave(p,1.4),handY:-10*beat(p,.50,.3),blush:.85*envelope(p),
    embarrassed:.65*envelope(p),blink:beat(p,.68,.13),pulse:beat(p,.42,.2),
  })),
  action('leg-shy-toe-sway','leg','mid',54,3.4,'并脚小摇晃','我、我才没有偷偷开心呢。(〃ω〃)','🌸',p=>({
    leg:.010*wave(p,2.1),headX:4*wave(p,.75),headY:3*envelope(p),headAngle:.012*wave(p,.75),
    tail:.027*wave(p,1.5),blush:envelope(p),embarrassed:.65*envelope(p),hearts:.30*beat(p,.7,.22),
  })),
  action('leg-shy-flutter','leg','mid',62,3.1,'羞笑眨眨眼','再看我，我就要脸红啦。(///▽///)','🌷',p=>({
    blink:Math.max(beat(p,.29,.085),beat(p,.50,.085)),headAngle:.014*beat(p,.67,.3),
    headY:4*envelope(p),leg:-.009*beat(p,.35,.25)+.005*beat(p,.75,.22),
    handY:-17*beat(p,.65,.3),blush:envelope(p),embarrassed:.75*envelope(p),hearts:.4*beat(p,.78,.18),
  })),
  action('tail-shy-curl','tail','mid',30,2.9,'害羞卷尾','尾巴好像比我先害羞了。(⁄ ⁄•⁄ω⁄•⁄ ⁄)','🌸',p=>({
    tail:-.060*envelope(p),headX:3*envelope(p),headY:5*envelope(p),headAngle:-.010*envelope(p),
    blush:envelope(p),embarrassed:.9*envelope(p),blink:beat(p,.45,.15),
  })),
  action('tail-shy-guard','tail','mid',38,3.2,'羞怯缩手','轻轻的就好……我会不好意思。(〃´-ω･)','🌷',p=>({
    tail:-.048*beat(p,.58,.38),handY:-23*envelope(p),handAngle:.055*envelope(p),
    headY:6*beat(p,.48,.35),headAngle:.011*wave(p,.6),blush:envelope(p),
    embarrassed:.8*envelope(p),leg:-.004*beat(p,.4,.33),
  })),
  action('tail-shy-tip-flick','tail','mid',46,2.8,'尾尖轻颤','咦，尾巴自己动起来了……(｡>ω<｡)','🌸',p=>({
    tail:.035*wave(p,3.1)-.025*envelope(p),headX:-4*beat(p,.4,.3),headAngle:.012*beat(p,.65,.28),
    blink:beat(p,.29,.1),blush:envelope(p),embarrassed:.9*envelope(p),pulse:beat(p,.54,.25),
  })),
  action('tail-shy-glance','tail','mid',54,3.3,'偷看又低头','只是偷偷看你一眼啦。(｡･ω･｡)♡','🌷',p=>({
    headX:6*beat(p,.28,.23)-3*beat(p,.70,.27),headAngle:.015*beat(p,.28,.23)-.010*beat(p,.70,.27),
    headY:5*beat(p,.72,.23),tail:-.045*beat(p,.35,.28)+.027*beat(p,.75,.20),
    blush:envelope(p),embarrassed:.65*envelope(p),hearts:.35*beat(p,.6,.27),
  })),
  action('tail-shy-bob','tail','mid',62,3.1,'羞怯晃尾点头','嗯……这次就让你摸一下下。(〃ω〃)','🌸',p=>({
    tail:.043*wave(p,1.8),headY:4*beat(p,.32,.15)+5*beat(p,.62,.17),headX:2*wave(p,1),
    handY:-12*beat(p,.48,.33),handAngle:.027*wave(p,1.4),blush:envelope(p),
    embarrassed:.6*envelope(p),hearts:.45*beat(p,.72,.22),blink:beat(p,.64,.12),
  })),
  action('leg-close-nod','leg','high',70,2.9,'亲近小点头','在呢，今天也想陪你一起呀。(｡･ω･｡)♡','💕',p=>({
    headX:5*envelope(p),headY:4*beat(p,.32,.18)+3*beat(p,.65,.18),headAngle:.010*envelope(p),
    leg:.006*wave(p,1.1),hearts:envelope(p),blush:.5*envelope(p),blink:beat(p,.65,.12),
  })),
  action('leg-happy-feet','leg','high',76,3.5,'开心晃晃脚','你一来，我的心情就亮起来啦！(๑>◡<๑)','✨',p=>({
    leg:.012*wave(p,2.7),headY:-3*wave(p,2.7),headAngle:.010*wave(p,1.35),
    tail:.035*wave(p,1.8),hearts:.9*envelope(p),blush:.45*envelope(p),pulse:beat(p,.58,.28),
  })),
  action('leg-close-lean','leg','high',82,3.6,'歪头贴贴','再陪我工作一会儿，好不好？(づ｡◕‿‿◕｡)づ','💗',p=>({
    headX:8*envelope(p),headY:2*envelope(p),headAngle:.018*envelope(p),
    leg:-.006*envelope(p),handY:-15*beat(p,.5,.4),hearts:envelope(p),blush:.7*envelope(p),
    blink:beat(p,.55,.20),tail:.025*wave(p,.7),
  })),
  action('leg-heart-bounce','leg','high',88,3.2,'爱心小欢呼','收到你的关心啦，给你一颗心！(♡˙︶˙♡)','💖',p=>({
    leg:.009*wave(p,1.5),headY:-4*beat(p,.30,.18)-3*beat(p,.63,.18),
    handY:-26*beat(p,.45,.34),handAngle:.06*wave(p,1.2),hearts:envelope(p),
    blush:.6*envelope(p),pulse:Math.max(beat(p,.30,.16),beat(p,.63,.16)),bounce:-3*wave(p,1.5),
  })),
  action('leg-playful-tilt','leg','high',94,3.5,'俏皮左右歪头','猜猜我接下来要向哪边晃？(๑˃̵ᴗ˂̵)و','✨',p=>({
    headX:6*wave(p,1.5),headAngle:.018*wave(p,1.5),headY:-2*envelope(p),
    leg:-.011*wave(p,1.5),tail:.04*wave(p,1.2),blink:beat(p,.69,.11),
    hearts:.8*envelope(p),blush:.5*envelope(p),pulse:beat(p,.76,.18),
  })),
  action('tail-heart-curl','tail','high',70,3.0,'爱心卷尾','小尾巴也想和你打招呼～(｡･ω･｡)♡','💕',p=>({
    tail:-.065*envelope(p),headAngle:.012*envelope(p),headX:4*envelope(p),
    hearts:envelope(p),blush:.5*envelope(p),handY:-12*beat(p,.5,.35),blink:beat(p,.60,.13),
  })),
  action('tail-friendly-wave','tail','high',76,3.4,'摇尾欢迎','看到你啦！欢迎回来呀！ヾ(≧▽≦*)o','✨',p=>({
    tail:.075*wave(p,2.4),headX:3*wave(p,1.2),headAngle:.012*wave(p,1.2),
    handY:-22*envelope(p),handAngle:.07*wave(p,2.4),hearts:.9*envelope(p),
    blush:.45*envelope(p),pulse:beat(p,.5,.3),
  })),
  action('tail-cozy-sway','tail','high',82,3.8,'依偎轻摇','就这样慢慢陪着你，我很开心。(´｡• ω •｡`)♡','💗',p=>({
    tail:.050*wave(p,.8),headX:7*envelope(p),headAngle:.015*envelope(p),headY:2*wave(p,.8),
    leg:.004*wave(p,.8),blink:beat(p,.5,.2),hearts:envelope(p),blush:.65*envelope(p),
  })),
  action('tail-eager-nod','tail','high',88,3.0,'乖巧点头应答','嗯嗯，听到啦！一起完成下一步！(๑•̀ㅂ•́)و✧','💖',p=>({
    headY:6*beat(p,.28,.13)+5*beat(p,.55,.14),headAngle:-.008*envelope(p),
    tail:.060*wave(p,1.6),handY:-19*beat(p,.65,.25),handAngle:-.045*beat(p,.65,.25),
    hearts:envelope(p),blush:.4*envelope(p),pulse:beat(p,.69,.18),
  })),
  action('tail-playful-peek','tail','high',94,3.7,'俏皮躲猫猫','尾巴藏好啦——还是被你找到啦！(๑˃̵ᴗ˂̵)♡','✨',p=>({
    tail:-.07*beat(p,.30,.25)+.065*beat(p,.73,.23),headX:-6*beat(p,.30,.23)+7*beat(p,.73,.23),
    headAngle:-.015*beat(p,.30,.23)+.016*beat(p,.73,.23),blink:beat(p,.64,.11),
    handY:-18*beat(p,.42,.3),hearts:envelope(p),blush:.55*envelope(p),pulse:beat(p,.77,.18),
  })),
]);

// These twenty gesture families use separate head, hand and accessory paths.
// Each tier changes timing, direction, amplitude and secondary motion, so an
// unlocked variation is a different performance rather than a caption swap.
const extraGestures={
  head:[
    (p,k)=>({headY:k.g*(3.6*beat(p,.29+k.shift,.15)+2.2*beat(p,.65-k.shift,.17)),
      headAngle:k.sign*.004*envelope(p),hair:-2.3*k.g*wave(p,1.1+k.tempo),ahoge:3.5*k.g*wave(p,1.5+k.tempo)}),
    (p,k)=>({headX:k.sign*4.6*k.g*envelope(p),headAngle:k.sign*.011*k.g*beat(p,.53+k.shift,.43),
      headY:1.8*k.g*wave(p,.65+k.tempo),hair:3.8*k.sign*wave(p,.85+k.tempo),ear:k.sign*.009*envelope(p)}),
    (p,k)=>({headY:5.4*k.g*beat(p,.43+k.shift,.35)-1.4*beat(p,.8,.16),
      headX:1.6*k.sign*wave(p,1.3+k.tempo),hair:3*k.g*beat(p,.57,.31),ahoge:-6.5*k.g*beat(p,.49,.34)}),
    (p,k)=>({headX:3.5*k.g*wave(p,1.6+k.tempo),headAngle:.009*k.sign*wave(p,1.6+k.tempo),
      hair:6.4*k.g*wave(p,2+k.tempo),ahoge:7.2*k.g*wave(p,2.4+k.tempo),tail:.013*wave(p,.9+k.tempo)}),
    (p,k)=>({headX:k.sign*5.2*k.g*beat(p,.61-k.shift,.35),headY:-3.4*k.g*beat(p,.34+k.shift,.23),
      headAngle:k.sign*.012*beat(p,.65,.30),hair:3.4*wave(p,.7+k.tempo),ahoge:4.8*k.g*beat(p,.39,.29),handY:-4.5*envelope(p)}),
  ],
  horn:[
    (p,k)=>({headX:-k.sign*3.8*k.g*beat(p,.31+k.shift,.23)+k.sign*1.4*beat(p,.72,.19),
      headAngle:-k.sign*.012*k.g*beat(p,.39,.29),ear:-k.sign*.012*beat(p,.35,.24),hair:-3*wave(p,1+k.tempo)}),
    (p,k)=>({headY:-2.9*k.g*beat(p,.27+k.shift,.21)+2.5*k.g*beat(p,.62,.23),
      headAngle:.004*k.sign*wave(p,1.4+k.tempo),ahoge:9.5*k.g*wave(p,1.7+k.tempo),hair:2.8*wave(p,1.5+k.tempo)}),
    (p,k)=>({headAngle:k.sign*.008*k.g*wave(p,.8+k.tempo),ear:.021*k.g*wave(p,2.2+k.tempo),
      headX:k.sign*2.6*beat(p,.65-k.shift,.27),ahoge:4.1*wave(p,1.4+k.tempo),tail:.011*wave(p,1.7+k.tempo)}),
    (p,k)=>({headX:3.9*k.g*wave(p,1.9+k.tempo),headAngle:-.011*k.g*wave(p,1.9+k.tempo),
      headY:1.2*envelope(p),ear:-.01*k.sign*wave(p,1.4+k.tempo),hair:4.6*wave(p,1.5+k.tempo)}),
    (p,k)=>({headX:k.sign*(3.7*k.g*beat(p,.27,.23)-2.3*beat(p,.70+k.shift,.24)),
      headAngle:k.sign*(.010*beat(p,.28,.21)-.007*beat(p,.73,.21)),
      headY:2.8*k.g*beat(p,.74,.20),ahoge:6.3*wave(p,1.2+k.tempo),ear:.011*k.sign*envelope(p)}),
  ],
  cheek:[
    (p,k)=>({headX:-k.sign*4.9*k.g*beat(p,.32+k.shift,.27)+k.sign*2.7*beat(p,.71,.22),
      headY:-1.8*beat(p,.30,.20),headAngle:-k.sign*.010*beat(p,.34,.29),hair:-3.2*wave(p,1.1+k.tempo)}),
    (p,k)=>({headY:3.1*k.g*beat(p,.42+k.shift,.31),headAngle:k.sign*.007*wave(p,.75+k.tempo),
      headX:k.sign*2.1*beat(p,.65,.27),ear:.013*wave(p,1.65+k.tempo),ahoge:3.9*wave(p,1.9+k.tempo)}),
    (p,k)=>({headX:k.sign*4.3*k.g*envelope(p),headAngle:-k.sign*.012*k.g*envelope(p),
      headY:2.3*wave(p,.85+k.tempo),hair:3.1*wave(p,1.3+k.tempo),tail:-.018*k.g*beat(p,.60,.32)}),
    (p,k)=>({headY:3.9*k.g*beat(p,.51+k.shift,.37),headX:-k.sign*2.7*beat(p,.45,.29),
      handY:-9.5*k.g*beat(p,.55,.34),handAngle:k.sign*.018*envelope(p),ear:-.009*envelope(p)}),
    (p,k)=>({headX:k.sign*4.7*k.g*beat(p,.59-k.shift,.34),headAngle:k.sign*.014*k.g*beat(p,.59,.34),
      headY:2.6*beat(p,.27,.16)+1.7*k.g*beat(p,.70,.17),hair:4.2*k.sign*wave(p,.9+k.tempo),ear:.013*wave(p,.8+k.tempo)}),
  ],
  hand:[
    (p,k)=>({handY:-10.5*k.g*beat(p,.30+k.shift,.23)+2.8*beat(p,.72,.19),handAngle:-k.sign*.026*beat(p,.39,.28),
      headX:k.sign*2.3*envelope(p),headY:-2.1*beat(p,.30,.22),hair:1.5*wave(p,1.2+k.tempo)}),
    (p,k)=>({handY:-5.8*k.g*beat(p,.30,.19)+3.7*k.g*beat(p,.54+k.shift,.12),
      handAngle:k.sign*.031*beat(p,.35,.27),headY:2.8*beat(p,.56,.17),ahoge:3.1*wave(p,1.3+k.tempo)}),
    (p,k)=>({handY:-14.2*k.g*beat(p,.53+k.shift,.39),handAngle:k.sign*.041*k.g*envelope(p),
      headX:k.sign*3.5*beat(p,.60,.30),headAngle:k.sign*.009*envelope(p),tail:.016*wave(p,.8+k.tempo)}),
    (p,k)=>({handAngle:k.sign*.047*k.g*wave(p,1.15+k.tempo),handY:-8.1*k.g*envelope(p),
      headAngle:-k.sign*.008*wave(p,.9+k.tempo),headY:2.2*beat(p,.69,.24),ear:.011*wave(p,1.2+k.tempo)}),
    (p,k)=>({handY:-9.6*k.g*beat(p,.27,.19)+2.4*beat(p,.42,.1)-8.2*k.g*beat(p,.65+k.shift,.20)+2.1*beat(p,.83,.1),
      handAngle:k.sign*.028*wave(p,1.7+k.tempo),headY:2.8*beat(p,.44,.13)+2.1*beat(p,.79,.13),
      headX:2*k.sign*wave(p,1.2+k.tempo),ahoge:3.6*wave(p,1.8+k.tempo)}),
  ],
};
const extraTexts={
  head:{
    low:[['tiny-nod','轻轻点头','欸，是摸摸头呀……轻轻的就好。(｡･ω･｡)'],
      ['check-tilt','侧头确认','先让我看看，是谁的小手呀？(・ω・)'],
      ['little-duck','缩缩小脑袋','呜，突然摸头会吓一小跳呢。(｡>﹏<｡)'],
      ['fringe-quiver','刘海轻轻颤','发丝刚梳好，慢慢顺着摸哦。(*´ω｀*)'],
      ['look-up','抬头小提醒','可以先和我打个招呼嘛？(｡･∀･)ﾉ']],
    mid:[['shy-nod','害羞点点头','嗯……这个力道，刚刚好。(〃ω〃)'],
      ['shy-tilt','歪头藏笑','被摸头之后，我有一点点开心。(⁄ ⁄•⁄ω⁄•⁄ ⁄)'],
      ['bashful-duck','低头藏笑','不许笑我脸红啦……(*/ω＼*)'],
      ['soft-swish','发梢羞怯摆','头发好像也在偷偷开心呢。(*´꒳`*)'],
      ['peek-up','抬眼偷看','我只是……想再看看你。(｡･ω･｡)♡']],
    high:[['trusting-nod','闭眼小点头','嗯嗯，我把小脑袋放心交给你啦。(´｡•ω•｡`)'],
      ['palm-tilt','贴掌小歪头','歪过来一点，这边也想要摸摸～(๑>◡<๑)'],
      ['praise-duck','低头等夸夸','今天认真工作了，想听一句夸夸。(｡･ω･｡)♡'],
      ['happy-swish','开心摇摇头','摸摸收到！发丝和呆毛一起开心～ヾ(≧▽≦*)o'],
      ['palm-lean','主动靠近掌心','我过来一点点，继续陪着你呀。(*´ω｀*)']],
  },
  horn:{
    low:[['careful-tilt','侧头护好龙角','龙角要轻轻碰，不可以抓住摇哦。(｡･ω･｡)'],
      ['surprise-bob','小小惊讶点头','咦，你发现我的龙角啦？(・ω・)'],
      ['ear-quiver','耳尖轻轻一颤','有点不习惯……慢一点嘛。(｡>﹏<｡)'],
      ['gentle-no','轻摇头提醒','角尖很精致，要温柔一点哦。(๑•̀ω•́)و'],
      ['check-back','回头认真确认','先看看就好，让我适应一下下。(*´-ω･)']],
    mid:[['shy-angle','羞怯侧过头','这样轻轻碰……我不躲啦。(〃ω〃)'],
      ['ahoge-bob','呆毛羞答答','咦，连呆毛都跟着晃了……(⁄ ⁄•⁄ω⁄•⁄ ⁄)'],
      ['bashful-ears','害羞耳尖颤','你盯着看，我会不好意思的。(｡>ω<｡)'],
      ['soft-sway','慢慢晃晃头','嗯，这次可以再靠近一点点。(*´꒳`*)'],
      ['secret-peek','偷偷回望','我的龙角……你觉得好看吗？(〃´-ω･)']],
    high:[['offer-angle','放心侧头给你看','给你看漂亮的角纹，我信任你呀。(｡･ω･｡)♡'],
      ['proud-bob','小骄傲点头','这是我的小龙角，亮晶晶的！(๑>◡<๑)'],
      ['happy-ears','耳尖欢快回应','知道是你啦，耳尖都放松了。(*´ω｀*)'],
      ['playful-sway','俏皮轻晃龙角','看，我会很小心地晃一晃～(๑˃̵ᴗ˂̵)و'],
      ['trusting-look','回望乖巧应答','嗯，我听着呢，慢慢告诉我吧。(´｡•ω•｡`)']],
  },
  cheek:{
    low:[['little-recoil','小小缩脸','哎呀，被轻轻戳到了！(｡>﹏<｡)'],
      ['surprise-blink','惊讶眨眨眼','欸……先说一声，我会紧张啦。(・ω・)'],
      ['pout-turn','鼓腮别过头','脸颊只可以轻轻碰一下哦。(｡•ˇ‸ˇ•｡)'],
      ['bashful-hide','低头小躲闪','让我先躲一小会儿嘛。(*/ω＼*)'],
      ['careful-nod','谨慎歪头确认','这样轻轻的，就不会吓到我啦。(*´ω｀*)']],
    mid:[['blushing-return','脸红又转回来','别突然戳啦……我又脸红了。(〃ω〃)'],
      ['shy-blinks','羞怯连眨眼','看、看见你啦，不用再提醒啦。(⁄ ⁄•⁄ω⁄•⁄ ⁄)'],
      ['hide-a-smile','别头藏笑','我才没有偷偷笑呢……(〃´-ω･)'],
      ['lower-a-hand','低头羞怯缩手','有一点点不好意思，让我缓一缓。(｡>ω<｡)'],
      ['soft-cheek-tilt','温柔歪歪头','嗯……收到你的关心啦。(*´꒳`*)']],
    high:[['come-back','躲一下又靠回来','嘿嘿，躲一下——又回来陪你啦！(๑>◡<๑)'],
      ['happy-blinks','开心眨眼应答','知道你在呀，我也在看着你。(｡･ω･｡)♡'],
      ['playful-pout','俏皮鼓鼓脸','再戳就送你一个小小鼓腮脸～( •̀⤙•́ )'],
      ['cozy-lower','安心低头微笑','有你在旁边，心里暖乎乎的。(*´ω｀*)'],
      ['palm-nuzzle','歪头贴近手心','借你的手心，轻轻靠一小会儿。(´｡•ω•｡`)♡']],
  },
  hand:{
    low:[['small-retreat','小心缩回手','唔，先让我把鼠标放稳啦。(｡･ω･｡)'],
      ['tap-reply','轻点一下回应','收到啦，我轻轻点一下回应你。(・ω・)'],
      ['tentative-lift','试着抬抬手','是想和我打招呼吗？(*´-ω･)'],
      ['careful-turn','谨慎转转手腕','手背要轻轻碰，我正在工作呢。(๑•̀ω•́)و'],
      ['two-soft-taps','两下小小回应','嗯、嗯，我听见啦。(｡･∀･)ﾉ']],
    mid:[['shy-withdraw','害羞缩手又放好','忽然碰到手背，会有点害羞嘛。(〃ω〃)'],
      ['bashful-tap','羞怯轻点回应','这一下，算我悄悄回应你。(⁄ ⁄•⁄ω⁄•⁄ ⁄)'],
      ['little-wave','小幅抬手招呼','那……我也和你挥挥手。(*´꒳`*)'],
      ['shy-wrist','手腕羞答答','不是在躲你，只是有点不好意思。(｡>ω<｡)'],
      ['secret-two-taps','偷偷点两下','两下小回应，只有你知道呀。(〃´-ω･)']],
    high:[['return-to-you','缩手再靠近','等我一下，好啦，回应你的手手～(๑>◡<๑)'],
      ['friendly-tap','轻点手背应答','碰一下，今天也一起加油！(๑•̀ㅂ•́)و✧'],
      ['offer-hand','主动抬手回应','我也抬起手，认真回应你的招呼。(｡･ω･｡)♡'],
      ['happy-wave','开心转腕招手','在这里呀，想把好心情分给你！ヾ(≧▽≦*)o'],
      ['promise-taps','两下默契小约定','轻轻两下，说好继续一起努力。(*´ω｀*)♡']],
  },
};
const extraReactions=[];
const legacyPoints={low:[0,6,12,18,24],mid:[30,38,46,54,62],high:[70,76,82,88,94]};
for(const [target,tierTexts] of Object.entries(extraTexts)){
  for(const [tier,entries] of Object.entries(tierTexts))entries.forEach(([name,label,text],index)=>{
    const rank={low:0,mid:1,high:2}[tier];
    const k={g:.66+rank*.14,tempo:rank*.22,shift:(rank-1)*.045,sign:(index+rank)%2?1:-1};
    const profile=p=>{
      const e=envelope(p),geometry=extraGestures[target][index](p,k);
      return {...geometry,blink:Math.max(beat(p,.31+index*.045+rank*.025,.085+rank*.023),
        index===1||tier==='high'&&index===0?beat(p,.68+rank*.015,.09+rank*.015):0),
        blush:(tier==='low'?.18:tier==='mid'?.68:.42)*e,
        embarrassed:(tier==='mid'?.65:tier==='low'?.28:0)*e,
        hearts:tier==='high'?(.58+index*.045)*beat(p,.62,.36):tier==='mid'?.16*beat(p,.76,.18):0,
        pulse:(.2+rank*.1)*beat(p,.41+index*.05,.17)};
    };
    extraReactions.push(action(`${target}-${tier}-${name}`,target,tier,legacyPoints[tier][index],
      2.35+index*.15+rank*.18,label,text,tier==='high'?'♡':tier==='mid'?'🌸':'✧',profile,
      {pose:tier==='high'?'affectionate':'shy'}));
  });
}
export const REACTIONS=Object.freeze([...originalReactions,...extraReactions]);
const byId=new Map(REACTIONS.map(record=>[record.id,record]));

export function tierFromLevel(value){const n=affection(value);return n<4?'low':n<7?'mid':'high';}
export const affectionTier=tierFromLevel;
export function unlockedReactions(value,target){
  const n=affection(value),tier=affectionTier(n);
  return REACTIONS.filter(record=>record.target===target&&record.tier===tier&&record.unlock<=n);
}
export function allUnlockedReactions(value,target){
  const n=affection(value);
  return REACTIONS.filter(record=>(target===undefined||record.target===target)&&record.unlock<=n);
}
const idle=()=>({active:false,record:null,progress:0,channels:zero()});

// Public deterministic sampler is also the non-mutating preview / QA entry point.
export function sampleReaction(recordOrId,ageSeconds){
  const record=byId.get(typeof recordOrId==='string'?recordOrId:recordOrId?.id);
  if(!record||!finite(ageSeconds)||ageSeconds<0)return idle();
  const progress=clamp(ageSeconds/record.duration,0,1),channels=zero();
  if(progress>0&&progress<1){
    const raw=profiles.get(record.id)(progress);
    for(const [key,[lo,hi]] of Object.entries(limits))
      channels[key]=clamp(finite(raw[key])?raw[key]:0,lo,hi);
  }
  return {active:ageSeconds<record.duration,record,progress,channels};
}

export function createReactionController({random=Math.random}={}){
  let current=null;
  const previous=new Map();
  function sample(time){
    if(!current||!finite(time))return idle();
    const value=sampleReaction(current.record,Math.max(0,time-current.start));
    if(!value.active){current=null;return idle();}
    return value;
  }
  return {
    trigger(target,value,time){
      if(!AFFECTION_TARGETS.includes(target))return {accepted:false,record:null,reason:'invalid_target'};
      if(!finite(time))return {accepted:false,record:null,reason:'invalid_time'};
      if(sample(time).active)return {accepted:false,record:current.record,reason:'busy'};
      const pool=unlockedReactions(value,target),key=`${target}:${affectionTier(value)}`;
      if(pool.length===0)return {accepted:false,record:null,reason:'locked'};
      const last=previous.get(key),index=pool.findIndex(record=>record.id===last);
      let next;
      if(index>=0)next=(index+1)%pool.length;
      else{let r=0;try{r=random();}catch{}next=Math.floor(clamp(finite(r)?r:0,0,.999999999)*pool.length);}
      const record=pool[next];
      current={record,start:time};previous.set(key,record.id);
      return {accepted:true,record};
    },
    sample,
    cancel(){current=null;},
  };
}
