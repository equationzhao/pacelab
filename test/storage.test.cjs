const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/storage.js'),'utf8');
function createStore(initial=null){
 let value=initial,failure=null;
 const localStorage={getItem:()=>value,setItem:(_key,next)=>{if(failure)throw failure;value=next}};
 const context=vm.createContext({window:{},localStorage});vm.runInContext(source,context);
 return {store:context.window.Lab.storage,readValue:()=>value,replaceValue:next=>{value=next},setFailure:error=>{failure=error}};
}
const empty={schemaVersion:1,sessions:[],activeId:null};
test('quota failure keeps the last durable snapshot and can retry the latest data',()=>{
 const {store,readValue,setFailure}=createStore();store.readDatabase();
 assert.equal(store.writeDatabase(empty),true);const saved=readValue(),savedAt=store.readStatus().savedAt;
 const changed={...empty,athlete:{name:'Latest rider'}};
 setFailure({name:'QuotaExceededError'});
 assert.equal(store.writeDatabase(changed),false);assert.equal(readValue(),saved);
 assert.equal(store.readStatus().reason,'quota');assert.equal(store.readStatus().savedAt,savedAt);
 setFailure(null);assert.equal(store.writeDatabase(changed),true);
 assert.equal(JSON.parse(readValue()).athlete.name,'Latest rider');assert.equal(store.readStatus().status,'saved');
});
test('stale writes and retries cannot overwrite another tab, including cleared storage',()=>{
 const {store,readValue,replaceValue}=createStore(JSON.stringify(empty));store.readDatabase();
 const external=JSON.stringify({...empty,athlete:{name:'Other tab'}});replaceValue(external);
 assert.equal(store.writeDatabase(empty),false);assert.equal(store.readStatus().reason,'conflict');
 assert.equal(store.writeDatabase(empty),false);assert.equal(readValue(),external);
 store.readDatabase();assert.equal(store.writeDatabase(empty),true);
 replaceValue(null);assert.equal(store.checkForConflict(),true);assert.equal(store.writeDatabase(empty),false);assert.equal(readValue(),null);
});
test('unreadable data remains available for recovery and is never replaced by an empty database',()=>{
 for(const original of ['{broken','null','{"schemaVersion":2,"sessions":[]}','{"schemaVersion":1,"sessions":[null]}']){
  const {store,readValue}=createStore(original);
  assert.equal(store.readDatabase().sessions.length,0);assert.equal(store.readStatus().reason,'read');
  assert.equal(store.writeDatabase(empty),false);assert.equal(readValue(),original);assert.equal(store.readOriginal(),original);
 }
});
test('blocked storage is reported without escaping into the recording loop',()=>{
 const {store,setFailure}=createStore();store.readDatabase();setFailure({name:'SecurityError'});
 assert.equal(store.writeDatabase(empty),false);assert.equal(store.readStatus().reason,'unavailable');
 const context=vm.createContext({window:{},localStorage:{getItem:()=>{throw Error('Blocked')}}});vm.runInContext(source,context);
 assert.equal(context.window.Lab.storage.readDatabase().sessions.length,0);
 assert.equal(context.window.Lab.storage.readStatus().reason,'read');
});
