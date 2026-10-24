const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function loadDevices(bluetooth){const context=vm.createContext({window:{Lab:{},isSecureContext:true},navigator:{bluetooth},setTimeout,clearTimeout});for(const name of ['erg','devices'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),context);return context.window.Lab.devices}
function packet(size,values){const view=new DataView(new ArrayBuffer(size));values.forEach(([offset,value,type='Uint16'])=>view['set'+type](offset,value,true));return view}
const D=loadDevices();
test('heart rate supports 8/16-bit, contact loss, and truncated packets',()=>{
 assert.equal(D.parseHeart(packet(2,[[0,0,'Uint8'],[1,147,'Uint8']])).hr,147);
 assert.equal(D.parseHeart(packet(3,[[0,1,'Uint8'],[1,210]])).hr,210);
 assert.equal(D.parseHeart(packet(2,[[0,4,'Uint8'],[1,147,'Uint8']])).hr,null);
 assert.throws(()=>D.parseHeart(packet(2,[[0,1,'Uint8']])));
});
test('cycling power skips optional fields and computes cadence across counter wrap',()=>{
 const flags=1|4|16|32|512;
 const first=D.parsePower(packet(19,[[0,flags],[2,240,'Int16'],[13,65535],[15,65000]]),null,1000);
 const second=D.parsePower(packet(19,[[0,flags],[2,245,'Int16'],[13,0],[15,488]]),first.crank,2000);
 assert.equal(second.values.power,245);assert.equal(second.values.cadence,60);
 assert.equal(D.parsePower(packet(8,[[0,32],[2,0,'Int16'],[4,0],[6,488]]),second.crank,5100).values.cadence,0);
 assert.equal(D.parsePower(packet(4,[[2,-5,'Int16']])).values.power,null);
 assert.throws(()=>D.parsePower(packet(4,[[0,32]])));
});
test('FTMS decodes full optional layout and split packets with More Data',()=>{
 const full=packet(30,[[0,0x1ffe],[2,3600],[6,180],[15,270,'Int16'],[26,93]]);
 // flags(2), speed(2), avg speed(2), cadence(2), avg cadence(2), distance(3), resistance(2), power(2), avg power(2), energy(5), HR(1), MET(1), elapsed(2), remaining(2)
 full.setUint8(24,153);const values=D.parseTrainer(full);
 assert.equal(values.speed,10);assert.equal(values.cadence,90);assert.equal(values.power,270);assert.equal(values.hr,153);
 const split=D.parseTrainer(packet(6,[[0,1|4|64],[2,182],[4,265,'Int16']]));
 assert.equal(split.speed,undefined);assert.equal(split.cadence,91);assert.equal(split.power,265);
 assert.throws(()=>D.parseTrainer(packet(2,[[0,0]])));
});
test('fresh dedicated sensors take priority; stale or disconnected data becomes null',()=>{
 const d=loadDevices();for(const kind of ['power','heart','trainer'])d.slots[kind].status='connected';
 d.slots.power.values.power={value:230,at:1000};d.slots.heart.values.hr={value:150,at:1000};d.slots.trainer.values={power:{value:220,at:5000},hr:{value:145,at:5000}};
 assert.equal(d.readSnapshot(5000).power,230);assert.equal(d.readSnapshot(5000).hr,150);
 assert.equal(d.readSnapshot(5000).powerMeterPower,230);assert.equal(d.readSnapshot(5000).trainerPower,220);assert.equal(d.readSnapshot(5000).powerSource,'power');
 assert.equal(d.readSnapshot(6001).power,220);assert.equal(d.readSnapshot(6001).powerSource,'trainer');
 assert.equal(d.readSnapshot(6001).powerMeterPower,null);assert.equal(d.readSnapshot(6001).trainerPower,220);
 assert.equal(d.readSnapshot(10001).hr,null);d.slots.trainer.status='disconnected';assert.equal(d.readSnapshot(6001).power,null);
 assert.equal(d.readSnapshot(6001).trainerPower,null);
 d.slots.power.values.power={value:0,at:6001};assert.equal(d.readSnapshot(6001).power,0);assert.equal(d.readSnapshot(6001).powerMeterPower,0);assert.equal(d.readSnapshot(6001).powerSource,'power');
 d.slots.power.status='disconnected';assert.equal(d.readSnapshot(6001).powerMeterPower,null);
});
test('connect, notification, malformed packet, disconnect and reconnect clean up listeners',async()=>{
 let requested;const characteristic=new EventTarget();characteristic.startNotifications=async()=>characteristic;
 const device=new EventTarget();device.name='Test HR';device.gatt={connected:false,connect:async()=>{device.gatt.connected=true;return {getPrimaryService:async()=>({getCharacteristic:async()=>characteristic})}},disconnect:()=>{device.gatt.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'))}};
 const d=loadDevices({requestDevice:async options=>{requested=options;return device}});await d.connectDevice('heart');
 assert.equal(requested.filters[0].services[0],0x180d);assert.equal(d.slots.heart.status,'connected');
 characteristic.value=packet(2,[[1,151,'Uint8']]);characteristic.dispatchEvent(new Event('characteristicvaluechanged'));assert.equal(d.readSnapshot().hr,151);
 characteristic.value=packet(1,[]);characteristic.dispatchEvent(new Event('characteristicvaluechanged'));assert.equal(d.readSnapshot().hr,151);
 device.gatt.disconnect();assert.equal(d.readSnapshot().hr,null);await d.connectDevice('heart');d.disconnectDevice('heart');assert.equal(d.slots.heart.status,'disconnected');
});
test('a late failure from a dropped connection cannot disconnect its replacement',async()=>{
 let started,rejectOld;const entered=new Promise(resolve=>started=resolve),oldPending=new Promise((resolve,reject)=>rejectOld=reject);
 function makeDevice(name,pending){
  const characteristic=new EventTarget(),device=new EventTarget();characteristic.startNotifications=()=>{if(pending){started();return oldPending}return Promise.resolve()};device.name=name;
  device.gatt={connected:false,connect:async()=>{device.gatt.connected=true;return {getPrimaryService:async()=>({getCharacteristic:async()=>characteristic})}},disconnect:()=>{device.gatt.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'))}};
  return device;
 }
 const old=makeDevice('Old HR',true),replacement=makeDevice('New HR',false);let requests=0;
 const d=loadDevices({requestDevice:async()=>requests++?replacement:old}),first=d.connectDevice('heart');await entered;old.gatt.disconnect();
 await d.connectDevice('heart');rejectOld(Error('late GATT failure'));await first;
 assert.equal(d.slots.heart.status,'connected');assert.equal(d.slots.heart.name,'New HR');assert.equal(replacement.gatt.connected,true);await d.disconnectDevice('heart');
});
test('RR parsing retains all intervals and precision across HR and energy layouts',()=>{
 const value=D.parseHeart(packet(11,[[0,31,'Uint8'],[1,145],[3,1234],[5,1024],[7,513],[9,512]]));
 assert.deepEqual(Array.from(value.rr),[1000,500.9765625,500]);assert.equal(value.contact,true);
 assert.deepEqual(Array.from(D.parseHeart(packet(4,[[0,16,'Uint8'],[1,120,'Uint8'],[2,512]])).rr),[500]);
 assert.equal(D.parseHeart(packet(4,[[0,20,'Uint8'],[1,120,'Uint8'],[2,512]])).contact,false);
 for(const values of [[3,[[0,16,'Uint8']]],[2,[[0,16,'Uint8']]],[3,[[0,8,'Uint8']]]])assert.throws(()=>D.parseHeart(packet(...values)));
});
