(function(){
'use strict';
const Lab=window.Lab,R=Lab.recording;
const FIT_EPOCH=Date.UTC(1989,11,31),U8=2,S16=0x83,U16=0x84,U32=0x86,F32=0x88,STR=7;
const developerFields=[
 [0,'lactate','mmol/L',F32,4],[1,'rpe','0-10',F32,4],[2,'stage','',U16,2],[3,'target_power','W',U16,2],
 [4,'phase','',U8,1],[5,'sample_time','s',U32,4],[6,'entered_time','s',U32,4],[7,'sample_quality','',U8,1],
 [8,'resting_lactate','mmol/L',F32,4],[9,'resting_sample_time','s',U32,4],
 [10,'power_source','',U8,1],[11,'hr_source','',U8,1],[12,'cadence_source','',U8,1],[13,'dfa_alpha1','',F32,4],[14,'rr_artifact_count','beats',U16,2],[15,'rr_beat_count','beats',U16,2],[16,'hrv_status','',U8,1],
 [17,'power_meter_power','W',U16,2],[18,'trainer_power','W',U16,2],
 [19,'trainer_resistance','',F32,4],[20,'trainer_total_distance','m',U32,4],[21,'distance_source','',U8,1],[22,'grade_source','',U8,1],[23,'confirmed_target_power','W',U16,2],[24,'target_end_power','W',U16,2]
];
function fitTime(ms){return Math.floor((ms-FIT_EPOCH)/1000)}
function computeCrc(bytes){let crc=0;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xa001:crc>>>1}return crc}
function createWriter(){
 const chunks=[],definitions=new Map();
 function writeMessage(local,global,fields,dev=[]){
  const signature=JSON.stringify([global,fields.map(f=>f.slice(0,3)),dev.map(f=>f.slice(0,3))]);
  if(definitions.get(local)!==signature){
   const bytes=[0x40|(dev.length?0x20:0)|local,0,0,global&255,global>>8,fields.length];
   fields.forEach(([id,size,type])=>bytes.push(id,size,type));
   if(dev.length){bytes.push(dev.length);dev.forEach(([id,size])=>bytes.push(id,size,0))}
   chunks.push(Uint8Array.from(bytes));definitions.set(local,signature);
  }
  const data=new Uint8Array(1+fields.concat(dev).reduce((size,f)=>size+f[1],0));data[0]=local;const view=new DataView(data.buffer);let offset=1;
  for(const [,size,type,value] of fields.concat(dev)){
   if(type===STR){const bytes=new TextEncoder().encode(String(value??''));data.set(bytes.subarray(0,size-1),offset)}
   else if(Array.isArray(value)||value instanceof Uint8Array)data.set(value.slice(0,size),offset);
   else if(type===S16)view.setInt16(offset,Number.isFinite(value)&&value>=-32768&&value<32767&&Math.round(value)<32767?Math.round(value):32767,true);
   else if(value===null||value===undefined||!Number.isFinite(value))data.fill(255,offset,offset+size);
   else if(type===F32){if(Number.isFinite(Math.fround(value)))view.setFloat32(offset,value,true);else data.fill(255,offset,offset+size)}
   else if(value<0||Math.round(value)>({1:254,2:65534,4:0xfffffffe})[size])data.fill(255,offset,offset+size);
   else if(size===1)view.setUint8(offset,Math.round(value));
   else if(size===2)view.setUint16(offset,Math.round(value),true);
   else view.setUint32(offset,Math.round(value),true);
   offset+=size;
  }
  chunks.push(data);
 }
 function finishFile(){
  const size=chunks.reduce((n,x)=>n+x.length,0),bytes=new Uint8Array(14+size+2),view=new DataView(bytes.buffer);
  bytes.set([14,0x20]);view.setUint16(2,21218,true);view.setUint32(4,size,true);bytes.set([46,70,73,84],8);view.setUint16(12,computeCrc(bytes.subarray(0,12)),true);
  let offset=14;chunks.forEach(chunk=>{bytes.set(chunk,offset);offset+=chunk.length});view.setUint16(offset,computeCrc(bytes.subarray(0,offset)),true);return bytes;
 }
 return {writeMessage,finishFile};
}
function devField(id,value){const field=developerFields[id];return [id,field[4],field[3],value]}
function encodeSpeed(value){return Number.isFinite(value)&&value>=0&&Math.round(value*1000)<=65534?value*1000:null}
function summarizeMotion(records,start,end){
 let distance=null,maxSpeed=null;
 for(const x of records){
  if(x.timestamp>=start&&x.timestamp<=end){
   if(Number.isFinite(x.speed))maxSpeed=Math.max(maxSpeed??0,x.speed);
   if(Number.isFinite(x.distance))distance=distance??0;
  }
  if(!Number.isFinite(x.distanceDelta)||!Number.isFinite(x.distanceStartAt)||x.timestamp<=x.distanceStartAt)continue;
  const overlap=Math.max(0,Math.min(end,x.timestamp)-Math.max(start,x.distanceStartAt));
  if(overlap)distance=(distance??0)+x.distanceDelta*overlap/(x.timestamp-x.distanceStartAt);
 }
 return {distance,maxSpeed};
}
function encodeMotionSummary(records,r,start,end,isLap=false){
 const {distance,maxSpeed}=summarizeMotion(records,start,end),timer=R.measureTimer(r,start,end);
 const avgSpeed=distance!==null&&timer>0?distance/(timer/1000):null;
 return [[9,4,U32,distance===null?null:distance*100],[isLap?13:14,2,U16,encodeSpeed(avgSpeed)],[isLap?14:15,2,U16,encodeSpeed(maxSpeed)],
  [isLap?110:124,4,U32,avgSpeed===null?null:avgSpeed*1000],[isLap?111:125,4,U32,maxSpeed===null?null:maxSpeed*1000]];
}
function encodeSensorSummary(records,isLap=false){
 const {hr,cadence,power}=R.summarizeRecords(records),base=isLap?15:16;
 return [[base,1,U8,hr.avg],[base+1,1,U8,hr.max],[base+2,1,U8,cadence.avg],[base+3,1,U8,cadence.max],
  [base+4,2,U16,power.avg],[base+5,2,U16,power.max]];
}
function resolveRecordedTarget(s,index,at){
 const stage=s.stages[index],window=s.recording.windows.find(w=>w.index===index);
 if(!window)return null;
 if(window.effortEndAt!==null&&at>=window.effortEndAt)return null;
 return Lab.workflow?.resolveTargetPower(stage,R.measureTimer(s.recording,window.startAt,at))??stage.power;
}
function encodeSession(s,now=Date.now()){
 const r=s.recording;if(!r?.spans.length)throw Error('请先开始测试，再导出 FIT 活动');
 const end=r.endedAt??(r.spans.at(-1).endAt??now),start=r.startedAt;
 const writer=createWriter(),write=writer.writeMessage;
 const ts=ms=>[253,4,U32,fitTime(ms)];
 write(0,0,[[0,1,0,4],[1,2,U16,255],[4,4,U32,fitTime(start)],[8,16,STR,'PaceLab']]);
 write(1,207,[[1,16,13,[0xb7,0xa4,0x2a,0xf1,0x3a,0x09,0x48,0x37,0x9a,0xb8,0x50,0x61,0x63,0x65,0x4c,0x62]],[3,1,U8,0],[4,4,U32,1]]);
 developerFields.forEach(([id,name,units,type])=>write(2,206,[[0,1,U8,0],[1,1,U8,id],[2,1,U8,type],[3,28,STR,name],[6,1,U8,1],[7,1,1,0],[8,12,STR,units]]));
 write(3,12,[[0,1,0,2],[1,1,0,6],[3,16,STR,'Indoor cycling']]);
 const sensorRecords=R.selectRecords(r,{end});
 const messages=[],records=sensorRecords.map(x=>({...x,hr:R.readSensorValue('hr',x.hr),cadence:R.readSensorValue('cadence',x.cadence),power:R.readSensorValue('power',x.power)}));
 const recordsBySecond=new Map(records.map(x=>[Math.floor(x.timestamp/1000),x]));
 for(const estimate of r.hrv?.estimates||[]){
  if(estimate.timestamp>end)continue;
  let record=recordsBySecond.get(Math.floor(estimate.timestamp/1000));
  if(!record||record.stage!==estimate.stage||record.phase!==estimate.phase){record={timestamp:estimate.timestamp,stage:estimate.stage,phase:estimate.phase,targetPower:resolveRecordedTarget(s,estimate.stage,estimate.timestamp)};records.push(record)}
  record.hrv=estimate;
 }
 for(const packet of r.hrv?.packets||[]){
  if(packet.timestamp>end||packet.contact===false)continue;
  // Native FIT HRV time is uint16, scaled by 1000 (seconds); preserve raw RR to 1 ms.
  for(let start=0;start<packet.rr.length;start+=127){
   const values=packet.rr.slice(start,start+127),bytes=new Uint8Array(values.length*2),view=new DataView(bytes.buffer);
   values.forEach((ms,i)=>view.setUint16(i*2,Math.round(ms),true));
   messages.push({at:packet.timestamp,priority:1.5,run:()=>write(9,78,[[0,bytes.length,U16,bytes]])});
  }
 }
 const laps=r.windows.filter(w=>w.startAt<=end);
 laps.forEach(w=>{
  const st=s.stages[w.index];if(st.lactate==null&&st.rpe==null)return;
  const at=R.readSampleTime(s,w.index,end);if(at===null)return;const second=Math.floor(at/1000);
  let record=records.find(x=>x.stage===w.index&&Math.floor(x.timestamp/1000)===second);
  if(!record){record={timestamp:at,stage:w.index,phase:w.effortEndAt!==null&&at>=w.effortEndAt?'sampling':'effort',targetPower:resolveRecordedTarget(s,w.index,at)};records.push(record)}
  record.sample={lactate:st.lactate,rpe:st.rpe,time:fitTime(at),entered:Number.isFinite(Date.parse(st.recordedAt))?fitTime(Date.parse(st.recordedAt)):null,quality:['normal','suspect','exclude'].indexOf(st.quality)};
 });
 for(const span of r.spans){
  messages.push({at:span.startAt,priority:0,run:()=>write(4,21,[ts(span.startAt),[0,1,0,0],[1,1,0,0]])});
  const stop=Math.min(end,span.endAt??end);
  messages.push({at:stop,priority:3,run:()=>write(4,21,[ts(stop),[0,1,0,0],[1,1,0,4]])});
 }
 records.forEach(x=>messages.push({at:x.timestamp,priority:1,run:()=>write(5,20,[ts(x.timestamp),[3,1,U8,x.hr],[4,1,U8,x.cadence],[5,4,U32,x.distance==null?null:x.distance*100],[6,2,U16,encodeSpeed(x.speed)],[73,4,U32,x.speed==null?null:x.speed*1000],[7,2,U16,x.power],[9,2,S16,x.grade==null?null:x.grade*100]],
  [devField(23,x.confirmedTargetPower),devField(19,x.trainerResistance),devField(20,x.trainerDistance),devField(21,({trainer:1,speed:2})[x.distanceSource]),devField(22,x.gradeSource==='trainerSimulation'?1:null),devField(17,x.powerMeterPower),devField(18,x.trainerPower),devField(13,x.hrv?.alpha1),devField(14,x.hrv?.artifactCount),devField(15,x.hrv?.beatCount),devField(16,x.hrv?['waiting','collecting','valid','artifacts','flat','stale','no-rr','contact','disconnected'].indexOf(x.hrv.status):null),devField(0,x.sample?.lactate),devField(1,x.sample?.rpe),devField(2,x.stage+1),devField(3,x.targetPower),devField(4,x.phase==='sampling'?1:0),devField(5,x.sample?.time),devField(6,x.sample?.entered),devField(7,x.sample?.quality),...[['powerSource',10],['hrSource',11],['cadenceSource',12]].map(([key,id])=>devField(id,({power:1,heart:2,trainer:3})[x[key]]))])}));
 laps.forEach((w,i)=>{
  const stop=Math.min(end,w.endAt??end),st=s.stages[w.index],sampleTime=st.lactate!=null||st.rpe!=null?R.readSampleTime(s,w.index,end):null;
  messages.push({at:stop,priority:2,run:()=>write(6,19,[ts(stop),[254,2,U16,i],[0,1,0,9],[1,1,0,1],[2,4,U32,fitTime(w.startAt)],[7,4,U32,stop-w.startAt],[8,4,U32,R.measureTimer(r,w.startAt,stop)],[25,1,0,2],[39,1,0,6],...encodeMotionSummary(records,r,w.startAt,stop,true),...encodeSensorSummary(R.selectRecords(r,{stage:w.index,end:stop}),true)],
   [devField(24,st.endPower),devField(0,st.lactate),devField(1,st.rpe),devField(2,w.index+1),devField(3,st.target?.kind==='ramp'?null:st.power),devField(5,sampleTime===null?null:fitTime(sampleTime)),devField(6,Number.isFinite(Date.parse(st.recordedAt))?fitTime(Date.parse(st.recordedAt)):null),devField(7,['normal','suspect','exclude'].indexOf(st.quality))])});
 });
 messages.sort((a,b)=>a.at-b.at||a.priority-b.priority).forEach(message=>message.run());
 const timer=R.measureTimer(r,start,end),rest=s.restingSample;
 write(7,18,[ts(end),[254,2,U16,0],[0,1,0,8],[1,1,0,1],[2,4,U32,fitTime(start)],[5,1,0,2],[6,1,0,6],[7,4,U32,end-start],[8,4,U32,timer],[25,2,U16,0],[26,2,U16,laps.length],...encodeMotionSummary(records,r,start,end),...encodeSensorSummary(sensorRecords)],
  [devField(8,rest?.skipped?null:rest?.lactate),devField(9,Number.isFinite(Date.parse(rest?.recordedAt))?fitTime(Date.parse(rest.recordedAt)):null)]);
 write(8,34,[ts(end),[0,4,U32,timer],[1,2,U16,1],[2,1,0,0],[3,1,0,26],[4,1,0,1]]);
 return writer.finishFile();
}
Lab.fit={encodeSession,computeCrc,fitTime,developerFields};
})();
