const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const context=vm.createContext({window:{},TextEncoder});
for(const name of ['storage','core','tests','workflow','recording','fit','charts'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),context);
const {workflow:W,recording:R,fit:F,core:C,charts:Charts}=context.window.Lab;
const athlete={name:'Rider',sex:'undisclosed',age:30,ftp:294},t=Date.UTC(2026,9,26);
const plain=x=>JSON.parse(JSON.stringify(x));
test('the requested eight steps total three hours with independent samples and ignored parenthetical power',()=>{
 const stages=W.parseText(W.example,294);
 assert.equal(stages.length,8);assert.equal(stages.reduce((sum,s)=>sum+s.durationSec,0),10800);
 assert.deepEqual(plain(stages.map(s=>[s.power,s.endPower])),[[118,206],[221,221],[268,268],[268,268],[268,268],[268,268],[179,179],[162,118]]);
 assert.equal(stages.filter(s=>s.sampling).length,4);assert.equal(new Set(stages.map(s=>s.id)).size,8);
 const changed=W.parseText('- Warmup 20m ramp 40-70% (999-999w)\n- Work 5m 75% (1w)',200);
 assert.equal(changed[0].power,80);assert.equal(changed[0].endPower,140);assert.equal(changed[1].power,150);
});
test('durations, watts, uppercase, headings and single-layer repeat groups round trip',()=>{
 const stages=W.parseText('Warmup\n- 1m30s RAMP 40%-70%\nMain set 4x\n- Work 10m 91% lac 30s/60s\n- Recovery 30s 100W\n\nCooldown\n- 1.5m ramp 160w-100w',294);
 assert.equal(stages.length,10);assert.equal(stages[0].durationSec,90);assert.equal(stages[9].durationSec,90);
 assert.equal(stages[0].label,'Warmup');assert.equal(stages[9].label,'Cooldown');
 assert.deepEqual(plain(stages.slice(1,9).map(s=>s.repeat.iteration)),[1,1,2,2,3,3,4,4]);
 const again=W.parseText(W.formatText(stages),294);
 assert.deepEqual(plain(again.map(s=>[s.label,s.durationSec,s.target,s.sampling])),plain(stages.map(s=>[s.label,s.durationSec,s.target,s.sampling])));
 assert.equal(W.parseDuration('1h 5m 30s'),3930);
});
test('malformed or unsupported input cannot silently become a partial workout',()=>{
 for(const line of ['- Work 10 91%','- Work 10m 91% nonsense','- Work 10m ramp 91%','- Work 10m 40-70%','- Work 10m ramp 40w-70%','- Work 10m 91% lac 30s/600s','- Work 0s 100w','- Work 1m 1500w','- Work 1m 70% (100w','- Work 10m 91% lac 0s','- Work 10m 91% lac -30s','- Work 10m 91% lac 30/60']){
  assert.throws(()=>W.parseText('- Warmup 20m 50%\n'+line,294),/第 2 行/);
 }
 assert.throws(()=>W.parseText('4x',294),/没有分段/);
 assert.throws(()=>W.parseText('101x\n- Work 1m 100w',294),/重复次数/);
 assert.throws(()=>W.parseText('- Work 24h 100w\n- Work 1s 100w',294),/24 小时/);
 assert.throws(()=>W.parseText('100x\n'+Array(6).fill('- Work 1s 100w').join('\n'),294),/500/);
});
test('sampling window and preparation use active time and permit zero lead without an extra reminder',()=>{
 const stage=W.parseText('- Work 10m 91% lac 30s/60s',294)[0];
 assert.deepEqual([0,509999,510000,569999,570000,599999,600000].map(t=>W.readSamplingState(stage,t)),['waiting','waiting','prepare','prepare','window','window','ended']);
 const immediate=W.parseText('- Work 10m 91% lac 30s',294)[0];
 assert.equal(immediate.sampling.leadSec,0);assert.equal(W.readSamplingState(immediate,569999),'waiting');assert.equal(W.readSamplingState(immediate,570000),'window');
 assert.equal(W.readSamplingState(W.parseText('- Work 10m 91%',294)[0],599999),'none');
});
test('ramp recording resumes at the same active-time target and device rounding never clips out-of-range targets',()=>{
 const s=W.createSession({athlete,text:'- Warmup 20s ramp 100-200w'});
 Object.assign(s.execution,{status:'running',startedAt:t});R.beginRecording(s,t);R.captureRecord(s,{confirmedTargetPower:100},t);
 R.captureRecord(s,{confirmedTargetPower:150},t+10000);R.stopRecording(s,t+10000);
 Object.assign(s.execution,{status:'paused',elapsedMs:10000,startedAt:null});assert.equal(R.captureRecord(s,{},t+20000),false);
 Object.assign(s.execution,{status:'running',startedAt:t+30000});R.beginRecording(s,t+30000);R.captureRecord(s,{confirmedTargetPower:150},t+30000);R.captureRecord(s,{confirmedTargetPower:175},t+35000);
 assert.deepEqual(plain(s.recording.records.map(r=>r.targetPower)),[100,150,150,175]);
 assert.equal(W.resolveDevicePower({min:0,max:301,step:5},299),300);assert.throws(()=>W.resolveDevicePower({min:100,max:300,step:5},99),/超出/);
 assert.equal(W.resolveTargetPower(s.stages[0],20000),200);assert.equal(W.resolveTargetPower(s.stages[0],50000),200);
});
test('templates recalculate percentages at new FTP without changing original session or carrying results',()=>{
 const original=W.createSession({athlete,text:W.example});original.stages[2].lactate=2.5;
 const copy=W.createSession({athlete:{...athlete,ftp:250},stages:original.stages});
 assert.equal(original.stages[2].power,268);assert.equal(copy.stages[2].power,228);assert.equal(copy.stages[2].lactate,null);
 assert.notEqual(copy.stages[2].id,original.stages[2].id);assert.equal(original.athlete.ftp,294);
 assert.throws(()=>W.validateSteps([{...original.stages[0],repeat:{iteration:'<img>',count:4}}],294),/重复组/);
});
test('late custom samples have unknown sample times while legacy samples retain their existing fallback',()=>{
 const s=W.createSession({athlete,text:'- Work 10s 100w lac 3s/2s'});
 s.execution.status='running';R.beginRecording(s,t);R.stopRecording(s,t+10000,true);
 s.stages[0].recordedAt=new Date(t+30000).toISOString();s.stages[0].lactate=2;
 assert.equal(R.readSampleTime(s,0,t+40000),null);
 s.stages[0].sampleAt=t+8000;assert.equal(R.readSampleTime(s,0,t+40000),t+8000);
 delete s.stages[0].sampleAt;s.type='lactate-step';assert.equal(R.readSampleTime(s,0,t+40000),t+10000);
});
test('CSV preserves ramp endpoints and sampling settings, and equal-power samples remain separate by stage',()=>{
 const s=W.createSession({athlete,text:W.example});s.stages[2].lactate=2;s.stages[3].lactate=2.1;
 assert.match(C.sessionCsv(s),/target_kind/);assert.match(C.sessionCsv(s),/sample_window_sec/);assert.match(C.sessionCsv(s),/"Warmup","ramp","percent","40","70","206"/);
 const chart=Charts.renderScatter(s.stages,'lactate',true);assert.match(chart,/分段顺序/);
 const positions=[...chart.matchAll(/<circle[^>]*cx="([^"]+)"/g)].map(m=>m[1]);assert.equal(positions.length,2);assert.notEqual(positions[0],positions[1]);
});
test('official FIT decoder retains ramp targets, separate laps and late samples without inventing sample times',async testcase=>{
 if(!process.env.FIT_SDK_PATH)return testcase.skip('Set FIT_SDK_PATH');
 const s=W.createSession({athlete,text:'- Warmup 20s ramp 100-200w\n- Work 10s 180w lac 3s/2s'});
 Object.assign(s.execution,{status:'running',startedAt:t});R.beginRecording(s,t);
 for(let second=0;second<20;second++)R.captureRecord(s,{power:120,confirmedTargetPower:100+second*5},t+second*1000);
 Object.assign(s.execution,{stageIndex:1,startedAt:t+20000});R.syncStage(s,t+20000);
 R.captureRecord(s,{power:179,confirmedTargetPower:180},t+27000);R.stopRecording(s,t+30000,true);
 s.stages[1].lactate=2.7;s.stages[1].recordedAt=new Date(t+40000).toISOString();
 const {Decoder,Stream}=await import(pathToFileURL(process.env.FIT_SDK_PATH).href);
 const decoder=new Decoder(Stream.fromByteArray(F.encodeSession(s)));assert.equal(decoder.checkIntegrity(),true);
 const {messages,errors}=decoder.read();assert.deepEqual(errors,[]);assert.equal(messages.lapMesgs.length,2);
 assert.equal(messages.sessionMesgs[0].totalTimerTime,30);assert.equal(messages.recordMesgs[10].developerFields[3],150);assert.equal(messages.recordMesgs[10].developerFields[23],150);
 assert.equal(messages.lapMesgs[0].developerFields[24],200);assert.ok(Math.abs(messages.lapMesgs[1].developerFields[0]-2.7)<1e-5);
 assert.ok(messages.lapMesgs[1].developerFields[5]==null);assert.equal(messages.recordMesgs.length,21);
 const imported=R.readRecording(plain(s.recording),2);assert.equal(imported.records[10].confirmedTargetPower,150);
});
