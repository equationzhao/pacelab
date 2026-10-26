const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const context=vm.createContext({window:{Lab:{}},TextEncoder});for(const name of ['recording','fit'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),context);
const {recording:R,fit:F}=context.window.Lab,t=Date.UTC(2026,9,22);
function createSession(){
 const s={execution:{status:'running',stageIndex:0,phase:'effort'},stages:[{power:120,lactate:1.2,rpe:3.5,quality:'normal',recordedAt:new Date(t+500000).toISOString()},{power:140,lactate:null,rpe:0,quality:'suspect',sampleAt:t+200000}],restingSample:{lactate:.9,recordedAt:new Date(t-10000).toISOString()}};
 R.beginRecording(s,t);R.captureRecord(s,{power:118,powerMeterPower:118,trainerPower:115,hr:132,cadence:89,powerSource:'power',hrSource:'heart'},t);
 R.stopRecording(s,t+60000);R.beginRecording(s,t+90000);
 s.execution.phase='sampling';R.syncStage(s,t+150000);s.execution.stageIndex=1;s.execution.phase='effort';R.syncStage(s,t+195000);
 R.captureRecord(s,{power:139,hr:null},t+200000);R.stopRecording(s,t+315000,true);return s;
}
// Independent byte-level scanner: inspect developer values even when Garmin SDK is unavailable.
function decodeBytes(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),definitions=new Map(),messages=[];let offset=bytes[0];
 while(offset<bytes.length-2){const header=bytes[offset++],local=header&15;
  if(header&64){offset++;const little=bytes[offset++]===0,global=view.getUint16(offset,little);offset+=2;const fields=[];let count=bytes[offset++];
   while(count--){fields.push({id:bytes[offset],size:bytes[offset+1],type:bytes[offset+2],dev:false});offset+=3}
   if(header&32){count=bytes[offset++];while(count--){fields.push({id:bytes[offset],size:bytes[offset+1],dev:true});offset+=3}}
   definitions.set(local,{global,fields});continue;
  }
  const def=definitions.get(local),message={global:def.global,fields:{},dev:{}};
  for(const f of def.fields){let value;if(f.dev&&(f.id===0||f.id===1||f.id===8||f.id===19))value=view.getFloat32(offset,true);else if(f.size===1)value=view.getUint8(offset);else if(f.size===2)value=view.getUint16(offset,true);else if(f.size===4)value=view.getUint32(offset,true);else value=bytes.slice(offset,offset+f.size);(f.dev?message.dev:message.fields)[f.id]=value;offset+=f.size}
  messages.push(message);
 }
 assert.equal(offset,bytes.length-2);return messages;
}
test('FIT header, CRC, standard sensor fields, laps and timer events are complete',()=>{
 const bytes=F.encodeSession(createSession()),view=new DataView(bytes.buffer);
 assert.equal(String.fromCharCode(...bytes.slice(8,12)),'.FIT');assert.equal(view.getUint32(4,true),bytes.length-16);assert.equal(F.computeCrc(bytes),0);
 const messages=decodeBytes(bytes),records=messages.filter(x=>x.global===20),laps=messages.filter(x=>x.global===19),session=messages.find(x=>x.global===18);
 assert.equal(records[0].fields[7],118);assert.equal(records[0].fields[3],132);assert.equal(records[0].dev[3],120);assert.equal(laps.length,2);assert.equal(session.fields[8],285000);assert.equal(session.fields[7],315000);
 assert.equal(messages.filter(x=>x.global===21).length,4);assert.ok(Math.abs(session.dev[8]-.9)<1e-6);
});
test('FIT preserves both power streams, fallback and zero while missing and legacy values stay invalid',()=>{
 const s=createSession();s.recording.records=[];
 const snapshots=[
  {power:230,powerSource:'power',powerMeterPower:230,trainerPower:220},
  {power:221,powerSource:'trainer',powerMeterPower:null,trainerPower:221},
  {power:0,powerSource:'power',powerMeterPower:0,trainerPower:null},
  {power:null,powerMeterPower:null,trainerPower:null},
  {power:200,powerSource:'power'}
 ];
 snapshots.forEach((x,i)=>s.recording.records.push({timestamp:t+i*1000,stage:0,phase:'effort',...x}));
 const records=decodeBytes(F.encodeSession(s)).filter(x=>x.global===20);
 assert.deepEqual(records.slice(0,5).map(x=>[x.fields[7],x.dev[17],x.dev[18],x.dev[10]]),[
  [230,230,220,1],[221,65535,221,3],[0,0,65535,1],[65535,65535,65535,255],[200,65535,65535,1]
 ]);
 assert.ok(records.slice(5).every(x=>x.dev[17]===65535&&x.dev[18]===65535));
});
test('late lactate edits update original stage, RPE zero is valid, missing sensors stay invalid',()=>{
 const s=createSession();s.stages[0].lactate=2.8;const messages=decodeBytes(F.encodeSession(s)),samples=messages.filter(x=>x.global===20&&Number.isFinite(x.dev[0]));
 assert.equal(samples.length,1);assert.ok(Math.abs(samples[0].dev[0]-2.8)<1e-6);assert.equal(samples[0].dev[5],F.fitTime(t+150000));assert.equal(samples[0].dev[6],F.fitTime(t+500000));
 const rpe=messages.find(x=>x.global===20&&x.dev[2]===2);assert.equal(rpe.dev[1],0);assert.equal(rpe.fields[3],255);assert.equal(rpe.fields[7],139);assert.equal(rpe.dev[7],1);
 assert.throws(()=>F.encodeSession({}));
});
test('Garmin official SDK decodes activity and developer fields without errors',async t=>{
 if(!process.env.FIT_SDK_PATH)return t.skip('Set FIT_SDK_PATH to the installed @garmin/fitsdk src/index.js');
 const {Decoder,Stream}=await import(pathToFileURL(process.env.FIT_SDK_PATH).href),decoder=new Decoder(Stream.fromByteArray(F.encodeSession(createSession())));
 assert.equal(decoder.isFIT(),true);assert.equal(decoder.checkIntegrity(),true);const {messages,errors}=decoder.read();assert.deepEqual(errors,[]);
 assert.equal(messages.sessionMesgs[0].sport,'cycling');assert.equal(messages.sessionMesgs[0].subSport,'indoorCycling');assert.equal(messages.sessionMesgs[0].totalTimerTime,285);
 assert.equal(messages.lapMesgs.length,2);assert.equal(messages.recordMesgs[0].power,118);assert.ok(Math.abs(messages.lapMesgs[0].developerFields[0]-1.2)<1e-6);assert.equal(messages.lapMesgs[1].developerFields[1],0);
 assert.equal(messages.fieldDescriptionMesgs.find(x=>x.fieldName==='lactate').units,'mmol/L');
 assert.equal(messages.recordMesgs[0].developerFields[17],118);assert.equal(messages.recordMesgs[0].developerFields[18],115);
 for(const fieldName of ['power_meter_power','trainer_power'])assert.equal(messages.fieldDescriptionMesgs.find(x=>x.fieldName===fieldName).units,'W');
});
test('Garmin SDK retains native RR arrays and valid or suppressed alpha developer fields',async tcase=>{
 if(!process.env.FIT_SDK_PATH)return tcase.skip('Set FIT_SDK_PATH');
 const s=createSession();s.recording.hrv={packets:[{timestamp:t+1000,rr:[500,501.953125],contact:true},{timestamp:t+2000,rr:[600],contact:false}],estimates:[{timestamp:t+1000,stage:0,phase:'effort',alpha1:.759,status:'valid',beatCount:240,artifactCount:0},{timestamp:t+6000,stage:0,phase:'effort',alpha1:null,status:'artifacts',beatCount:239,artifactCount:1},{timestamp:t+200500,stage:1,phase:'sampling',alpha1:.8,status:'valid',beatCount:240,artifactCount:0}]};
 const {Decoder,Stream}=await import(pathToFileURL(process.env.FIT_SDK_PATH).href),decoder=new Decoder(Stream.fromByteArray(F.encodeSession(s)));
 assert.equal(decoder.checkIntegrity(),true);const {messages,errors}=decoder.read();assert.deepEqual(errors,[]);
 assert.deepEqual(messages.hrvMesgs.map(x=>x.time),[[.5,.502]]);
 const records=messages.recordMesgs.filter(x=>x.developerFields?.[16]!==undefined);
 assert.equal(records.length,3);assert.equal(records[2].developerFields[4],1);assert.ok(Math.abs(records[0].developerFields[13]-.759)<1e-6);assert.equal(records[0].developerFields[15],240);
 assert.ok(Number.isNaN(records[1].developerFields[13]));assert.equal(records[1].developerFields[14],1);assert.equal(records[1].developerFields[16],3);
});
function createMotionSession(){
 const s={execution:{status:'running',stageIndex:0,phase:'effort'},stages:[{power:120},{power:140}]};R.beginRecording(s,t);
 const take=(second,values)=>R.captureRecord(s,values,t+second*1000);
 take(0,{speed:10,trainerDistance:1000,trainerResistance:-20,grade:-5.25,gradeSource:'trainerSimulation'});
 take(1,{speed:10,trainerDistance:1010,grade:-.01,gradeSource:'trainerSimulation'});
 s.execution.stageIndex=1;R.syncStage(s,t+1500);take(2,{speed:100,trainerDistance:1020,grade:0,gradeSource:'trainerSimulation'});
 R.stopRecording(s,t+2000);R.beginRecording(s,t+5000);take(5,{speed:0,trainerDistance:5000});take(6,{speed:10,trainerDistance:5010});take(7,{});R.stopRecording(s,t+7000,true);return s;
}
test('official FIT sensor summaries agree with records, preserve zero and omit missing or out-of-range values',async tcase=>{
 if(!process.env.FIT_SDK_PATH)return tcase.skip('Set FIT_SDK_PATH');
 const {Decoder,Stream}=await import(pathToFileURL(process.env.FIT_SDK_PATH).href);
 const s={execution:{status:'running',stageIndex:0,phase:'effort'},stages:[{power:120,hr:199},{power:140,hr:188}]};
 R.beginRecording(s,t);R.captureRecord(s,{hr:120,power:0,cadence:0},t);R.captureRecord(s,{hr:140,power:200,cadence:80},t+1000);
 R.stopRecording(s,t+2000);R.beginRecording(s,t+3000);s.execution.stageIndex=1;R.syncStage(s,t+3000);
 R.captureRecord(s,{hr:160,power:300,cadence:100},t+3000);R.captureRecord(s,{hr:0,power:-1,cadence:255,powerMeterPower:70000},t+4000);
 R.captureRecord(s,{hr:255,power:65535,cadence:NaN},t+5000);R.stopRecording(s,t+6000,true);
 // Corrupt paused/future samples must not leak into the exported activity or its summaries.
 s.recording.records.splice(2,0,{timestamp:t+2500,stage:0,hr:250,power:1000,cadence:200});
 s.recording.records.push({timestamp:t+7000,stage:1,hr:250,power:1000,cadence:200});
 const decode=()=>{const decoder=new Decoder(Stream.fromByteArray(F.encodeSession(s)));assert.equal(decoder.checkIntegrity(),true);const result=decoder.read();assert.deepEqual(result.errors,[]);return result.messages};
 const m=decode(),session=m.sessionMesgs[0];
 assert.equal(m.recordMesgs.length,5);assert.equal(session.avgHeartRate,140);assert.equal(session.maxHeartRate,160);
 assert.equal(session.avgPower,167);assert.equal(session.maxPower,300);assert.equal(session.avgCadence,60);assert.equal(session.maxCadence,100);
 assert.deepEqual(m.lapMesgs.map(x=>[x.avgHeartRate,x.maxHeartRate,x.avgPower,x.maxPower,x.avgCadence,x.maxCadence]),[[130,140,100,200,40,80],[160,160,300,300,100,100]]);
 assert.equal(m.recordMesgs[3].heartRate,undefined);assert.equal(m.recordMesgs[3].power,undefined);assert.equal(m.recordMesgs[3].cadence,undefined);assert.equal(m.recordMesgs[3].developerFields[17],undefined);
 assert.equal(m.recordMesgs[4].heartRate,undefined);assert.equal(m.recordMesgs[4].power,undefined);
 s.recording.records=s.recording.records.filter(x=>x.stage===0);const missing=decode();assert.equal(missing.lapMesgs[1].avgHeartRate,undefined);assert.equal(missing.lapMesgs[1].maxPower,undefined);
});
test('FIT native motion uses exact scales, signed invalid sentinel and enhanced speeds without clipping',()=>{
 const bytes=F.encodeSession(createMotionSession()),messages=decodeBytes(bytes),records=messages.filter(x=>x.global===20),laps=messages.filter(x=>x.global===19),session=messages.find(x=>x.global===18);
 assert.equal(F.computeCrc(bytes),0);assert.deepEqual(records.map(x=>x.fields[5]),[0,1000,2000,2000,3000,0xffffffff]);
 assert.equal(records[0].fields[6],10000);assert.equal(records[0].fields[73],10000);assert.equal(records[0].fields[9],65536-525);
 assert.equal(records[1].fields[9],65535);assert.equal(records[2].fields[9],0);assert.equal(records[3].fields[9],32767);
 assert.equal(records[2].fields[6],65535);assert.equal(records[2].fields[73],100000);
 assert.equal(records[0].dev[19],-20);assert.equal(records[0].dev[20],1000);assert.equal(records[0].dev[21],1);assert.equal(records[0].dev[22],1);
 assert.deepEqual(laps.map(x=>x.fields[9]),[1500,1500]);assert.equal(session.fields[9],3000);assert.equal(session.fields[14],7500);assert.equal(session.fields[15],65535);assert.equal(session.fields[125],100000);
});
test('official Garmin decoder verifies motion values, lap totals, JSON re-export and absent data',async tcase=>{
 if(!process.env.FIT_SDK_PATH)return tcase.skip('Set FIT_SDK_PATH');
 const {Decoder,Stream}=await import(pathToFileURL(process.env.FIT_SDK_PATH).href);
 const decode=s=>{const decoder=new Decoder(Stream.fromByteArray(F.encodeSession(s)));assert.equal(decoder.checkIntegrity(),true);const result=decoder.read();assert.deepEqual(result.errors,[]);return result.messages};
 const s=createMotionSession(),messages=decode(s),records=messages.recordMesgs;
 assert.equal(records[0].distance,0);assert.equal(records[1].distance,10);assert.equal(records[0].grade,-5.25);assert.equal(records[1].grade,-.01);assert.equal(records[2].grade,0);assert.equal(records[3].grade,undefined);
 assert.equal(records[0].enhancedSpeed,10);assert.equal(records[2].enhancedSpeed,100);assert.equal(records[3].enhancedSpeed,0);assert.equal(records[5].distance,undefined);assert.equal(records[5].enhancedSpeed,undefined);
 assert.equal(messages.sessionMesgs[0].totalDistance,30);assert.equal(messages.sessionMesgs[0].enhancedAvgSpeed,7.5);assert.equal(messages.sessionMesgs[0].enhancedMaxSpeed,100);
 assert.deepEqual(messages.lapMesgs.map(x=>x.totalDistance),[15,15]);assert.deepEqual(messages.lapMesgs.map(x=>x.enhancedAvgSpeed),[10,6]);
 s.recording=R.readRecording(JSON.parse(JSON.stringify(s.recording)),2);assert.deepEqual(decode(s),messages);
 const legacy=decode(createSession());assert.equal(legacy.sessionMesgs[0].totalDistance,undefined);assert.equal(legacy.recordMesgs[0].grade,undefined);
});
