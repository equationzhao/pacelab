// NODE_PATH=/tmp/pacelab-ui-check/node_modules node test/browser-workflow.cjs
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const origin=process.env.PACELAB_URL||'http://localhost:5173',page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('Page error:',e.message)});page.on('dialog',d=>d.accept());
  await page.clock.install({time:new Date('2026-10-26T01:00:00Z')});await page.clock.pauseAt(new Date('2026-10-26T01:00:01Z'));await page.goto(origin);
  await page.evaluate(()=>{
   window.beepCount=0;window.AudioContext=class{constructor(){this.currentTime=0;this.destination={}}createOscillator(){return {frequency:{},connect(){},start(){window.beepCount++},stop(){}}}createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}}}close(){}};
  });
  const disk=()=>page.evaluate(()=>JSON.parse(localStorage.getItem(Lab.core.STORAGE_KEY)));
  const readActive=async()=>{const db=await disk();return db.sessions.find(s=>s.id===db.activeId)};
  const download=async(target,action)=>{const waiting=target.waitForEvent('download');await target.locator(`[data-action="${action}"]`).first().click();return fs.readFile(await (await waiting).path())};
  await page.locator('[data-action="new"]').first().click();assert.equal(await page.locator('[name="beep"]').isChecked(),true);await page.locator('[data-action="new-workflow"]').click();
  assert.equal(await page.locator('#workflow-beep').isChecked(),true);
  await page.locator('#workflow-athlete').fill('Workflow Rider');await page.locator('#workflow-ftp').fill('294');await page.locator('#workflow-age').fill('30');
  await page.locator('[data-workflow-action="example"]').click();
  assert.equal(await page.locator('.workflow-table tbody tr').count(),8);assert.match(await page.locator('#workflow-preview').textContent(),/3h/);
  assert.equal(await page.locator('#workflow-error').textContent(),'');
  const example=await page.locator('#workflow-text').inputValue();assert.doesNotMatch(example,/[()（）]/);assert.doesNotMatch(await page.locator('.workflow-modal').textContent(),/括号内容忽略|仅在窗口开始时提醒/);
  await page.locator('#workflow-text').fill(example+'\n- Work 10 91%');assert.match(await page.locator('#workflow-error').textContent(),/第 9 行/);assert.equal(await page.locator('#workflow-save').isDisabled(),true);
  await page.locator('#workflow-text').fill(example.replace(/ lac 30s\/60s/g,''));
  for(let index=2;index<=5;index++)await page.locator(`[data-step-check="${index}"]`).check();
  await page.locator('[data-workflow-action="sample"]').click();assert.equal((await page.locator('#workflow-text').inputValue()).match(/lac 30s\/60s/g).length,4);
  await page.locator('[data-step="6"] [data-step-field="duration"]').fill('90m');await page.locator('[data-step="6"] [data-step-field="duration"]').press('Tab');
  assert.match(await page.locator('#workflow-text').inputValue(),/Endurance 1h30m/);
  await page.locator('[data-step="6"] [data-step-field="duration"]').fill('95m');await page.locator('[data-step="6"] [data-step-field="duration"]').press('Tab');
  await page.locator('[data-step="7"] [data-workflow-action="copy"]').click();assert.equal(await page.locator('.workflow-table tbody tr').count(),9);
  await page.locator('[data-step="8"] [data-workflow-action="remove"]').click();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#workflow-preview').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/pacelab-workflow-mobile.png'});
  await page.setViewportSize({width:1440,height:1080});
  await page.locator('#workflow-save').click();assert.equal((await readActive()).type,'custom-workflow');
  await page.locator('[data-action="skip-resting"]').click();
  await page.clock.fastForward(10800000);assert.equal((await readActive()).execution.status,'done');
  const full=await readActive();assert.equal(full.recording.windows.length,8);assert.equal(full.recording.endedAt-full.recording.startedAt,10800000);
  assert.equal(full.stages.filter(s=>s.sampling).length,4);assert.ok(full.recording.records.length<10,'background delay must not fabricate sensor history');

  // Copy the saved protocol into an editable short fixture, retaining original activity.
  await page.locator('[data-action="duplicate"]').first().click();await page.locator('#workflow-name').fill('Short workflow');
  await page.locator('#workflow-text').fill('- Warmup 20s ramp 100-200w\n4x\n- Work 10s 180w lac 3s/2s\n\n- Cooldown 10s ramp 160-100w');
  await page.locator('#workflow-beep').check();await page.locator('#workflow-save').click();
  await page.locator('[data-action="skip-resting"]').click();await page.clock.runFor(10000);
  assert.equal(await page.locator('#live-power').textContent(),'150W');await page.locator('[data-action="pause"]').click();
  await page.clock.runFor(20000);assert.equal(await page.locator('#live-power').textContent(),'150W');
  await page.locator('[data-action="start"]').click();await page.clock.runFor(10000);assert.equal((await readActive()).execution.stageIndex,1);
  await page.clock.runFor(5000);assert.match(await page.locator('#workflow-sampling').textContent(),/准备采样/);
  const beeps=await page.evaluate(()=>window.beepCount);await page.clock.runFor(1000);assert.equal(await page.evaluate(()=>window.beepCount),beeps);
  await page.clock.runFor(1000);assert.equal(await page.evaluate(()=>window.beepCount),beeps+1);
  assert.equal(await page.locator('#live-sample-lactate').getAttribute('data-index'),'1');
  await page.locator('#live-sample-lactate').fill('2.4');
  await page.clock.runFor(3000);assert.equal((await readActive()).execution.stageIndex,2);
  assert.equal(await page.locator('#live-sample-lactate').inputValue(),'2.4');
  assert.equal(await page.locator('#live-sample-lactate').getAttribute('data-index'),'1');
  await page.locator('#live-sample-lactate').fill('2.5');assert.equal((await readActive()).stages[1].lactate,2.5);assert.equal((await readActive()).stages[2].lactate,null);
  await page.locator('#live-sample-lactate').blur();await page.clock.runFor(7000);
  assert.equal(await page.locator('#live-sample-lactate').getAttribute('data-index'),'2');
  await page.locator('[data-action="pause"]').click();const frozen=await readActive();
  const snapshot=JSON.parse(await download(page,'export-json'));assert.equal(snapshot.session.execution.status,'paused');
  assert.equal(snapshot.session.stages[1].lactate,2.5);assert.equal(snapshot.session.stages[1].repeat.iteration,1);
  await page.reload();assert.equal((await readActive()).execution.status,'paused');assert.equal((await readActive()).execution.elapsedMs,frozen.execution.elapsedMs);
  await page.locator('[data-action="start"]').click();await page.clock.runFor(33000);
  const ended=await readActive();assert.equal(ended.execution.status,'done');assert.equal(ended.recording.windows.length,6);
  assert.equal(ended.recording.spans.reduce((sum,s)=>sum+s.endAt-s.startAt,0),70000);
  // Late entry belongs to its own lap but carries no invented sampling timestamp.
  await page.locator('[data-action="edit-sample"][data-index="2"]').first().click();await page.locator('#edit-sample-lactate').fill('2.8');await page.locator('.modal [data-action="close-modal"]').last().click();
  assert.equal((await readActive()).stages[2].sampleAt,undefined);
  const exported=await download(page,'export-json'),fit=await download(page,'export-fit');assert.equal(fit.subarray(8,12).toString(),'.FIT');
  const restored=await browser.newPage({viewport:{width:390,height:844}});restored.on('pageerror',e=>errors.push(e.message));await restored.goto(origin);
  await restored.locator('#import-file').setInputFiles({name:'workflow.json',mimeType:'application/json',buffer:exported});await restored.locator('.history-item').waitFor();
  await restored.locator('[data-action="open-session"]').click();
  const recovered=await restored.evaluate(()=>JSON.parse(localStorage.getItem(Lab.core.STORAGE_KEY)).sessions[0]);
  assert.equal(recovered.type,'custom-workflow');assert.equal(recovered.stages.length,6);assert.equal(recovered.stages[2].lactate,2.8);
  assert.deepEqual(recovered.recording,JSON.parse(exported).session.recording);assert.equal(recovered.stages[0].endPower,200);
  assert.equal(await restored.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await restored.screenshot({path:'/tmp/pacelab-workflow-results-mobile.png',fullPage:true});
  const longSession=await restored.evaluate(()=>{
   const s=Lab.workflow.createSession({athlete:{name:'Long Rider',sex:'undisclosed',age:30,ftp:294},text:'- Endurance 5h 61%'});
   s.execution.status='paused';s.execution.elapsedMs=10800000;return s;
  });
  await restored.locator('#import-file').setInputFiles({name:'long-workflow.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schemaVersion:1,exportType:'session',session:longSession}))});
  await restored.locator('.history-item').nth(1).waitFor();
  assert.equal(await restored.evaluate(()=>{const db=JSON.parse(localStorage.getItem(Lab.core.STORAGE_KEY));return db.sessions.find(s=>s.id===db.activeId).execution.elapsedMs}),10800000);

  // The portable build exposes the same editor and parser.
  const portable=await browser.newPage();portable.on('pageerror',e=>errors.push(e.message));await portable.goto(origin+'/dist/'+encodeURIComponent('PaceLab_运动表现测试工作台.html'));
  await portable.locator('[data-action="new"]').first().click();await portable.locator('[data-action="new-workflow"]').click();
  await portable.locator('#workflow-ftp').fill('294');await portable.locator('[data-workflow-action="example"]').click();assert.equal(await portable.locator('.workflow-table tbody tr').count(),8);

  // Exercise the app/controller boundary with quantized ramp targets and no replay of missed stages.
  const ergPage=await browser.newPage();ergPage.on('pageerror',e=>errors.push(e.message));
  await ergPage.clock.install({time:new Date('2026-10-26T02:00:00Z')});await ergPage.clock.pauseAt(new Date('2026-10-26T02:00:01Z'));await ergPage.goto(origin);
  await ergPage.evaluate(()=>{
   const s=Lab.workflow.createSession({athlete:{name:'ERG Rider',sex:'undisclosed',age:30,ftp:294},text:'- Warmup 20s ramp 101-199w\n- Work 10s 181w lac 3s/2s\n- Cooldown 10s 101w'});
   localStorage.setItem(Lab.core.STORAGE_KEY,JSON.stringify({schemaVersion:1,sessions:[s],activeId:s.id}));
  });await ergPage.reload();
  await ergPage.evaluate(()=>{
   window.ergCommands=[];const state={range:{min:0,max:1000,step:5},phase:'ready',power:null,error:'',requiresReconnect:false};
   Lab.devices.slots.trainer.status='connected';Lab.devices.slots.trainer.name='Simulated ERG';
   Lab.devices.slots.trainer.erg={state,setDesired(mode,power=null){if(state.phase!==mode||state.power!==power)window.ergCommands.push({mode,power,at:Date.now()});state.phase=mode;state.power=power}};
  });
  await ergPage.locator('[data-action="skip-resting"]').click();await ergPage.clock.runFor(10000);
  let commands=await ergPage.evaluate(()=>window.ergCommands);assert.equal(commands[0].power,100);assert.equal(commands.at(-1).power,150);assert.ok(commands.length<=11);
  assert.ok(commands.every(command=>command.power%5===0));
  await ergPage.locator('[data-action="pause"]').click();assert.equal((await ergPage.evaluate(()=>window.ergCommands)).at(-1).mode,'paused');
  const commandCount=(await ergPage.evaluate(()=>window.ergCommands)).length;await ergPage.clock.runFor(10000);assert.equal((await ergPage.evaluate(()=>window.ergCommands)).length,commandCount);
  await ergPage.locator('[data-action="start"]').click();assert.equal((await ergPage.evaluate(()=>window.ergCommands)).at(-1).power,150);
  await ergPage.clock.fastForward(30000);commands=await ergPage.evaluate(()=>window.ergCommands);assert.equal(commands.at(-1).mode,'stopped');
  assert.ok(!commands.slice(commandCount+1).some(command=>command.mode==='running'),'missed stages must not issue transient trainer targets');
  assert.deepEqual(errors,[]);console.log('Workflow browser checks passed: editing, repeats, full duration, ramp/pause, reminders, late entry, JSON/FIT, mobile and portable build.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
