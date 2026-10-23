// NODE_PATH=/path/to/node_modules node test/browser-storage.cjs
// Serve the project on localhost:5173 or set PACELAB_URL.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
(async()=>{
 const origin=process.env.PACELAB_URL||'http://localhost:5173';
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1080}}),page=await context.newPage(),errors=[];
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-10-24T01:00:00Z')});await page.goto(origin);
  await page.evaluate(()=>{
   const athlete={name:'Backup Rider',sex:'female',age:30,ftp:270};
   const make=name=>Lab.tests.newSession({name,athlete,startPower:120,increment:15,stageMinutes:2,stageCount:3,samplingMode:'assisted'});
   const history=make('HRV history'),current=make('Current test'),now=Date.now()-180000;
   history.execution.status='running';history.execution.startedAt=now;Lab.recording.beginRecording(history,now);
   for(let i=1;i<=130;i++){
    const time=now+i*1000,rr=500+20*Math.sin(i*1.7);
    Lab.hrv.capturePacket(history,{timestamp:time,rr:[rr,1000-rr],contact:true});Lab.hrv.captureEstimate(history,time);
    Lab.recording.captureRecord(history,{power:123,hr:120,cadence:90,powerSource:'power',hrSource:'heart',cadenceSource:'power',speed:null,speedSource:null},time);
   }
   Lab.recording.stopRecording(history,now+130000,true);history.execution.status='done';history.execution.startedAt=null;
   history.restingSample={lactate:1.2,recordedAt:new Date(now).toISOString(),skipped:false};
   Object.assign(history.stages[0],{lactate:2.4,rpe:0,quality:'suspect',notes:'Keep this sample'});
   localStorage.setItem(Lab.core.STORAGE_KEY,JSON.stringify({schemaVersion:1,sessions:[history,current],activeId:current.id,athlete}));
  });await page.reload();
  const readDisk=()=>page.evaluate(()=>JSON.parse(localStorage.getItem(Lab.core.STORAGE_KEY)));
  const downloadBackup=async(target=page,action='export-backup')=>{
   const pending=target.waitForEvent('download');await target.locator(`[data-action="${action}"]`).click();
   const download=await pending;return {name:download.suggestedFilename(),buffer:await fs.readFile(await download.path())};
  };
  const setQuota=async enabled=>page.evaluate(enabled=>{
   window.originalStorageSet??=Storage.prototype.setItem;
   Storage.prototype.setItem=enabled?function(key,value){if(key===Lab.core.STORAGE_KEY)throw new DOMException('Full','QuotaExceededError');return window.originalStorageSet.call(this,key,value)}:window.originalStorageSet;
  },enabled);
  await page.locator('[data-action="skip-resting"]').click();await page.clock.runFor(1500);
  const durable=await readDisk();await setQuota(true);
  await page.locator('[data-action="edit-sample"]').first().click();await page.locator('#edit-sample-lactate').fill('2.7');await page.locator('.modal [data-action="close-modal"]').last().click();
  await page.clock.runFor(6000);assert.equal(await page.locator('#storage-message').textContent(),'更改尚未保存');
  assert.equal((await readDisk()).sessions[1].stages[0].lactate,null);
  assert.equal(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);
  const failedBackup=await downloadBackup(),snapshot=JSON.parse(failedBackup.buffer);
  assert.match(failedBackup.name,/PaceLab_全部测试_2026-10-24/);assert.equal(snapshot.sessions.length,2);
  assert.equal(snapshot.sessions[1].stages[0].lactate,2.7);assert.equal(snapshot.sessions[1].execution.status,'paused');
  assert.ok(snapshot.sessions[1].recording.spans.every(span=>span.endAt!==null));
  assert.deepEqual(snapshot.sessions[0].recording.hrv,durable.sessions[0].recording.hrv);assert.deepEqual(snapshot.athlete,durable.athlete);
  assert.equal(await page.locator('[data-action="pause"]').count(),1);assert.equal(await page.locator('#storage-message').textContent(),'更改尚未保存');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#storage-status').screenshot({path:'/tmp/pacelab-storage-mobile.png'});
  await page.setViewportSize({width:1440,height:1080});await page.locator('#storage-status').screenshot({path:'/tmp/pacelab-storage-desktop.png'});
  await page.locator('[data-action="pause"]').click();await setQuota(false);await page.locator('[data-action="retry-save"]').click();
  assert.equal((await readDisk()).sessions[1].stages[0].lactate,2.7);assert.equal(await page.locator('#storage-message').textContent(),'已保存到此浏览器');
  assert.equal(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),true);

  // Restore a full backup in an independent browser profile, including raw RR and paused spans.
  const restored=await browser.newPage({viewport:{width:390,height:844}});restored.on('pageerror',e=>errors.push(e.message));await restored.goto(origin);
  await restored.locator('#import-file').setInputFiles({name:failedBackup.name,mimeType:'application/json',buffer:failedBackup.buffer});
  await restored.locator('.history-item').nth(1).waitFor();
  const imported=await restored.evaluate(()=>JSON.parse(localStorage.getItem(Lab.core.STORAGE_KEY)));
  assert.equal(imported.sessions.length,2);assert.deepEqual(imported.athlete,snapshot.athlete);
  for(let i=0;i<2;i++){
   assert.deepEqual(imported.sessions[i].recording,snapshot.sessions[i].recording);
   assert.deepEqual(imported.sessions[i].stages.map(s=>[s.lactate,s.rpe,s.quality,s.notes]),snapshot.sessions[i].stages.map(s=>[s.lactate,s.rpe,s.quality,s.notes]));
  }
  assert.equal(await restored.locator('.heading [data-action="import"]').isVisible(),true);
  await restored.reload();assert.equal((await restored.evaluate(()=>JSON.parse(localStorage.getItem(Lab.core.STORAGE_KEY)))).sessions.length,2);
  await restored.close();

  // A mixed valid/invalid backup or failed write never partially imports into memory or storage.
  const beforeImport=await readDisk(),bad={...snapshot,sessions:[snapshot.sessions[0],{type:'invalid'}]};
  await page.locator('#import-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});
  await page.getByText('导入失败：第 2 次测试格式无效，未导入任何记录',{exact:true}).waitFor();assert.deepEqual(await readDisk(),beforeImport);
  await setQuota(true);await page.locator('#import-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:failedBackup.buffer});
  await page.getByText('导入失败：无法保存到浏览器，未添加导入记录；请保留 JSON 文件，恢复存储后重试',{exact:true}).waitFor();
  assert.deepEqual(await readDisk(),beforeImport);assert.equal(JSON.parse((await downloadBackup()).buffer).sessions.length,2);
  await setQuota(false);await page.locator('[data-action="retry-save"]').click();

  // A real second tab changes the same database while the first tab is recording.
  const other=await context.newPage();await other.goto(origin);
  await page.locator('[data-action="start"]').click();await page.clock.runFor(2000);
  await other.evaluate(()=>{
   const db=JSON.parse(localStorage.getItem(Lab.core.STORAGE_KEY));db.sessions[1].name='Other tab revision';
   localStorage.setItem(Lab.core.STORAGE_KEY,JSON.stringify(db));
  });
  await page.waitForFunction(()=>document.querySelector('#storage-message').textContent==='其他标签页已更新记录');
  assert.equal(await page.locator('[data-action="pause"]').count(),0);
  const conflict=JSON.parse((await downloadBackup()).buffer);assert.equal(conflict.sessions[1].name,'Current test');assert.equal(conflict.sessions[1].execution.status,'paused');
  assert.equal((await readDisk()).sessions[1].name,'Other tab revision');
  assert.equal(await page.evaluate(()=>Lab.core.write({schemaVersion:1,sessions:[],activeId:null})),false);
  assert.equal((await readDisk()).sessions[1].name,'Other tab revision');
  await other.close();page.once('dialog',dialog=>dialog.accept());await page.locator('[data-action="reload-data"]').click();
  await page.waitForFunction(()=>document.querySelector('.session-title')?.textContent==='Other tab revision');
  assert.equal(await page.locator('#storage-message').textContent(),'已保存到此浏览器');

  // The same save failure and backup path also works in the generated standalone HTML.
  await page.goto(origin+'/dist/'+encodeURIComponent('PaceLab_运动表现测试工作台.html'));
  await setQuota(true);await page.locator('[data-action="edit-sample"]').first().click();await page.locator('#edit-sample-rpe').fill('3');await page.locator('.modal [data-action="close-modal"]').last().click();
  assert.equal(JSON.parse((await downloadBackup()).buffer).sessions[1].stages[0].rpe,3);
  await setQuota(false);await page.locator('[data-action="retry-save"]').click();assert.equal((await readDisk()).sessions[1].stages[0].rpe,3);

  // Corrupt data stays untouched and can be downloaded byte for byte for recovery.
  await page.evaluate(()=>localStorage.setItem(Lab.core.STORAGE_KEY,'{broken original'));await page.reload();
  assert.equal(await page.locator('#storage-message').textContent(),'无法读取本地记录');
  assert.equal((await downloadBackup(page,'export-original')).buffer.toString(),'{broken original');
  assert.equal(await page.evaluate(()=>Lab.core.write({schemaVersion:1,sessions:[],activeId:null})),false);
  assert.equal(await page.evaluate(()=>localStorage.getItem(Lab.core.STORAGE_KEY)),'{broken original');
  await page.locator('[data-action="new"]').first().click();await page.locator('#athlete-name').fill('Recovery rider');await page.locator('#athlete-sex').selectOption('female');await page.locator('#athlete-age').fill('30');await page.locator('#athlete-ftp').fill('270');await page.locator('[data-action="next-protocol"]').click();await page.locator('[data-action="create-test"]').click();
  assert.equal(JSON.parse((await downloadBackup()).buffer).sessions[0].athlete.name,'Recovery rider');
  assert.equal((await downloadBackup(page,'export-original')).buffer.toString(),'{broken original');
  // A whole-history backup can restore more than 300 small tests within the file-size limit.
  const large=await browser.newPage();large.on('pageerror',e=>errors.push(e.message));await large.goto(origin);
  const many={...snapshot,sessions:Array.from({length:301},(_,i)=>({...snapshot.sessions[1],name:`History ${i}`,recording:null,execution:{...snapshot.sessions[1].execution,status:'idle'}}))};
  await large.locator('#import-file').setInputFiles({name:'large-history.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(many))});
  await large.waitForFunction(()=>JSON.parse(localStorage.getItem(Lab.core.STORAGE_KEY))?.sessions.length===301);
  assert.equal(JSON.parse((await downloadBackup(large)).buffer).sessions.length,301);await large.close();
  assert.deepEqual(errors,[]);
  console.log('PASS browser storage: persistent quota failure, latest-data backup, live snapshot isolation, retry, full HRV/RR restore, atomic imports, multi-tab conflict, reload, mobile layout, corrupt-data recovery and portable HTML.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
