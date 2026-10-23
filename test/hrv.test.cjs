const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({window:{Lab:{}}});for(const name of ['hrv','recording'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),context);
const {hrv:H,recording:R}=context.window.Lab,t=Date.UTC(2026,9,23);
function createSession(){const s={execution:{status:'running',stageIndex:0,phase:'effort'},stages:[{power:120}]};R.beginRecording(s,t);return s}
function feedBeats(s,start=t,count=260){let at=start;for(let i=0;i<count;i++){const rr=500+20*Math.sin(i*1.7)+10*Math.sin(i*.13);at+=rr;H.capturePacket(s,{timestamp:at,rr:[rr],contact:true});H.captureEstimate(s,at)}return at}
test('DFA rejects short and constant series, and preserves affine invariance',()=>{
 assert.equal(H.computeAlpha1(Array(200).fill(500)),null);assert.equal(H.computeAlpha1([500,501]),null);
 assert.equal(H.computeAlpha1([...Array(200).fill(500),NaN]),null);
 const rr=Array.from({length:257},(_,i)=>500+20*Math.sin(i*1.7)+10*Math.sin(i*.13));
 // Independent NumPy polyfit reference: profile, forward/reverse segment matrices,
 // polynomial least squares residuals, then polyfit(log(scale), log(RMS)).
 assert.ok(Math.abs(H.computeAlpha1(rr)-0.2662093058210164)<1e-10);
 assert.ok(Math.abs(H.computeAlpha1(rr)-H.computeAlpha1(rr.map(x=>x*2+100)))<1e-10);
});
test('two minutes of actual RR are required; multi-beat notifications are never resampled',()=>{
 const s=createSession();let now=feedBeats(s,t,100);assert.equal(H.readCurrent(s,now).status,'collecting');
 now=feedBeats(s,now,170);const result=H.readCurrent(s,now+5000);assert.equal(result.status,'valid');assert.ok(Number.isFinite(result.alpha1));
 assert.equal(s.recording.hrv.packets.length,270);assert.equal(s.recording.hrv.packets[0].rr.length,1);
 H.capturePacket(s,{timestamp:now+1000,rr:[499,501],contact:true});assert.deepEqual(Array.from(s.recording.hrv.packets.at(-1).rr),[499,501]);
 assert.equal(H.readCurrent(s,now+6001).status,'stale');
});
test('pause, disconnect, lost contact, missing beats and clock gaps cannot reuse a prior window',()=>{
 for(const reason of ['pause','disconnected','contact','gap']){
  const s=createSession(),now=feedBeats(s);assert.equal(H.readCurrent(s,now+1).status,'valid');
  if(reason==='pause'){R.stopRecording(s,now);s.execution.status='paused';H.capturePacket(s,{timestamp:now+500,rr:[500]});assert.equal(s.recording.hrv.packets.length,260);s.execution.status='running';R.beginRecording(s,now+1000)}
  else if(reason==='disconnected')H.capturePacket(s,{timestamp:now+1000,rr:[],status:'disconnected'});
  else if(reason==='contact')H.capturePacket(s,{timestamp:now+1000,rr:[500],contact:false});
  const next=now+(reason==='gap'?7000:1500);H.capturePacket(s,{timestamp:next,rr:[500],contact:true});assert.equal(H.readCurrent(s,next).alpha1,null,reason);
 }
 const s=createSession();H.capturePacket(s,{timestamp:t+1000,rr:[]});assert.equal(H.readCurrent(s,t+1000).status,'no-rr');
 const now=feedBeats(s,t+1000);H.capturePacket(s,{timestamp:now+500,rr:[]});assert.equal(H.readCurrent(s,now+500).status,'valid');
});
test('artifacts suppress estimates while preserving unmodified raw intervals',()=>{
 const s=createSession(),now=feedBeats(s);H.capturePacket(s,{timestamp:now+1000,rr:[1000],contact:true});
 const value=H.readCurrent(s,now+5000);assert.equal(value.status,'artifacts');assert.equal(value.alpha1,null);assert.ok(value.artifactCount>0);
 assert.equal(s.recording.hrv.packets.at(-1).rr[0],1000);
 H.capturePacket(s,{timestamp:now+5100,rr:[0],contact:true});assert.equal(H.readCurrent(s,now+5100).status,'artifacts');
 assert.equal(H.countArtifacts([500,501,499,500,1000,500,502,498,500]),1);
});
test('JSON and CSV round trip retains alpha, RR precision, quality and schema; corrupt imports fail',()=>{
 const s=createSession(),now=feedBeats(s);H.captureEstimate(s,now+5000);R.stopRecording(s,now+5000,true);
 const raw=JSON.parse(JSON.stringify(s.recording)),copy=R.readRecording(raw,1);assert.deepEqual(JSON.parse(JSON.stringify(copy.hrv)),raw.hrv);
 assert.match(H.exportCsv(s),/dfa_alpha1/);assert.match(H.exportCsv(s),/valid/);assert.match(H.exportCsv(s,true),/rr_ms/);
 assert.equal(H.exportCsv(s,true).split('\r\n').length,261);
 for(const change of [x=>x.hrv.packets[0].rr=[-1],x=>x.hrv.estimates[0].alpha1=Infinity,x=>x.hrv.estimates[0].status='bad',x=>x.hrv.packets[0].timestamp=t-1]){
  const broken=JSON.parse(JSON.stringify(raw));change(broken);assert.throws(()=>R.readRecording(broken,1));
 }
 const legacy=JSON.parse(JSON.stringify(raw));delete legacy.hrv;assert.equal(R.readRecording(legacy,1).hrv,undefined);
});
