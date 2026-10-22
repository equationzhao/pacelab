(function(){
'use strict';
const Lab=window.Lab;
function beginRecording(s,now=Date.now()){
 if(!s.recording)s.recording={version:1,startedAt:now,endedAt:null,records:[],spans:[],windows:[]};
 const r=s.recording;
 if(!r.spans.length||r.spans.at(-1).endAt!==null)r.spans.push({startAt:now,endAt:null});
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
 if(done){r.endedAt=now;const current=r.windows.at(-1);if(current){current.endAt=now;if(current.effortEndAt===null)current.effortEndAt=now}}
}
function captureRecord(s,snapshot,now=Date.now()){
 const r=s.recording;if(!r||s.execution.status!=='running'||r.endedAt!==null)return false;
 if(r.records.length&&Math.floor(r.records.at(-1).timestamp/1000)>=Math.floor(now/1000))return false;
 r.records.push({timestamp:now,stage:s.execution.stageIndex,phase:s.execution.phase,targetPower:s.stages[s.execution.stageIndex].power,...snapshot});
 return true;
}
function measureTimer(r,start,end){return r.spans.reduce((sum,span)=>sum+Math.max(0,Math.min(end,span.endAt??end)-Math.max(start,span.startAt)),0)}
function readSampleTime(s,index,now=Date.now()){
 const st=s.stages[index],w=s.recording?.windows.find(w=>w.index===index);if(!w)return null;
 const end=w.endAt??now,time=Number(st.sampleAt)||Date.parse(st.recordedAt);
 return Number.isFinite(time)&&time>=w.startAt&&time<=end?time:Math.min(end,w.effortEndAt??end);
}
function recoverRecording(s,now=Date.now()){
 if(s.execution.status!=='running')return false;
 const r=s.recording,checkpoint=Math.max(r?.windows.at(-1)?.startAt??0,r?.records.at(-1)?.timestamp??s.execution.startedAt??now);
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
  for(const [key,max] of [['power',65534],['hr',254],['cadence',254],['speed',65]]){clean[key]=Number.isFinite(x[key])&&x[key]>=0&&x[key]<=max?x[key]:null;clean[key+'Source']=['power','heart','trainer'].includes(x[key+'Source'])?x[key+'Source']:null}
  return clean;
 });
 const readRanges=(ranges,windows=false)=>{let last=raw.startedAt;return ranges.map((x,i)=>{
  if(!validTime(x.startAt)||x.startAt<last||!(x.endAt===null||validTime(x.endAt)&&x.endAt>=x.startAt)||x.endAt===null&&i!==ranges.length-1)invalid();last=x.endAt??x.startAt;
  if(windows&&(!Number.isInteger(x.index)||x.index<0||x.index>=stageCount||i>0&&x.index<=ranges[i-1].index||!(x.effortEndAt===null||validTime(x.effortEndAt)&&x.effortEndAt>=x.startAt&&(x.endAt===null||x.effortEndAt<=x.endAt))))invalid();
  return windows?{index:x.index,startAt:x.startAt,endAt:x.endAt,effortEndAt:x.effortEndAt}:{startAt:x.startAt,endAt:x.endAt};
 })};
 const r={version:1,startedAt:raw.startedAt,endedAt:raw.endedAt,records,spans:readRanges(raw.spans),windows:readRanges(raw.windows,true)};
 // Exporting a running test produces a paused, self-contained snapshot on import.
 const end=r.endedAt??r.records.at(-1)?.timestamp??r.startedAt;
 for(const span of r.spans)if(span.endAt===null)span.endAt=Math.max(span.startAt,end);
 return r;
}
Lab.recording={beginRecording,syncStage,stopRecording,captureRecord,measureTimer,readSampleTime,recoverRecording,readRecording};
})();
