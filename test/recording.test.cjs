const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({window:{Lab:{}}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/recording.js'),'utf8'),context);
const R=context.window.Lab.recording,t=Date.UTC(2026,9,22);
test('shared summaries exclude pauses and invalid readings, retain zeros and assign stage boundaries once',()=>{
 const s={stages:[{hr:155},{hr:165},{hr:170}],recording:{startedAt:t,endedAt:t+5000,
  spans:[{startAt:t,endAt:t+2000},{startAt:t+4000,endAt:t+5000}],
  windows:[{index:0,startAt:t,endAt:t+1000},{index:1,startAt:t+1000,endAt:t+5000}],
  records:[{timestamp:t,stage:0,hr:120,power:0,cadence:0},{timestamp:t+1000,stage:1,hr:160,power:200,cadence:90},
   {timestamp:t+2000,stage:1,hr:null,power:null,cadence:null},{timestamp:t+3000,stage:1,hr:240,power:900,cadence:200},
   {timestamp:t+4000,stage:1,hr:0,power:-1,cadence:255},{timestamp:t+5000,stage:1,hr:255,power:65535,cadence:NaN},
   {timestamp:t+6000,stage:1,hr:250,power:500,cadence:100}]}};
 const before=JSON.stringify(s),summary=R.summarizeRecords(R.selectRecords(s.recording));
 assert.deepEqual(JSON.parse(JSON.stringify(summary)),{hr:{avg:140,max:160,count:2},cadence:{avg:45,max:90,count:2},power:{avg:100,max:200,count:2}});
 const stages=R.summarizeStages(s);assert.equal(stages[0].hr.avg,120);assert.equal(stages[1].hr.avg,160);assert.equal(stages[2].hr.avg,null);
 assert.equal(R.readStageHeartRate(s,0).value,120);assert.equal(R.readStageHeartRate(s,0).manual,155);assert.equal(R.readStageHeartRate(s,2).source,'manual');
 assert.equal(JSON.stringify(s),before);
});
test('stage CSV shares recorded summaries while keeping the manual heart rate column independent',()=>{
 const {core:C,tests:T,recording:RR}=exportContext.window.Lab,s=T.newSession({name:'HR',startPower:120,increment:15,stageMinutes:2,stageCount:3,samplingMode:'solo'});
 s.execution.status='running';s.stages[0].hr=190;RR.beginRecording(s,t);RR.captureRecord(s,{hr:120},t);RR.captureRecord(s,{hr:140},t+1000);RR.stopRecording(s,t+2000,true);
 const [header,row]=C.sessionCsv(s).replace(/^\ufeff/,'').split('\r\n').map(x=>x.split(',').map(v=>v.replace(/^"|"$/g,'')));
 const fields=Object.fromEntries(header.map((key,i)=>[key,row[i]]));
 assert.equal(fields.heart_rate_bpm,'190');assert.equal(fields.recorded_avg_heart_rate_bpm,'130');assert.equal(fields.recorded_max_heart_rate_bpm,'140');assert.equal(fields.recorded_heart_rate_count,'2');
});
const exportContext=vm.createContext({window:{}});for(const name of ['storage','core','tests','recording'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),exportContext);
test('CSV preserves manual readings, timestamps, athlete and resting data',()=>{
 const {core:C,tests:T}=exportContext.window.Lab,s=T.newSession({name:'Raw export',startPower:120,increment:15,stageMinutes:2,stageCount:3,samplingMode:'solo',preset:'fine'});
 s.id='raw';s.athlete={name:'Rider',sex:'female',age:30,ftp:270};s.restingSample={lactate:1.1,recordedAt:'2026-10-22T00:00:00Z',skipped:false};
 Object.assign(s.stages[0],{lactate:2.4,hr:151,rpe:0,quality:'exclude',notes:'comma, "quote"',sampleAt:t,recordedAt:'2026-10-22T00:02:00Z'});
 const text=C.sessionCsv(s);assert.match(text,/lactate_mmol_l/);assert.match(text,/sample_time_ms/);assert.match(text,/"2.4","151","0","exclude"/);assert.match(text,/"comma, ""quote"""/);assert.match(text,/"Rider","female","30","270"/);assert.match(text,/"1.1","2026-10-22T00:00:00Z","false"/);
 assert.doesNotMatch(text,/analysis|lt1|lt2|model|threshold/i);assert.equal(text.split('\r\n').length,4);assert.match(text.split('\r\n')[2],/"135","120","","",""/);
 s.stages[1].notes='=1+2';assert.ok(C.sessionCsv(s).includes('"\'=1+2"'));
});
test('legacy protocol identifiers retain the same parameters using neutral preset names',()=>{
 const T=exportContext.window.Lab.tests;
 assert.equal(T.readGoalId('lt1'),'fine');assert.equal(T.readGoalId('both'),'standard');assert.equal(T.readGoalId('overview'),'short');assert.equal(T.readGoalId('constructor'),null);
 assert.equal(JSON.stringify(T.generate(270,'lt1')),JSON.stringify(T.generate(270,'fine')));assert.equal(T.generate(270,'fine').startPower,120);assert.equal(T.generate(270,'fine').increment,15);
 assert.doesNotMatch(T.goals.map(g=>g.name).join(' '),/LT|曲线|分析/);
 const input={name:'Legacy',startPower:120,increment:15,stageMinutes:7,stageCount:10,preset:'lt1',goal:'lt1',samplingMode:'solo'};
 const s=T.newSession(T.validInput(input));assert.equal(s.protocol.goal,'fine');assert.equal(s.protocol.preset,'fine');
});
function session(){return {execution:{stageIndex:0,phase:'effort',status:'running',startedAt:t,elapsedMs:0},stages:[{power:120},{power:140},{power:160}]}}
test('records at most once per second, leaves gaps and excludes pause time',()=>{
 const s=session();R.beginRecording(s,t);assert.equal(R.captureRecord(s,{power:120},t),true);assert.equal(R.captureRecord(s,{power:140},t+250),false);
 R.stopRecording(s,t+10000);s.execution.status='paused';assert.equal(R.captureRecord(s,{},t+15000),false);
 s.execution.status='running';R.beginRecording(s,t+20000);R.captureRecord(s,{hr:151},t+30000);R.stopRecording(s,t+40000,true);
 assert.equal(s.recording.records.length,2);assert.equal(R.measureTimer(s.recording,t,t+40000),30000);assert.equal(s.recording.records[1].power,undefined);
});
test('keeps sampling in its stage, anchors late entry to effort end and retains real entry time',()=>{
 const s=session();R.beginRecording(s,t);s.execution.phase='sampling';R.syncStage(s,t+120000);s.execution.stageIndex=1;s.execution.phase='effort';R.syncStage(s,t+165000);
 s.stages[0].recordedAt=new Date(t+600000).toISOString();assert.equal(R.readSampleTime(s,0,t+700000),t+120000);
 s.stages[0].sampleAt=t+130000;assert.equal(R.readSampleTime(s,0,t+700000),t+130000);
 assert.equal(s.recording.windows[0].endAt,t+165000);assert.equal(s.recording.windows.length,2);
});
test('reload pauses at last observation and resumes without inventing records',()=>{
 const s=session();R.beginRecording(s,t);R.captureRecord(s,{},t+2000);R.recoverRecording(s,t+100000);
 assert.equal(s.execution.status,'paused');assert.equal(s.execution.elapsedMs,2000);assert.equal(s.recording.spans[0].endAt,t+2000);
 R.beginRecording(s,t+110000);assert.equal(s.recording.records.length,1);assert.equal(s.recording.spans.length,2);
});
test('JSON snapshot imports retain data, close running spans and reject damaged ranges',()=>{
 const s=session();R.beginRecording(s,t);R.captureRecord(s,{power:123,hr:150},t+2000);
 const imported=R.readRecording(JSON.parse(JSON.stringify(s.recording)),3);assert.equal(imported.records[0].power,123);assert.equal(imported.spans[0].endAt,t+2000);
 const broken=JSON.parse(JSON.stringify(s.recording));broken.windows[0].endAt=t-1;assert.throws(()=>R.readRecording(broken,3));
 const resumed=session();resumed.execution.stageIndex=2;R.beginRecording(resumed,t);assert.equal(R.readRecording(resumed.recording,3).windows[0].index,2);
 assert.equal(R.readRecording(null,3),null);
});
test('independent power streams survive JSON round trips without filling missing or legacy readings',()=>{
 const s=session();R.beginRecording(s,t);
 for(const [i,snapshot] of [
  {power:230,powerSource:'power',powerMeterPower:230,trainerPower:220},
  {power:221,powerSource:'trainer',powerMeterPower:null,trainerPower:221},
  {power:0,powerSource:'power',powerMeterPower:0,trainerPower:null},
  {power:null,powerSource:null,powerMeterPower:null,trainerPower:null},
  {power:200,powerSource:'power'}
 ].entries())R.captureRecord(s,snapshot,t+i*1000);
 const read=raw=>R.readRecording(JSON.parse(JSON.stringify(raw)),3);
 const imported=read(s.recording);
 assert.deepEqual(Array.from(imported.records,x=>[x.power,x.powerSource,x.powerMeterPower,x.trainerPower]),[
  [230,'power',230,220],[221,'trainer',null,221],[0,'power',0,null],[null,null,null,null],[200,'power',undefined,undefined]
 ]);
 const invalid=JSON.parse(JSON.stringify(s.recording));
 for(const value of [-1,65535,'220',Infinity]){
  Object.assign(invalid.records[0],{powerMeterPower:value,trainerPower:value});
  const record=read(invalid).records[0];assert.equal(record.powerMeterPower,null);assert.equal(record.trainerPower,null);assert.equal(record.power,230);
 }
});
test('distance rebases trainer counters and never adds pause, reconnect, reset or missing history',()=>{
 const s=session(),connection={};R.beginRecording(s,t);
 const take=(second,raw,token=connection)=>{R.captureRecord(s,{trainerDistance:raw,trainerConnection:token},t+second*1000);return s.recording.records.at(-1)};
 assert.equal(take(0,1000).distance,0);assert.equal(take(1,1010).distance,10);assert.equal(take(2,1010).distance,10);
 R.stopRecording(s,t+2000);R.beginRecording(s,t+10000);assert.equal(take(10,2000).distance,10);assert.equal(take(11,2010).distance,20);
 assert.equal(take(12,0).distance,20);assert.equal(take(13,8).distance,28);
 const replacement={};assert.equal(take(14,10000,replacement).distance,28);assert.equal(take(15,10005,replacement).distance,33);
 assert.equal(take(21,10050,replacement).distance,33);assert.equal(take(22,null,replacement).distance,null);assert.equal(take(23,10070,replacement).distance,33);
 assert.equal('trainerConnection' in s.recording.records[0],false);
 const imported=R.readRecording(JSON.parse(JSON.stringify(s.recording)),3),resumed=session();resumed.recording=imported;
 R.beginRecording(resumed,t+30000);R.captureRecord(resumed,{trainerDistance:12000,trainerConnection:connection},t+30000);assert.equal(resumed.recording.records.at(-1).distance,33);
});
test('speed integration preserves zero, marks estimates, handles source changes and uint24 rollover',()=>{
 const s=session();R.beginRecording(s,t);
 const take=(second,snapshot)=>{R.captureRecord(s,snapshot,t+second*1000);return s.recording.records.at(-1)};
 assert.equal(take(0,{speed:0}).distance,0);let record=take(2,{speed:10});assert.equal(record.distance,10);assert.equal(record.distanceSource,'speed');assert.equal(record.distanceStartAt,t);
 assert.equal(take(3,{speed:10,trainerDistance:0xfffffe}).distance,10);
 assert.equal(take(4,{speed:10,trainerDistance:3}).distance,15);
 assert.equal(take(5,{speed:10}).distance,15);assert.equal(take(6,{speed:0}).distance,20);
 assert.equal(take(7,{}).distance,null);assert.equal(take(8,{speed:10}).distance,20);assert.equal(take(20,{speed:10}).distance,20);
});
test('motion JSON round trip retains signed grade, raw resistance and high speed without inventing legacy data',()=>{
 const s=session();R.beginRecording(s,t);R.captureRecord(s,{speed:100,speedSource:'trainer',trainerDistance:1000,trainerDistanceSource:'trainer',trainerResistance:-20,trainerResistanceSource:'trainer',grade:-.01,gradeSource:'trainerSimulation'},t);
 const record=R.readRecording(JSON.parse(JSON.stringify(s.recording)),3).records[0];assert.equal(record.speed,100);assert.equal(record.grade,-.01);assert.equal(record.trainerResistance,-20);assert.equal(record.distance,0);assert.equal(record.distanceSource,'trainer');
 const legacy=JSON.parse(JSON.stringify(s.recording));legacy.records=[{timestamp:t,stage:0,speed:10}];const old=R.readRecording(legacy,3).records[0];assert.equal(old.distance,undefined);assert.equal(old.grade,undefined);
 const bad=JSON.parse(JSON.stringify(s.recording));Object.assign(bad.records[0],{grade:400,trainerDistance:-1,distance:'123',distanceDelta:-1,distanceStartAt:t+1});const clean=R.readRecording(bad,3).records[0];for(const key of ['grade','trainerDistance','distance','distanceDelta','distanceStartAt'])assert.equal(clean[key],null);
});
test('cached pre-start and pre-resume telemetry cannot add warmup or paused distance',()=>{
 const s=session();R.beginRecording(s,t);
 const take=(second,raw,at)=>{R.captureRecord(s,{trainerDistance:raw,trainerDistanceAt:at,speed:10,speedAt:at},t+second*1000);return s.recording.records.at(-1)};
 assert.equal(take(0,1000,t-1000).distance,null);assert.equal(take(1,1100,t+1000).distance,0);assert.equal(take(2,1110,t+2000).distance,10);
 R.stopRecording(s,t+2000);R.beginRecording(s,t+3000);
 assert.equal(take(3,1110,t+2000).distance,null);assert.equal(take(4,1200,t+4000).distance,10);assert.equal(take(5,1210,t+5000).distance,20);
 assert.equal('trainerDistanceAt' in s.recording.records[0],false);assert.equal('speedAt' in s.recording.records[0],false);
});
