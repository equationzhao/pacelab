(function(){
'use strict';
const Lab=window.Lab,{uid,clamp,esc}=Lab.core;
const example=`- Warmup 20m ramp 40-70%
- Warmup 5m 75%
- Work 10m 91% lac 30s/60s
- Work 10m 91% lac 30s/60s
- Work 10m 91% lac 30s/60s
- Work 10m 91% lac 30s/60s
- Endurance 95m 61%
- Cooldown 20m ramp 55-40%`;
function parseDuration(text){
 const compact=String(text).replace(/\s/g,'').toLowerCase();
 if(!/^(?:\d+(?:\.\d+)?h)?(?:\d+(?:\.\d+)?m)?(?:\d+(?:\.\d+)?s)?$/.test(compact)||!compact)throw Error('时长请使用 20m、30s 或 5m30s');
 let seconds=0;for(const part of compact.matchAll(/(\d+(?:\.\d+)?)(h|m|s)/g))seconds+=Number(part[1])*({h:3600,m:60,s:1})[part[2]];
 if(!Number.isInteger(seconds)||seconds<=0||seconds>86400)throw Error('时长应为 1 秒至 24 小时的整数秒');
 return seconds;
}
function formatDuration(seconds){return `${Math.floor(seconds/3600)?Math.floor(seconds/3600)+'h':''}${Math.floor(seconds%3600/60)?Math.floor(seconds%3600/60)+'m':''}${seconds%60?seconds%60+'s':''}`||'0s'}
function validateSteps(steps,ftp){
 if(!Number.isInteger(ftp)||ftp<20||ftp>1200)throw Error('FTP 应为 20–1200 W 的整数');
 if(!Array.isArray(steps)||!steps.length||steps.length>500)throw Error('流程应包含 1–500 个分段');
 let total=0;
 return steps.map((raw,index)=>{
  const fail=message=>{throw Error(`第 ${index+1} 段：${message}`)},t=raw.target;
  if(!Number.isInteger(raw.durationSec)||raw.durationSec<=0||raw.durationSec>86400)fail('时长无效');
  total+=raw.durationSec;if(total>86400)fail('流程总时长不能超过 24 小时');
  if(!t||!['steady','ramp'].includes(t.kind)||!['percent','watts'].includes(t.unit)||![t.start,t.end].every(v=>Number.isFinite(v)&&v>0)||t.kind==='steady'&&t.start!==t.end)fail('目标功率无效');
  const watts=value=>t.unit==='percent'?value*ftp/100:value;
  if([t.start,t.end].some(v=>watts(v)<1||watts(v)>1200))fail('换算后的目标功率应为 1–1200 W');
  if(raw.repeat&&(!Number.isInteger(raw.repeat.iteration)||!Number.isInteger(raw.repeat.count)||raw.repeat.count<1||raw.repeat.count>100||raw.repeat.iteration<1||raw.repeat.iteration>raw.repeat.count))fail('重复组信息无效');
  const sample=raw.sampling;
  if(sample&&(!Number.isInteger(sample.windowSec)||sample.windowSec<=0||!Number.isInteger(sample.leadSec)||sample.leadSec<0||sample.windowSec+sample.leadSec>raw.durationSec))fail('采样窗口与提前提醒的秒数之和不能超过本段时长');
  return {id:uid(),label:String(raw.label||'Work').trim().slice(0,100),durationSec:raw.durationSec,target:{kind:t.kind,unit:t.unit,start:t.start,end:t.end},power:Math.round(watts(t.start)),endPower:Math.round(watts(t.end)),sampling:sample?{windowSec:sample.windowSec,leadSec:sample.leadSec}:null,
   ...(raw.repeat?{repeat:{iteration:raw.repeat.iteration,count:raw.repeat.count}}:{}),lactate:null,hr:null,rpe:null,quality:'normal',notes:'',recordedAt:null};
 });
}
function parseText(text,ftp){
 if(typeof text!=='string'||text.length>100000)throw Error('流程文本过长');
 const steps=[];let group=[],repeat=1,groupLine=0,label='';
 const flush=()=>{
  if(repeat>1&&!group.length)throw Error(`第 ${groupLine} 行：重复组没有分段`);
  for(let i=1;i<=repeat;i++)for(const step of group){steps.push({...step,...(repeat>1?{repeat:{iteration:i,count:repeat}}:{})});if(steps.length>500)throw Error('展开后不能超过 500 个分段')}
  group=[];repeat=1;
 };
 for(const [index,raw] of text.split(/\r?\n/).entries()){
  try{
   let line=raw.replace(/\([^()]*\)|（[^（）]*）/g,'').trim();
   if(!line){if(group.length)flush();continue}
   if(/[()（）]/.test(line))throw Error('括号未闭合或包含嵌套括号');
   const repetition=line.match(/^(.*?)\s*(\d+)x\s*$/i);
   if(repetition&&!/^\s*-/.test(line)){flush();repeat=Number(repetition[2]);groupLine=index+1;if(repeat<1||repeat>100)throw Error('重复次数应为 1–100');label=repetition[1].trim();continue}
   const bullet=/^-\s*/.test(line);line=line.replace(/^-\s*/,'');
   const duration=line.match(/^(.*?)\b(?=\d)((?:\d+(?:\.\d+)?h\s*)?(?:\d+(?:\.\d+)?m\s*)?(?:\d+(?:\.\d+)?s)?)(?=\s|$)\s+(.+)$/i);
   if(!duration||!duration[2].trim()){
    if(!bullet&&!/[\d%=\/]/.test(line)&&! /\b(lac|ramp)\b/i.test(line)){flush();label=line;continue}
    throw Error('无法识别分段，请使用「- Work 10m 91% lac 30s/60s」');
   }
   const match=duration[3].trim().match(/^(?:(ramp)\s+)?(\d+(?:\.\d+)?)([%w])?(?:\s*[-–]\s*(\d+(?:\.\d+)?))?([%w])(?:\s+lac\s+(\d+)s(?:\/(\d+)s)?)?$/i);
   if(!match)throw Error('功率请使用 91%、200w 或 ramp 40-70%；采样请使用 lac 30s/60s');
   if(!!match[1]!==!!match[4])throw Error('功率范围需显式使用 ramp 和起止值');
   if(match[3]&&match[3].toLowerCase()!==match[5].toLowerCase())throw Error('Ramp 起止功率单位必须相同');
   group.push({label:duration[1].trim()||label||'Work',durationSec:parseDuration(duration[2]),target:{kind:match[1]?'ramp':'steady',unit:match[5]==='%'?'percent':'watts',start:Number(match[2]),end:Number(match[4]??match[2])},sampling:match[6]?{windowSec:Number(match[6]),leadSec:Number(match[7]||0)}:null});
   // Validate here as well so errors point to the original text line.
   validateSteps([group.at(-1)],ftp);
  }catch(error){throw Error(`第 ${index+1} 行：${error.message}`)}
 }
 flush();return validateSteps(steps,ftp);
}
function formatTarget(stage,includeWatts=true){
 const t=stage.target;if(!t)return `${stage.power} W`;
 const unit=t.unit==='percent'?'%':'w',value=t.kind==='ramp'?`${t.start}-${t.end}${unit}`:`${t.start}${unit}`;
 return `${t.kind==='ramp'?'ramp ':''}${value}${includeWatts&&t.unit==='percent'?` (${stage.power}${t.kind==='ramp'?'-'+stage.endPower:''}w)`:''}`;
}
function formatText(stages){return stages.map(s=>`- ${s.label} ${formatDuration(s.durationSec)} ${formatTarget(s,false)}${s.sampling?` lac ${s.sampling.windowSec}s${s.sampling.leadSec?'/'+s.sampling.leadSec+'s':''}`:''}`).join('\n')}
function resolveTargetPower(stage,elapsedMs=0){
 if(stage.target?.kind!=='ramp')return stage.power;
 return Math.round(stage.power+(stage.endPower-stage.power)*clamp(Math.floor(elapsedMs/1000)/stage.durationSec,0,1));
}
function resolveDevicePower(range,power){
 if(power<range.min||power>range.max)throw Error(`目标 ${power} W 超出骑行台范围（${range.min}–${range.max} W）`);
 const max=range.min+Math.floor((range.max-range.min)/range.step)*range.step;
 return clamp(range.min+Math.round((power-range.min)/range.step)*range.step,range.min,max);
}
function readSamplingState(stage,elapsedMs){
 if(!stage.sampling)return 'none';
 const start=stage.durationSec-stage.sampling.windowSec,elapsed=elapsedMs/1000;
 if(elapsed>=stage.durationSec)return 'ended';
 if(elapsed>=start)return 'window';
 if(stage.sampling.leadSec>0&&elapsed>=start-stage.sampling.leadSec)return 'prepare';
 return 'waiting';
}
function createSession({name,athlete,text,stages,beep=true}){
 const a=Lab.tests.validAthlete(athlete),validated=stages?validateSteps(stages,a.ftp):parseText(text,a.ftp),now=new Date().toISOString();
 return {id:uid(),type:'custom-workflow',schemaVersion:2,name:String(name||'自定义流程').trim().slice(0,100),createdAt:now,updatedAt:now,athlete:{...a},protocol:{version:1,text:typeof text==='string'?text:formatText(validated),samplingMode:'assisted',beep:!!beep},metadata:{notes:'',device:'',environment:'',operator:''},restingSample:null,stages:validated,execution:{stageIndex:0,phase:'effort',status:'idle',elapsedMs:0,startedAt:null,finishedAt:null}};
}
function renderProfile(stages,elapsedSec=null){
 const total=stages.reduce((sum,s)=>sum+s.durationSec,0);if(!total)return '';
 const max=Math.max(...stages.map(s=>Math.max(s.power,s.endPower??s.power))),x=t=>36+t/total*648,y=p=>145-p/max*120;
 let time=0;
 const blocks=stages.map((s,i)=>{const start=time;time+=s.durationSec;const sample=s.sampling;
  return `<path d="M ${x(start)} 145 L ${x(start)} ${y(s.power)} L ${x(time)} ${y(s.endPower??s.power)} L ${x(time)} 145 Z" fill="${i%2?'#bbd9ad':'#d7e8cf'}" stroke="#54816a"><title>${esc(`${i+1}. ${s.label||'阶段'} · ${formatDuration(s.durationSec)} · ${formatTarget(s)}`)}</title></path>${sample?`<rect x="${x(time-sample.windowSec)}" y="18" width="${Math.max(2,sample.windowSec/total*648)}" height="127" fill="#c75b48" opacity=".65"><title>第 ${i+1} 段采样窗口</title></rect>`:''}`;
 }).join('');
 return `<svg viewBox="0 0 720 180" role="img" aria-label="计划功率曲线，红色标记为乳酸采样窗口">${blocks}<text x="36" y="166" font-size="12">0</text><text x="684" y="166" text-anchor="end" font-size="12">${esc(formatDuration(total))}</text><text x="36" y="13" font-size="12">${max} W</text>${elapsedSec===null?'':`<line id="workflow-position" x1="${x(clamp(elapsedSec,0,total))}" x2="${x(clamp(elapsedSec,0,total))}" y1="18" y2="145" stroke="#132b30" stroke-width="3"/>`}</svg>`;
}
Lab.workflow={example,parseDuration,formatDuration,parseText,validateSteps,formatText,formatTarget,resolveTargetPower,resolveDevicePower,readSamplingState,createSession,renderProfile};
})();
