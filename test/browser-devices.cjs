// NODE_PATH=/path/to/node_modules FIT_SDK_PATH=/path/to/@garmin/fitsdk/src/index.js node test/browser-devices.cjs
// Serve the project on localhost:5173 (or set PACELAB_URL). Requires Playwright and Chrome.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {pathToFileURL}=require('node:url');
(async()=>{
 const {Decoder,Stream}=await import(pathToFileURL(process.env.FIT_SDK_PATH).href);
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.install({time:new Date('2026-10-22T04:00:00Z')});
 await page.addInitScript(()=>{
  const mocks={};
  const commands=[];let rejected=null,hold=false,ergSupported=true,maxPower=2000;
  for(const [kind,id] of Object.entries({power:0x1818,heart:0x180d,trainer:0x1826})){
   const characteristic=new EventTarget(),device=new EventTarget();device.name='Mock '+kind;
   characteristic.startNotifications=async()=>characteristic;
   const point=new EventTarget(),status=new EventTarget();point.startNotifications=status.startNotifications=async()=>{};
   point.writeValueWithResponse=async bytes=>{
    commands.push(Array.from(bytes));if(hold&&bytes[0]===5)return;
    const result=rejected&&rejected.opcode===bytes[0]?rejected.result:1;rejected=null;
    queueMicrotask(()=>{point.value=new DataView(Uint8Array.from([128,bytes[0],result]).buffer);point.dispatchEvent(new Event('characteristicvaluechanged'))});
   };
   const service={getCharacteristic:async uuid=>{
    if(kind!=='trainer'||uuid===0x2ad2)return characteristic;
    if(uuid===0x2ad9)return point;if(uuid===0x2ada)return status;
    if(uuid===0x2acc)return {readValue:async()=>{const v=new DataView(new ArrayBuffer(8));v.setUint32(4,ergSupported?8:0,true);return v}};
    if(uuid===0x2ad8)return {readValue:async()=>{const v=new DataView(new ArrayBuffer(6));v.setInt16(2,maxPower,true);v.setUint16(4,5,true);return v}};
    throw Error('Unknown characteristic');
   }};
   device.gatt={connected:false,connect:async()=>{device.gatt.connected=true;return {getPrimaryService:async()=>service}},disconnect:()=>{device.gatt.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'))}};
   mocks[kind]={id,device,characteristic,point,status};
  }
  Object.defineProperty(navigator,'bluetooth',{configurable:true,value:{requestDevice:async options=>Object.values(mocks).find(x=>x.id===options.filters[0].services[0]).device}});
  window.mockBle={send(kind,bytes){const c=mocks[kind].characteristic;c.value=new DataView(Uint8Array.from(bytes).buffer);c.dispatchEvent(new Event('characteristicvaluechanged'))},drop(kind){mocks[kind].device.gatt.disconnect()},commands:()=>commands,configure(options){ergSupported=options.ergSupported??ergSupported;maxPower=options.maxPower??maxPower;hold=options.hold??hold},rejectNext(opcode,result){rejected={opcode,result}},status(bytes){const s=mocks.trainer.status;s.value=new DataView(Uint8Array.from(bytes).buffer);s.dispatchEvent(new Event('characteristicvaluechanged'))}};
 });
 const origin=process.env.PACELAB_URL||'http://127.0.0.1:5173';await page.goto(origin);
 await page.evaluate(()=>{const s=Lab.tests.newSession({name:'Bluetooth FIT QA',startPower:120,increment:15,stageMinutes:2,stageCount:3,samplingMode:'solo',samplePauseSec:45,beep:false});localStorage.setItem(Lab.core.STORAGE_KEY,JSON.stringify({schemaVersion:1,sessions:[s],activeId:s.id}));});await page.reload();
 const state=()=>page.evaluate(()=>{const db=JSON.parse(localStorage.getItem(Lab.core.STORAGE_KEY));return db.sessions.find(s=>s.id===db.activeId)});
 const connect=async kind=>{await page.locator(`#device-${kind}-button`).click();await page.locator(`#device-${kind}-status`).filter({hasText:'已连接'}).waitFor()};
 for(const kind of ['power','heart','trainer'])await connect(kind);
 await page.evaluate(()=>{mockBle.send('power',[0,0,123,0]);mockBle.send('heart',[0,149]);mockBle.send('trainer',[0x44,0,16,14,180,0,122,0])});
 assert.equal(await page.locator('#sensor-power').textContent(),'123');assert.equal(await page.locator('#sensor-hr').textContent(),'149');assert.equal(await page.locator('#sensor-cadence').textContent(),'90');
 await page.locator('#resting-lactate').fill('1.1');await page.locator('[data-action="start"]').click();
 await page.evaluate(()=>Lab.devices.slots.trainer.erg.waitForIdle());assert.deepEqual(await page.evaluate(()=>mockBle.commands()),[[0],[5,120,0],[7]]);
 assert.equal(await page.locator('[data-live-sensor="power"]').textContent(),'123');
 await page.clock.fastForward(1000);await page.locator('[data-action="pause"]').click();let s=await state();assert.equal(s.recording.records[0].power,123);assert.equal(s.recording.records[0].hr,149);assert.equal(s.recording.records[0].targetPower,120);
 const count=s.recording.records.length;await page.clock.fastForward(10000);assert.equal((await state()).recording.records.length,count);
 await page.locator('[data-action="start"]').click();await page.clock.fastForward(90000);
 assert.equal(await page.locator('#sensor-power').textContent(),'—');await page.locator('#live-sample-lactate').fill('2.4');await page.locator('#live-sample-rpe').fill('5.5');
 await page.evaluate(()=>mockBle.send('heart',[0,155]));assert.equal(await page.locator('#live-sample-rpe').evaluate(el=>el===document.activeElement),true);
 const jsonDownload=page.waitForEvent('download');await page.locator('[data-action="export-json"]').click();const snapshot=JSON.parse(await fs.readFile(await (await jsonDownload).path(),'utf8')).session;
 assert.equal(snapshot.execution.status,'paused');assert.ok(snapshot.execution.elapsedMs>=91000&&snapshot.execution.elapsedMs<95000);assert.ok(snapshot.recording.spans.at(-1).endAt);assert.equal((await state()).execution.status,'running');
 await page.locator('#live-sample-rpe').focus();
 await page.clock.fastForward(29000);assert.equal((await state()).execution.phase,'sampling');assert.equal(await page.locator('#live-sample-rpe').inputValue(),'5.5');
 await page.evaluate(()=>Lab.devices.slots.trainer.erg.waitForIdle());assert.deepEqual(await page.evaluate(()=>mockBle.commands().at(-1)),[8,2]);
 await page.clock.fastForward(45000);assert.equal((await state()).execution.stageIndex,1);
 await page.evaluate(()=>Lab.devices.slots.trainer.erg.waitForIdle());assert.deepEqual(await page.evaluate(()=>mockBle.commands().slice(-2)),[[5,135,0],[7]]);
 await page.getByRole('button',{name:'录入第1级数据'}).click();await page.locator('#edit-sample-lactate').fill('2.8');await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.evaluate(()=>{mockBle.send('trainer',[0x44,0,16,14,184,0,137,0]);mockBle.drop('power')});
 assert.equal(await page.locator('#sensor-power').textContent(),'137');assert.equal(await page.locator('#device-power-status').textContent(),'未连接');
 await page.locator('[data-action="pause"]').click();s=await state();const originalCount=s.recording.records.length;
 await page.reload();assert.equal((await state()).execution.status,'paused');assert.equal((await state()).recording.records.length,originalCount);assert.equal(await page.locator('#sensor-power').textContent(),'—');
 const dl=page.waitForEvent('download');await page.locator('[data-action="export-fit"]').click();const download=await dl;assert.match(download.suggestedFilename(),/\.fit$/);
 const decoder=new Decoder(Stream.fromByteArray(await fs.readFile(await download.path())));assert.equal(decoder.checkIntegrity(),true);const {messages,errors:fitErrors}=decoder.read();assert.deepEqual(fitErrors,[]);
 assert.equal(messages.recordMesgs[0].power,123);assert.ok(Math.abs(messages.lapMesgs[0].developerFields[0]-2.8)<1e-6);assert.equal(messages.lapMesgs[0].developerFields[1],5.5);assert.ok(Math.abs(messages.sessionMesgs[0].developerFields[8]-1.1)<1e-6);assert.equal(messages.lapMesgs.length,2);
 assert.ok(messages.sessionMesgs[0].totalElapsedTime>messages.sessionMesgs[0].totalTimerTime);
 await page.locator('#import-file').setInputFiles({name:'recording.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schemaVersion:1,exportType:'session',session:s}))});
 await page.getByRole('button',{name:'打开',exact:true}).first().waitFor();const imported=await state();assert.equal(imported.recording.records.length,s.recording.records.length);assert.equal(imported.stages[0].lactate,2.8);assert.equal(imported.stages[0].sampleAt,s.stages[0].sampleAt);
 await page.locator(`[data-action="open-session"][data-id="${imported.id}"]`).click();await page.locator('[data-action="start"]').click();
 await page.clock.fastForward(90000);await page.locator('#live-sample-rpe').fill('0');
 await connect('heart');await connect('trainer');await page.evaluate(()=>{mockBle.send('heart',[0,157]);mockBle.send('trainer',[0x44,0,16,14,184,0,137,0])});
 await page.screenshot({path:'/tmp/pacelab-devices-desktop.png',fullPage:true,animations:'disabled'});await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.ok((await page.locator('#device-trainer-button').boundingBox()).width>50);
 await page.screenshot({path:'/tmp/pacelab-devices-mobile.png',fullPage:true,animations:'disabled'});
 await page.clock.fastForward(400000);assert.equal((await state()).execution.status,'done');assert.ok((await state()).recording.endedAt);
 await page.evaluate(()=>Lab.devices.slots.trainer.erg.waitForIdle());assert.deepEqual(await page.evaluate(()=>mockBle.commands().at(-1)),[8,1]);
 const portable='/dist/PaceLab_%E8%BF%90%E5%8A%A8%E8%A1%A8%E7%8E%B0%E6%B5%8B%E8%AF%95%E5%B7%A5%E4%BD%9C%E5%8F%B0.html';await page.goto(origin+portable);assert.equal(await page.locator('[data-action="export-fit"]').count(),1);await connect('heart');
 await page.evaluate(()=>mockBle.send('heart',[0,160]));assert.equal(await page.locator('#sensor-hr').textContent(),'160');
 await connect('trainer');await page.locator('[data-action="duplicate"]').first().click();await page.locator('[data-action="skip-resting"]').click();await page.evaluate(()=>Lab.devices.slots.trainer.erg.waitForIdle());assert.deepEqual(await page.evaluate(()=>mockBle.commands().slice(-2)),[[5,120,0],[7]]);
 const fresh=async(mode='solo')=>{
  if(await page.locator('[data-action="pause"]').count())await page.locator('[data-action="pause"]').click();
  await page.goto(origin);await page.evaluate(mode=>{const s=Lab.tests.newSession({name:'ERG QA',startPower:120,increment:15,stageMinutes:2,stageCount:3,samplingMode:mode,samplePauseSec:45,beep:false});localStorage.setItem(Lab.core.STORAGE_KEY,JSON.stringify({schemaVersion:1,sessions:[s],activeId:s.id}));},mode);await page.reload();
 };
 const idleErg=()=>page.evaluate(()=>Lab.devices.slots.trainer.erg?.waitForIdle());
 const waitPaused=()=>page.waitForFunction(()=>JSON.parse(localStorage.getItem(Lab.core.STORAGE_KEY)).sessions.at(-1).execution.status==='paused');
 await fresh();await connect('trainer');await page.evaluate(()=>mockBle.rejectNext(5,3));await page.locator('[data-action="skip-resting"]').click();await waitPaused();await idleErg();
 assert.match(await page.locator('[data-erg-status]').first().textContent(),/拒绝/);assert.deepEqual(await page.evaluate(()=>mockBle.commands()),[[0],[5,120,0],[8,2]]);
 await page.locator('[data-action="start"]').click();await idleErg();assert.equal((await state()).execution.status,'running');assert.equal(await page.evaluate(()=>Lab.devices.slots.trainer.erg.state.power),120);
 await page.evaluate(()=>mockBle.status([255]));await waitPaused();await idleErg();const lostCount=await page.evaluate(()=>mockBle.commands().length);
 assert.match(await page.locator('[data-erg-status]').first().textContent(),/控制权已丢失/);
 await page.locator('[data-action="start"]').click();await idleErg();assert.deepEqual(await page.evaluate(n=>mockBle.commands().slice(n),lostCount),[[0],[5,120,0],[7]]);
 await page.evaluate(()=>mockBle.drop('trainer'));await waitPaused();assert.match(await page.locator('[data-erg-status]').first().textContent(),/确认负载已停止/);
 await page.locator('[data-action="start"]').click();await page.evaluate(()=>mockBle.send('heart',[0,150]));assert.equal((await state()).execution.status,'running');
 await fresh();await page.evaluate(()=>mockBle.configure({ergSupported:false}));await page.locator('#device-trainer-button').click();
 await page.getByText('连接ERG 骑行台失败：此设备不支持 FTMS ERG 目标功率控制',{exact:true}).waitFor();assert.equal(await page.locator('#device-trainer-status').textContent(),'未连接');assert.equal((await state()).execution.status,'idle');
 await fresh();await page.evaluate(()=>mockBle.configure({maxPower:130}));await connect('trainer');await page.locator('[data-action="skip-resting"]').click();assert.equal((await state()).execution.status,'idle');assert.match(await page.locator('#toast-stack').textContent(),/135 W 不受骑行台支持/);assert.deepEqual(await page.evaluate(()=>mockBle.commands()),[[0]]);
 await fresh();await connect('trainer');await page.evaluate(()=>mockBle.configure({hold:true}));await page.locator('[data-action="skip-resting"]').click();await page.clock.fastForward(5100);await waitPaused();await idleErg();
 assert.match(await page.locator('[data-erg-status]').first().textContent(),/响应超时/);await page.locator('[data-action="start"]').click();assert.equal((await state()).execution.status,'paused');assert.deepEqual(await page.evaluate(()=>mockBle.commands()),[[0],[5,120,0]]);
 await page.locator('#device-trainer-button').click();await page.locator('#device-trainer-status').filter({hasText:'未连接'}).waitFor();await page.evaluate(()=>mockBle.configure({hold:false}));await connect('trainer');assert.equal(await page.evaluate(()=>Lab.devices.slots.trainer.erg.state.phase),'ready');assert.equal((await state()).execution.status,'paused');await page.locator('[data-action="start"]').click();await idleErg();assert.equal(await page.evaluate(()=>Lab.devices.slots.trainer.erg.state.power),120);
 await fresh();await connect('trainer');await page.locator('[data-action="skip-resting"]').click();await idleErg();await page.evaluate(()=>mockBle.rejectNext(8,4));await page.clock.fastForward(120001);await waitPaused();await idleErg();assert.equal((await state()).execution.phase,'sampling');
 const pausedCount=await page.evaluate(()=>mockBle.commands().length);await page.locator('[data-action="start"]').click();await idleErg();assert.equal((await state()).execution.status,'running');assert.deepEqual(await page.evaluate(n=>mockBle.commands().slice(n),pausedCount),[[8,2]]);
 await fresh('assisted');await connect('trainer');await page.locator('[data-action="skip-resting"]').click();await idleErg();await page.clock.fastForward(120001);await idleErg();
 assert.equal((await state()).execution.stageIndex,1);assert.deepEqual(await page.evaluate(()=>mockBle.commands()),[[0],[5,120,0],[7],[5,135,0]]);
 page.once('dialog',dialog=>dialog.accept());await page.locator('[data-action="finish"]').click();await idleErg();assert.deepEqual(await page.evaluate(()=>mockBle.commands().at(-1)),[8,1]);
 await fresh();await connect('trainer');await page.locator('[data-action="skip-resting"]').click();await idleErg();await page.locator('#device-trainer-button').click();await page.locator('#device-trainer-status').filter({hasText:'未连接'}).waitFor();assert.equal((await state()).execution.status,'paused');assert.deepEqual(await page.evaluate(()=>mockBle.commands().at(-1)),[8,1]);
 await fresh();await connect('trainer');await page.locator('[data-action="skip-resting"]').click();await idleErg();await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await idleErg();assert.equal((await state()).execution.status,'paused');assert.deepEqual(await page.evaluate(()=>mockBle.commands().at(-1)),[8,1]);
 const unsupported=await browser.newPage();await unsupported.addInitScript(()=>Object.defineProperty(navigator,'bluetooth',{value:undefined}));await unsupported.goto(origin);
 await unsupported.evaluate(()=>{const s=Lab.tests.newSession({name:'Unsupported',startPower:120,increment:15,stageMinutes:2,stageCount:3,samplingMode:'assisted'});localStorage.setItem(Lab.core.STORAGE_KEY,JSON.stringify({schemaVersion:1,sessions:[s],activeId:s.id}));});await unsupported.reload();
 assert.equal(await unsupported.locator('#device-power-button').isDisabled(),true);assert.match(await unsupported.locator('.device-help').textContent(),/当前浏览器不支持蓝牙连接/);
 assert.deepEqual(errors,[]);console.log('PASS browser: BLE readings, ERG control/start/target/solo sampling pause/resume/assisted transition/stop, rejected target, control loss and explicit retry, disconnect, timeout, capability and range checks, FIT/Garmin decoding, JSON round-trip, mobile and portable build. Real hardware is not tested.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
