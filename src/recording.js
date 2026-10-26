(function(){
'use strict';
const Lab=window.Lab;
const distanceStates=new WeakMap();
function beginRecording(s,now=Date.now()){
 if(!s.recording)s.recording={version:1,startedAt:now,endedAt:null,records:[],spans:[],windows:[]};
 const r=s.recording;
 if(!r.spans.length||r.spans.at(-1).endAt!==null){r.spans.push({startAt:now,endAt:null});distanceStates.delete(r);Lab.hrv?.resetWindow(r,now)}
 syncStage(s,now);
}
function syncStage(s,now=Date.now()){
 const r=s.recording;if(!r)return;const index=s.execution.stageIndex,last=r.windows.at(-1);
 if(last&&last.index!==index){last.endAt=now;if(last.effortEndAt===null)last.effortEndAt=now}
 if(!last||last.index!==index)r.windows.push({index,startAt:now,endAt:null,effortEndAt:null});
 const current=r.windows.at(-1);if(s.execution.phase==='sampling'&&current.effortEndAt===null)current.effortEndAt=now;
}
function stopRecording(s,now=Date.now(),done=false){
 const r=s.recording;if(!r)return;const span=r.spans.at(-1);if(span&&span.endAt===null)span.endAt=Math.max(span.startAt,now);
 if(done){r.endedAt=now;
  if(r.hrv){r.hrv.packets=r.hrv.packets.filter(x=>x.timestamp<=now);r.hrv.estimates=r.hrv.estimates.filter(x=>x.timestamp<=now)}const current=r.windows.at(-1);if(current){current.endAt=now;if(current.effortEndAt===null)current.effortEndAt=now}}
}
function captureRecord(s,snapshot,now=Date.now()){
 const r=s.recording;if(!r||s.execution.status!=='running'||r.endedAt!==null)return false;
 if(r.records.length&&Math.floor(r.records.at(-1).timestamp/1000)>=Math.floor(now/1000))return false;
 const {trainerConnection,trainerDistanceAt,speedAt,...values}=snapshot;
 r.records.push({timestamp:now,stage:s.execution.stageIndex,phase:s.execution.phase,targetPower:s.execution.phase==='sampling'?null:Lab.workflow?.resolveTargetPower(s.stages[s.execution.stageIndex],(s.execution.elapsedMs||0)+(s.execution.startedAt?Math.max(0,now-s.execution.startedAt):0))??s.stages[s.execution.stageIndex].power,...values,...captureDistance(r,snapshot,now)});
 return true;
}
function captureDistance(r,snapshot,now){
 let state=distanceStates.get(r);
 if(!state){state={total:r.records.findLast(x=>Number.isFinite(x.distance))?.distance??0,previous:null};distanceStates.set(r,state)}
 const spanStart=r.spans.at(-1).startAt;
 // A cached notification from before start/resume must not count warmup or paused movement.
 const raw=(snapshot.trainerDistanceAt??now)>=spanStart&&Number.isFinite(snapshot.trainerDistance)&&snapshot.trainerDistance>=0&&snapshot.trainerDistance<=0xffffff?snapshot.trainerDistance:null;
 const speed=(snapshot.speedAt??now)>=spanStart&&Number.isFinite(snapshot.speed)&&snapshot.speed>=0?snapshot.speed:null;
 const source=raw!==null?'trainer':speed!==null?'speed':null,previous=state.previous;
 let delta=source===null?null:0,startAt=now;
 if(source&&previous?.source===source&&previous.connection===snapshot.trainerConnection&&now-previous.at<=5000){
  startAt=previous.at;
  if(source==='trainer'){
   // A smaller counter normally means a device reset. Only unwrap close to uint24 rollover.
   delta=raw>=previous.raw?raw-previous.raw:previous.raw>=0xffff00&&raw<=0xff?0x1000000-previous.raw+raw:0;
  }else delta=(previous.speed+speed)/2*(now-previous.at)/1000;
 }
 if(delta!==null)state.total+=delta;
 state.previous={at:now,raw,speed,source,connection:snapshot.trainerConnection};
 return {distance:source?state.total:null,distanceDelta:delta,distanceStartAt:source?startAt:null,distanceSource:source};
}
function measureTimer(r,start,end){return r.spans.reduce((sum,span)=>sum+Math.max(0,Math.min(end,span.endAt??end)-Math.max(start,span.startAt)),0)}
function readSensorValue(key,value){
 const bounds={hr:[1,254],cadence:[0,254],power:[0,65534]}[key];
 return bounds&&Number.isFinite(value)&&value>=bounds[0]&&value<=bounds[1]?value:null;
}
function selectRecords(r,{stage=null,end=r?.endedAt??Infinity}={}){
 if(!r)return [];
 const window=stage===null?null:r.windows.find(w=>w.index===stage);
 if(stage!==null&&!window)return [];
 return r.records.filter(x=>x.timestamp>=r.startedAt&&x.timestamp<=end&&
  (stage===null||x.stage===stage&&x.timestamp>=window.startAt&&x.timestamp<=(window.endAt??end))&&
  r.spans.some(span=>x.timestamp>=span.startAt&&x.timestamp<=(span.endAt??end)));
}
function summarizeRecords(records){
 const summary={};
 for(const key of ['hr','cadence','power']){
  let sum=0,count=0,max=null;
  for(const record of records){const value=readSensorValue(key,record[key]);if(value===null)continue;sum+=value;count++;max=Math.max(max??value,value)}
  summary[key]={avg:count?sum/count:null,max,count};
 }
 return summary;
}
function summarizeStage(s,index){return summarizeRecords(selectRecords(s.recording,{stage:index}))}
function summarizeStages(s){
 const groups=new Map(),windows=new Map((s.recording?.windows||[]).map(w=>[w.index,w]));
 for(const x of selectRecords(s.recording)){
  const w=windows.get(x.stage);if(!w||x.timestamp<w.startAt||x.timestamp>(w.endAt??Infinity))continue;
  if(!groups.has(x.stage))groups.set(x.stage,[]);groups.get(x.stage).push(x);
 }
 return s.stages.map((_,index)=>summarizeRecords(groups.get(index)||[]));
}
function readStageHeartRate(s,index,summary=summarizeStage(s,index)){
 const stats=summary.hr,manual=readSensorValue('hr',s.stages[index].hr);
 return {...stats,value:stats.count?Math.round(stats.avg):manual,source:stats.count?'recorded':manual!==null?'manual':null,manual};
}
function readSampleTime(s,index,now=Date.now()){
 const st=s.stages[index],w=s.recording?.windows.find(w=>w.index===index);if(!w)return null;
 const end=w.endAt??now,time=Number(st.sampleAt)||Date.parse(st.recordedAt);
 if(s.type==='custom-workflow'&&(!Number.isFinite(st.sampleAt)||st.sampleAt<w.startAt||st.sampleAt>end))return null;
 return Number.isFinite(time)&&time>=w.startAt&&time<=end?time:Math.min(end,w.effortEndAt??end);
}
function recoverRecording(s,now=Date.now()){
 if(s.execution.status!=='running')return false;
 const r=s.recording,checkpoint=Math.max(r?.windows.at(-1)?.startAt??0,r?.records.at(-1)?.timestamp??s.execution.startedAt??now,r?.hrv?.packets.at(-1)?.timestamp??0);
 // Only the last observed instant is recoverable after a reload; never invent BLE history.
 s.execution.elapsedMs=(s.execution.elapsedMs||0)+Math.max(0,checkpoint-(s.execution.startedAt||checkpoint));
 s.execution.status='paused';s.execution.startedAt=null;stopRecording(s,checkpoint);return true;
}
function readRecording(raw,stageCount){
 if(raw==null)return null;
 const validTime=x=>Number.isFinite(x)&&x>=631065600000&&x<=4102444800000;
 const invalid=()=>{throw Error('活动记录损坏，无法导入')};
 if(raw.version!==1||!validTime(raw.startedAt)||!(raw.endedAt===null||validTime(raw.endedAt)&&raw.endedAt>=raw.startedAt)||!Array.isArray(raw.records)||raw.records.length>86400||!Array.isArray(raw.spans)||raw.spans.length>10000||!Array.isArray(raw.windows)||raw.windows.length>stageCount)invalid();
 let previous=0;
 const records=raw.records.map(x=>{
  if(!validTime(x.timestamp)||x.timestamp<raw.startedAt||raw.endedAt!==null&&x.timestamp>raw.endedAt||x.timestamp<previous||!Number.isInteger(x.stage)||x.stage<0||x.stage>=stageCount)invalid();previous=x.timestamp;
  const clean={timestamp:x.timestamp,stage:x.stage,phase:x.phase==='sampling'?'sampling':'effort',targetPower:Number.isFinite(x.targetPower)?Math.max(0,Math.min(1200,x.targetPower)):null};
  for(const [key,max] of [['power',65534],['hr',254],['cadence',254],['speed',65535/360]]){clean[key]=Number.isFinite(x[key])&&x[key]>=0&&x[key]<=max?x[key]:null;clean[key+'Source']=['power','heart','trainer'].includes(x[key+'Source'])?x[key+'Source']:null}
  for(const key of ['powerMeterPower','trainerPower','confirmedTargetPower'])if(Object.hasOwn(x,key))clean[key]=Number.isFinite(x[key])&&x[key]>=0&&x[key]<=65534?x[key]:null;
  for(const [key,min,max] of [['trainerDistance',0,0xffffff],['trainerResistance',-32768,32767],['grade',-327.68,327.67],['distance',0,42949672.94],['distanceDelta',0,42949672.94]]){
   if(Object.hasOwn(x,key))clean[key]=Number.isFinite(x[key])&&x[key]>=min&&x[key]<=max?x[key]:null;
  }
  for(const key of ['trainerDistanceSource','trainerResistanceSource'])if(Object.hasOwn(x,key))clean[key]=x[key]==='trainer'?'trainer':null;
  if(Object.hasOwn(x,'gradeSource'))clean.gradeSource=x.gradeSource==='trainerSimulation'?'trainerSimulation':null;
  if(Object.hasOwn(x,'distanceSource'))clean.distanceSource=['trainer','speed'].includes(x.distanceSource)?x.distanceSource:null;
  if(Object.hasOwn(x,'distanceStartAt'))clean.distanceStartAt=validTime(x.distanceStartAt)&&x.distanceStartAt>=raw.startedAt&&x.distanceStartAt<=x.timestamp?x.distanceStartAt:null;
  return clean;
 });
 const readRanges=(ranges,windows=false)=>{let last=raw.startedAt;return ranges.map((x,i)=>{
  if(!validTime(x.startAt)||x.startAt<last||!(x.endAt===null||validTime(x.endAt)&&x.endAt>=x.startAt)||x.endAt===null&&i!==ranges.length-1)invalid();last=x.endAt??x.startAt;
  if(windows&&(!Number.isInteger(x.index)||x.index<0||x.index>=stageCount||i>0&&x.index<=ranges[i-1].index||!(x.effortEndAt===null||validTime(x.effortEndAt)&&x.effortEndAt>=x.startAt&&(x.endAt===null||x.effortEndAt<=x.endAt))))invalid();
  return windows?{index:x.index,startAt:x.startAt,endAt:x.endAt,effortEndAt:x.effortEndAt}:{startAt:x.startAt,endAt:x.endAt};
 })};
 const r={version:1,startedAt:raw.startedAt,endedAt:raw.endedAt,records,spans:readRanges(raw.spans),windows:readRanges(raw.windows,true)};
 if(raw.hrv!=null)r.hrv=Lab.hrv.readHrv(raw.hrv,r,stageCount);
 // Exporting a running test produces a paused, self-contained snapshot on import.
 const end=r.endedAt??Math.max(r.records.at(-1)?.timestamp??r.startedAt,r.hrv?.packets.at(-1)?.timestamp??0,r.hrv?.estimates.at(-1)?.timestamp??0);
 for(const span of r.spans)if(span.endAt===null)span.endAt=Math.max(span.startAt,end);
 return r;
}
Lab.recording={beginRecording,syncStage,stopRecording,captureRecord,measureTimer,readSensorValue,selectRecords,summarizeRecords,summarizeStage,summarizeStages,readStageHeartRate,readSampleTime,recoverRecording,readRecording};
})();
