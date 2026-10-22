const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({window:{Lab:{}},setTimeout,clearTimeout});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/erg.js'),'utf8'),context);
const E=context.window.Lab.erg;
function fixture(options={}){
 const point=new EventTarget(),status=new EventTarget(),writes=[];
 const features=new DataView(new ArrayBuffer(8));features.setUint32(4,options.unsupported?0:8,true);
 const range=new DataView(new ArrayBuffer(6));range.setInt16(0,0,true);range.setInt16(2,1000,true);range.setUint16(4,5,true);
 point.startNotifications=status.startNotifications=async()=>{};
 const respond=(opcode,result=1)=>{point.value=new DataView(Uint8Array.from([0x80,opcode,result]).buffer);point.dispatchEvent(new Event('characteristicvaluechanged'))};
 point.writeValueWithResponse=async bytes=>{const values=Array.from(bytes);writes.push(values);if(options.respond)options.respond(values,respond);else queueMicrotask(()=>respond(values[0]));if(options.completeWrite)await options.completeWrite(values)};
 const service={getCharacteristic:async id=>({[0x2acc]:{readValue:async()=>features},[0x2ad8]:{readValue:async()=>range},[0x2ad9]:point,[0x2ada]:status})[id]};
 const controller=E.createController(service,options.onChange,{timeoutMs:options.timeoutMs??100});
 const notify=bytes=>{status.value=new DataView(Uint8Array.from(bytes).buffer);status.dispatchEvent(new Event('characteristicvaluechanged'))};
 return {controller,writes,respond,notify,features,range};
}
test('checks target-power capability, range and step before writing',async()=>{
 const f=fixture();assert.equal(E.readCapabilities(f.features,f.range).step,5);E.validatePower({min:0,max:1000,step:5},120);
 assert.throws(()=>E.validatePower({min:0,max:1000,step:5},123));assert.throws(()=>E.validatePower({min:0,max:1000,step:5},1200));
 const unsupported=fixture({unsupported:true});await assert.rejects(unsupported.controller.initializeController(),/不支持 FTMS ERG/);assert.equal(unsupported.writes.length,0);
});
test('requests control and serializes target power, start, stage change, pause, resume and stop',async()=>{
 const f=fixture(),c=f.controller;await c.initializeController();assert.equal(c.state.phase,'ready');
 c.setDesired('running',120);await c.waitForIdle();assert.equal(c.state.power,120);assert.equal(c.state.phase,'running');
 c.setDesired('running',135);await c.waitForIdle();c.setDesired('running',135);await c.waitForIdle();
 c.setDesired('paused');await c.waitForIdle();assert.equal(c.state.power,null);
 c.setDesired('running',150);await c.waitForIdle();c.setDesired('stopped');await c.waitForIdle();
 assert.deepEqual(f.writes,[[0],[5,120,0],[7],[5,135,0],[8,2],[5,150,0],[7],[8,1]]);assert.equal(c.state.phase,'stopped');c.disposeController();
});
test('pause supersedes a target in flight and never starts an obsolete stage',async()=>{
 let held;const f=fixture({respond:(bytes,respond)=>{if(bytes[0]===5)held=()=>respond(5);else queueMicrotask(()=>respond(bytes[0]))}}),c=f.controller;
 await c.initializeController();c.setDesired('running',120);c.setDesired('paused');held();await c.waitForIdle();
 assert.deepEqual(f.writes,[[0],[5,120,0],[8,2]]);assert.equal(c.state.phase,'paused');c.disposeController();
});
test('waits for both GATT write completion and control acknowledgement before next command',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),f=fixture({completeWrite:bytes=>bytes[0]===5?gate:Promise.resolve()}),c=f.controller;
 await c.initializeController();c.setDesired('running',120);await new Promise(setImmediate);assert.equal(c.state.phase,'setting');assert.deepEqual(f.writes,[[0],[5,120,0]]);
 c.setDesired('paused');await new Promise(setImmediate);assert.equal(f.writes.length,2);release();await c.waitForIdle();assert.deepEqual(f.writes,[[0],[5,120,0],[8,2]]);c.disposeController();
});
test('rapid stage changes coalesce to latest requested power',async()=>{
 let held;const f=fixture({respond:(bytes,respond)=>{if(bytes[0]===5&&bytes[1]===120)held=()=>respond(5);else queueMicrotask(()=>respond(bytes[0]))}}),c=f.controller;
 await c.initializeController();c.setDesired('running',120);c.setDesired('running',135);c.setDesired('running',150);held();await c.waitForIdle();
 assert.deepEqual(f.writes,[[0],[5,120,0],[5,150,0],[7]]);assert.equal(c.state.power,150);c.disposeController();
});
test('rejected command is visible and is not retried by repeated synchronization',async()=>{
 const f=fixture({respond:(bytes,respond)=>queueMicrotask(()=>respond(bytes[0],bytes[0]===5?3:1))}),c=f.controller;await c.initializeController();
 c.setDesired('running',120);await c.waitForIdle();assert.equal(c.state.phase,'error');assert.match(c.state.error,/拒绝/);assert.equal(c.state.power,null);
 c.setDesired('running',120);await c.waitForIdle();assert.equal(f.writes.length,2);c.disposeController();
});
test('timeout requires reconnect and does not accept an unrelated opcode as acknowledgement',async()=>{
 const f=fixture({timeoutMs:15,respond:(bytes,respond)=>queueMicrotask(()=>respond(bytes[0]===5?7:bytes[0]))}),c=f.controller;await c.initializeController();
 c.setDesired('running',120);await c.waitForIdle();assert.equal(c.state.requiresReconnect,true);assert.match(c.state.error,/响应超时/);
 c.setDesired('paused');await c.waitForIdle();assert.deepEqual(f.writes,[[0],[5,120,0]]);c.disposeController();
});
test('loss of control does not automatically reacquire it to pause; explicit resume reacquires',async()=>{
 const f=fixture(),c=f.controller;await c.initializeController();c.setDesired('running',120);await c.waitForIdle();
 f.notify([255]);assert.match(c.state.error,/控制权已丢失/);c.setDesired('paused');await c.waitForIdle();assert.equal(f.writes.length,3);
 c.setDesired('running',120);await c.waitForIdle();assert.deepEqual(f.writes.slice(3),[[0],[5,120,0],[7]]);assert.equal(c.state.error,'');c.disposeController();
});
test('explicit retry can recover a rejected sampling pause without restarting the trainer',async()=>{
 let rejectPause=true;const f=fixture({respond:(bytes,respond)=>queueMicrotask(()=>{const result=bytes[0]===8&&rejectPause?4:1;rejectPause=false;respond(bytes[0],result)})}),c=f.controller;
 await c.initializeController();c.setDesired('running',120);await c.waitForIdle();rejectPause=true;c.setDesired('paused');await c.waitForIdle();assert.equal(c.state.phase,'error');
 const count=f.writes.length;c.setDesired('paused',null,true);await c.waitForIdle();assert.equal(c.state.phase,'paused');assert.equal(c.state.error,'');assert.deepEqual(f.writes.slice(count),[[8,2]]);c.disposeController();
});
test('external stop and target changes are reported; disposal cancels an in-flight operation',async()=>{
 const f=fixture(),c=f.controller;await c.initializeController();c.setDesired('running',120);await c.waitForIdle();f.notify([8,125,0]);assert.match(c.state.error,/功率已在设备端改变/);
 f.notify([2,2]);assert.match(c.state.error,/停止或暂停/);c.disposeController();f.notify([255]);assert.equal(c.state.phase,'disconnected');
 const held=fixture({respond:(bytes,respond)=>{if(bytes[0]===0)queueMicrotask(()=>respond(0))}});await held.controller.initializeController();held.controller.setDesired('running',120);held.controller.disposeController();await held.controller.waitForIdle();assert.equal(held.controller.state.phase,'disconnected');
});
