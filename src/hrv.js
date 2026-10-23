(function(){
'use strict';
const Lab=window.Lab;
const METHOD='dfa1-linear-4-16-v1',WINDOW_MS=120000,STEP_MS=5000;
const statuses=['waiting','collecting','valid','artifacts','flat','stale','no-rr','contact','disconnected'];
const trackers=new WeakMap();
function computeSlope(xs,ys){
 const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length;
 let xy=0,xx=0;for(let i=0;i<xs.length;i++){xy+=(xs[i]-mx)*(ys[i]-my);xx+=(xs[i]-mx)**2}
 return xx>0?xy/xx:null;
}
function computeAlpha1(rr){
 if(rr.length<64||rr.some(x=>!Number.isFinite(x)||x<=0))return null;
 const mean=rr.reduce((a,b)=>a+b,0)/rr.length;let sum=0;
 const profile=rr.map(value=>(sum+=value-mean)),xs=[],ys=[];
 // DFA1: integrated, mean-centred RR, linear detrending, all integer scales 4..16.
 // Use non-overlapping segments from both ends so the tail is represented.
 for(let size=4;size<=16;size++){
  const count=Math.floor(rr.length/size),mid=(size-1)/2,xx=size*(size*size-1)/12;
  let squared=0;
  for(let side=0;side<2;side++)for(let part=0;part<count;part++){
   const start=side?rr.length-(part+1)*size:part*size;
   let y=0,xy=0;for(let j=0;j<size;j++){y+=profile[start+j];xy+=(j-mid)*profile[start+j]}
   const intercept=y/size,slope=xy/xx;
   for(let j=0;j<size;j++)squared+=(profile[start+j]-intercept-slope*(j-mid))**2;
  }
  const fluctuation=Math.sqrt(squared/(2*count*size));
  if(fluctuation<1e-8)return null;
  xs.push(Math.log(size));ys.push(Math.log(fluctuation));
 }
 const alpha=computeSlope(xs,ys);return Number.isFinite(alpha)?alpha:null;
}
function countArtifacts(rr){
 return rr.reduce((count,value,i)=>{
  const local=rr.slice(Math.max(0,i-5),i+6).sort((a,b)=>a-b),mid=Math.floor(local.length/2);
  const median=local.length%2?local[mid]:(local[mid-1]+local[mid])/2;
  return count+(value<250||value>2000||Math.abs(value-median)>median*.2?1:0);
 },0);
}
function resetWindow(r,startAt,status='waiting'){
 trackers.set(r,{startAt,beats:[],lastPacketAt:null,lastBeatAt:null,status,result:null});
}
function capturePacket(s,packet){
 const r=s.recording,span=r?.spans.at(-1),now=packet.timestamp;
 if(!r||s.execution.status!=='running'||r.endedAt!==null||!span||span.endAt!==null||now<span.startAt)return;
 if(!r.hrv)r.hrv={version:1,method:METHOD,packets:[],estimates:[]};
 let tracker=trackers.get(r);if(!tracker){resetWindow(r,span.startAt);tracker=trackers.get(r)}
 const rr=packet.rr||[],status=packet.status||(packet.contact===false?'contact':rr.length?'collecting':'no-rr');
 // Keep received values, including suspect beats, unchanged for later analysis.
 if(rr.length)r.hrv.packets.push({timestamp:now,stage:s.execution.stageIndex,phase:s.execution.phase,rr:rr.slice(),contact:packet.contact??null});
 if(status==='no-rr'&&tracker.lastPacketAt!==null)return;
 if(status!=='collecting'){resetWindow(r,now,status);return}
 if(rr.some(ms=>ms<250||ms>2000)){resetWindow(r,now,'artifacts');trackers.get(r).artifactCount=rr.filter(ms=>ms<250||ms>2000).length;return}
 const duration=rr.reduce((a,b)=>a+b,0);
 if(tracker.lastPacketAt!==null&&(now-tracker.lastPacketAt>5000||now<tracker.lastPacketAt||Math.abs(tracker.lastBeatAt+duration-now)>2000)){
  resetWindow(r,now-duration);tracker=trackers.get(r);
 }
 let at=tracker.lastBeatAt??now-duration;
 for(const ms of rr){at+=ms;if(at-ms>=span.startAt&&at-ms>=tracker.startAt)tracker.beats.push({at,ms})}
 tracker.lastPacketAt=now;tracker.lastBeatAt=at;tracker.status='collecting';
 tracker.beats=tracker.beats.filter(beat=>beat.at>at-WINDOW_MS-2000);
}
function readCurrent(s,now=Date.now()){
 const r=s.recording,tracker=r&&trackers.get(r);
 if(s.execution.status!=='running')return r?.hrv?.estimates.at(-1)??{alpha1:null,status:'waiting',beatCount:0,artifactCount:0,coverageMs:0};
 const empty={alpha1:null,status:tracker?.status??'waiting',beatCount:tracker?.artifactCount||0,artifactCount:tracker?.artifactCount||0,coverageMs:0,windowStart:null,windowEnd:null};
 if(tracker?.lastPacketAt==null)return empty;
 if(now-tracker.lastPacketAt>5000||now<tracker.lastPacketAt)return {...empty,status:'stale'};
 if(tracker.result&&now-tracker.result.timestamp<STEP_MS)return tracker.result;
 const end=tracker.lastBeatAt,beats=tracker.beats.filter(beat=>beat.at>end-WINDOW_MS),rr=beats.map(beat=>beat.ms);
 const coverageMs=rr.reduce((a,b)=>a+b,0),artifactCount=countArtifacts(rr);
 const result={...empty,timestamp:now,beatCount:rr.length,artifactCount,coverageMs,windowStart:beats.length?beats[0].at-beats[0].ms:null,windowEnd:end};
 if(coverageMs<WINDOW_MS||rr.length<64)result.status='collecting';
 else if(artifactCount)result.status='artifacts';
 else{result.alpha1=computeAlpha1(rr);result.status=result.alpha1===null?'flat':'valid'}
 tracker.result=result;return result;
}
function captureEstimate(s,now=Date.now()){
 const r=s.recording;if(!r?.hrv||s.execution.status!=='running'||r.endedAt!==null)return;
 if(r.hrv.estimates.length&&now-r.hrv.estimates.at(-1).timestamp<STEP_MS)return;
 r.hrv.estimates.push({...readCurrent(s,now),timestamp:now,stage:s.execution.stageIndex,phase:s.execution.phase});
}
function describeStatus(result){
 const labels={waiting:'等待心率带 RR',collecting:`采集中 · ${Math.min(120,Math.floor((result.coverageMs||0)/1000))}/120 秒`,valid:`${result.beatCount} 搏 · 最近 2 分钟`,artifacts:`RR 异常 · ${result.artifactCount} 搏`,flat:'RR 无有效波动',stale:'RR 信号中断', 'no-rr':'心率带未提供 RR',contact:'心率带接触不良',disconnected:'心率带已断开'};
 return labels[result.status]||labels.waiting;
}
function readHrv(raw,r,stageCount){
 if(raw==null)return null;
 const invalid=()=>{throw Error('HRV 记录损坏，无法导入')};
 if(raw.version!==1||raw.method!==METHOD||!Array.isArray(raw.packets)||raw.packets.length>172800||!Array.isArray(raw.estimates)||raw.estimates.length>17280)invalid();
 const end=r.endedAt??4102444800000;
 function readRows(rows,convert){let last=r.startedAt;return rows.map(x=>{
  if(!x||!Number.isFinite(x.timestamp)||x.timestamp<last||x.timestamp>end||!Number.isInteger(x.stage)||x.stage<0||x.stage>=stageCount||!['effort','sampling'].includes(x.phase))invalid();last=x.timestamp;
  return {timestamp:x.timestamp,stage:x.stage,phase:x.phase,...convert(x)};
 })}
 let beatCount=0;
 const packets=readRows(raw.packets,x=>{
  if(!Array.isArray(x.rr)||!x.rr.length||x.rr.length>256||x.rr.some(ms=>!Number.isFinite(ms)||ms<0||ms>65535*1000/1024)||![null,true,false].includes(x.contact))invalid();
  beatCount+=x.rr.length;if(beatCount>400000)invalid();return {rr:x.rr.slice(),contact:x.contact};
 });
 const estimates=readRows(raw.estimates,x=>{
  if(!statuses.includes(x.status)||!(x.alpha1===null||Number.isFinite(x.alpha1)&&Math.abs(x.alpha1)<10)||(x.status==='valid')!==(x.alpha1!==null)||!Number.isInteger(x.beatCount)||x.beatCount<0||x.beatCount>1000||!Number.isInteger(x.artifactCount)||x.artifactCount<0||x.artifactCount>x.beatCount||!Number.isFinite(x.coverageMs)||x.coverageMs<0||x.coverageMs>200000)invalid();
  if(![x.windowStart,x.windowEnd].every(t=>t==null||Number.isFinite(t)&&t>=r.startedAt&&t<=end+2000)||x.windowStart!=null&&x.windowEnd<x.windowStart)invalid();
  return {alpha1:x.alpha1,status:x.status,beatCount:x.beatCount,artifactCount:x.artifactCount,coverageMs:x.coverageMs,windowStart:x.windowStart??null,windowEnd:x.windowEnd??null};
 });
 return {version:1,method:METHOD,packets,estimates};
}
function exportCsv(s,raw=false){
 const h=s.recording?.hrv,rows=raw?
 [['received_at_ms','stage','phase','beat_in_packet','rr_ms','sensor_contact'],...(h?.packets||[]).flatMap(p=>p.rr.map((rr,i)=>[p.timestamp,p.stage+1,p.phase,i+1,rr,p.contact]))]:
 [['timestamp_ms','stage','phase','dfa_alpha1','status','beat_count','artifact_count','window_start_ms','window_end_ms','coverage_ms','method'],...(h?.estimates||[]).map(x=>[x.timestamp,x.stage+1,x.phase,x.alpha1,x.status,x.beatCount,x.artifactCount,x.windowStart,x.windowEnd,x.coverageMs,h.method])];
 return '\ufeff'+rows.map(row=>row.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
}
Lab.hrv={METHOD,computeAlpha1,countArtifacts,resetWindow,capturePacket,readCurrent,captureEstimate,describeStatus,readHrv,exportCsv};
})();
