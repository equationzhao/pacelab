const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({window:{Lab:{}}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/recording.js'),'utf8'),context);
const R=context.window.Lab.recording,t=Date.UTC(2026,9,22);
const exportContext=vm.createContext({window:{}});for(const name of ['core','tests'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),exportContext);
test('CSV exports raw readings, timestamps, athlete and resting data without computed fields',()=>{
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
