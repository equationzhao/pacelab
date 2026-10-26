// Uses a simulated audio sink to verify countdown timing without playing sound.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const origin=process.env.PACELAB_URL||'http://localhost:5173',errors=[];
  async function openFixture(text,beep=true,legacy=false){
   const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.clock.install({time:new Date('2026-10-26T03:00:00Z')});await page.clock.pauseAt(new Date('2026-10-26T03:00:01Z'));
   await page.addInitScript(()=>{
    window.tones=[];window.audioContexts=0;
    window.AudioContext=class{
     constructor(){window.audioContexts++;this.state='suspended';this.destination={}}
     get currentTime(){return Date.now()/1000}
     async resume(){this.state='running'}
     createOscillator(){const tone={at:null,frequency:null,duration:null};return {frequency:{set value(value){tone.frequency=value}},connect(){},disconnect(){},start(){tone.at=Date.now()},stop(end){tone.duration=end-Date.now()/1000;window.tones.push(tone);this.onended?.()}}}
     createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}}}
    };
   });
   await page.goto(origin);
   await page.evaluate(({text,beep,legacy})=>{
    const athlete={name:'Sound Rider',sex:'undisclosed',age:30,ftp:294};
    const s=legacy?Lab.tests.newSession({athlete,startPower:120,increment:15,stageMinutes:2,stageCount:3,samplingMode:'solo',samplePauseSec:45,beep}):Lab.workflow.createSession({athlete,text,beep});
    localStorage.setItem(Lab.core.STORAGE_KEY,JSON.stringify({schemaVersion:1,sessions:[s],activeId:s.id}));
   },{text,beep,legacy});await page.reload();
   await page.locator('[data-action="skip-resting"]').click();return page;
  }
  const ticks=page=>page.evaluate(()=>window.tones.filter(tone=>tone.frequency===1200));
  const page=await openFixture('- Work 10s 180w lac 3s/2s\n- Endurance 10s 120w');
  await page.clock.runFor(4999);assert.equal((await ticks(page)).length,0);
  await page.clock.runFor(1);assert.equal((await ticks(page)).length,1);
  await page.clock.runFor(250);assert.equal((await ticks(page)).length,1,'quarter-second UI updates cannot duplicate a tick');
  await page.locator('[data-action="pause"]').click();await page.clock.runFor(5000);assert.equal((await ticks(page)).length,1);
  await page.locator('[data-action="start"]').click();await page.clock.runFor(500);assert.equal((await ticks(page)).length,1,'resume cannot replay the current second');
  await page.clock.runFor(250);assert.equal((await ticks(page)).length,2);
  await page.clock.runFor(1000);assert.equal((await ticks(page)).length,3,'sampling-window start produces one tick, not two');
  await page.clock.fastForward(2000);assert.equal((await ticks(page)).length,4,'missed seconds are not replayed');
  await page.clock.runFor(1000);assert.equal((await ticks(page)).length,4,'ticks end at the segment boundary');
  await page.clock.runFor(10000);assert.equal((await ticks(page)).length,4,'segments without sampling and completed sessions stay quiet');
  assert.equal(await page.evaluate(()=>window.audioContexts),1,'reuse the unlocked audio context');
  assert.ok((await ticks(page)).every(tone=>Math.abs(tone.duration-.06)<.00001),'countdown ticks should be short');
  await page.close();

  const noLead=await openFixture('- Work 10s 180w lac 3s');await noLead.clock.runFor(6999);assert.equal((await ticks(noLead)).length,0);
  await noLead.clock.runFor(3001);assert.equal((await ticks(noLead)).length,3);await noLead.close();
  const muted=await openFixture('- Work 10s 180w lac 3s/2s',false);await muted.clock.runFor(15000);
  assert.equal(await muted.evaluate(()=>window.tones.length),0);assert.equal(await muted.evaluate(()=>window.audioContexts),0);await muted.close();
  const skipped=await openFixture('- Work 10s 180w lac 3s/2s\n- Endurance 10s 120w');await skipped.clock.fastForward(15000);assert.equal((await ticks(skipped)).length,0);await skipped.close();
  const legacy=await openFixture('',true,true);await legacy.clock.fastForward(89000);assert.equal((await ticks(legacy)).length,0);
  await legacy.clock.runFor(1000);assert.equal((await ticks(legacy)).length,1);
  await legacy.clock.runFor(1000);assert.equal((await ticks(legacy)).length,2);
  await legacy.clock.fastForward(29000);await legacy.clock.runFor(3000);assert.equal((await ticks(legacy)).length,2,'legacy ticks stop when the effort ends');await legacy.close();
  assert.deepEqual(errors,[]);console.log('PASS sound: per-second countdown, short tones, one audio context, pause/resume, boundary deduplication, no backlog, zero lead, mute and legacy steps.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
