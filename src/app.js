(function(){
'use strict';
const Lab=window.Lab;
const C=Lab.core,T=Lab.tests,Charts=Lab.charts,W=Lab.workflow;
const D=Lab.devices,R=Lab.recording,H=Lab.hrv,S=Lab.storage;
const {esc,icon,fmt,dateText,uid}=C;
let db=C.read();
let lastRecordingSave=0;
let controlledSessionId=null;
let lastTrainerStatus='disconnected';
let soundContext=null;
const sampleTickSeconds=new WeakMap();
for(const session of db.sessions)if(R.recoverRecording(session))C.write(db);
let view='workbench',preset='fine',goal='fine',search='',scatterMetric='lactate';
const $=q=>document.querySelector(q);
const active=()=>db.sessions.find(s=>s.id===db.activeId)||null;
const statusLabels={idle:'尚未开始',running:'测试进行中',paused:'已暂停',ready:'等待下一阶段',done:'已完成'};
const statusClass={idle:'',running:'ongoing',paused:'paused',ready:'paused',done:'done'};
const tag=(st)=>`<span class="status-pill ${statusClass[st]||''}"><span class="status-dot"></span>${statusLabels[st]||'—'}</span>`;
const btn=(action,label,style='btn',extra='')=>`<button class="${style}" data-action="${action}" ${extra}>${label}</button>`;
const sexLabel=sex=>({male:'男',female:'女',undisclosed:'不透露'}[sex]||'');
function athleteText(a){return a?[a.name,sexLabel(a.sex),`${a.age} 岁`,`FTP ${a.ftp} W`].join(' · '):''}
function athleteLine(s){const parts=[athleteText(s.athlete),T.goals.find(g=>g.id===T.readGoalId(s.protocol.goal))?.name].filter(Boolean);return parts.length?`<div class="athlete-line">${parts.map(esc).join(' · ')}</div>`:''}
function persist(s=null){if(s)s.updatedAt=new Date().toISOString();const saved=C.write(db);paintStorage();return saved}
function paintStorage(){
 const root=$('#storage-status');if(!root)return;
 const state=S.readStatus(),failed=state.status==='failed',reload=['read','conflict'].includes(state.reason);
 root.hidden=!db.sessions.length&&!failed;root.classList.toggle('has-error',failed);
 const message=state.reason==='read'?'无法读取本地记录':state.reason==='conflict'?'其他标签页已更新记录':failed?'更改尚未保存':'已保存到此浏览器';
 const detail=state.reason==='read'?(db.sessions.length?'原有数据未被覆盖。本页新记录尚未保存，请下载备份。':'原有数据未被覆盖，可先导出原始数据。'):state.reason==='conflict'?'本页数据已保留。请先备份，再重新载入。':failed?'存储不可用或空间不足。请先备份，避免刷新后丢失更改。':`${db.sessions.length} 次测试${state.savedAt?' · 最近保存 '+new Date(state.savedAt).toLocaleTimeString('zh-CN',{hour12:false}):''}`;
 if($('#storage-message').textContent!==message)$('#storage-message').textContent=message;
 $('#storage-detail').textContent=detail;
 root.querySelector('[data-action="retry-save"]').hidden=!failed||reload;
 root.querySelector('[data-action="reload-data"]').hidden=!reload;
 const backup=root.querySelector('[data-action="export-backup"]');
 backup.hidden=!db.sessions.length;
 root.querySelector('[data-action="export-original"]').hidden=state.reason!=='read'||S.readOriginal()===null;
}
function setView(v){view=v;$('#layout')?.classList.remove('show-menu');render()}
function toast(msg){const wrap=$('#toast-stack');const node=document.createElement('div');node.className='toast';node.textContent=msg;wrap.appendChild(node);setTimeout(()=>node.remove(),4200)}
Lab.ui={toast};
function renderSidebar(){
 const nav=[['workbench','测试工作台','activity'],['history','历史记录','history']];
 $('#sidebar').innerHTML=`<a class="brand" href="#" data-action="go-workbench"><div class="brand-mark">${icon('activity')}</div><div class="brand-name">PaceLab<span style="color:#c5ef87">.</span></div></a>
 ${nav.map(([v,label,ic])=>`<button class="nav-link ${view===v?'active':''}" data-action="view" data-view="${v}">${icon(ic)}<span>${label}</span>${v==='history'?`<span class="tiny-pill">${db.sessions.length}</span>`:''}</button>`).join('')}`;
}
function renderTopbar(){
 $('#topbar').innerHTML=`<div style="display:flex;align-items:center;gap:15px;min-width:0"><button class="btn btn-ghost btn-icon menu-button" aria-label="打开菜单" data-action="toggle-menu">${icon('menu')}</button><div class="breadcrumbs"><b>${esc(T.byId(active()?.type)?.name||'PaceLab')}</b></div></div><div class="top-actions">${btn('import',icon('upload')+' 导入 JSON','btn btn-sm')}${btn('new',icon('plus')+' 新建测试','btn btn-sm btn-dark')}</div>`;
}
function heading(title,actions=''){
 return `<div class="heading"><h1>${esc(title)}</h1>${actions?`<div class="heading-actions">${actions}</div>`:''}</div>`;
}

function elapsedNow(e){return Math.max(0,(e.elapsedMs||0)+(e.status==='running'&&e.startedAt?Math.max(0,Date.now()-e.startedAt):0))}
function phaseDuration(s){return s.execution.phase==='sampling'?s.protocol.samplePauseSec*1000:s.stages[s.execution.stageIndex].durationSec*1000}
function shouldShowSampleEntry(s){const e=s.execution;if(s.type==='custom-workflow')return e.status!=='idle'&&Number.isInteger(e.sampleEntryIndex);return ['running','paused','ready'].includes(e.status)&&(e.phase==='sampling'||phaseDuration(s)-elapsedNow(e)<=30000)}
function resolveLivePower(s){return W.resolveTargetPower(s.stages[s.execution.stageIndex],Math.floor(elapsedNow(s.execution)/1000)*1000)}
function describeStage(s,index){const st=s.stages[index];return s.type==='custom-workflow'?`${st.label}${st.repeat?' · '+st.repeat.iteration+'/'+st.repeat.count:''} · 第 ${index+1} 段`:`第 ${index+1} 级`}
function renderPendingSamples(s){if(s.type!=='custom-workflow')return '';return `<div class="workflow-pending">${s.stages.map((st,i)=>st.sampling&&st.lactate===null&&(i<s.execution.stageIndex||s.execution.status==='done')?btn('edit-sample',`${esc(describeStage(s,i))} · ${st.skipped?'已跳过':'待补录'}`,'btn btn-sm',`data-index="${i}"`):'').join('')}</div>`}
function updateSampleNotices(s){
 const e=s.execution,st=s.stages[e.stageIndex],elapsed=elapsedNow(e);
 const state=s.type==='custom-workflow'?W.readSamplingState(st,elapsed):e.phase==='sampling'||elapsed>=st.durationSec*1000?'ended':elapsed>=Math.max(0,st.durationSec*1000-30000)?'window':'waiting';
 const rank={waiting:0,prepare:1,window:2,ended:3,none:0};
 if(rank[state]>(st.sampleNotice||0)){st.sampleNotice=rank[state];persist(s)}
 if(e.status==='running'&&s.protocol.beep&&['prepare','window'].includes(state)){
  const second=Math.floor(elapsed/1000);
  if(sampleTickSeconds.get(st)!==second){sampleTickSeconds.set(st,second);beep(true)}
 }
 if(s.type==='custom-workflow'&&state==='window'&&e.sampleEntryIndex!==e.stageIndex&&!document.activeElement?.closest('#live-sample-entry')){e.sampleEntryIndex=e.stageIndex;persist(s)}
}

function renderSampleFields(s,index,prefix){const st=s.stages[index];return `<div class="sample-fields">${[['lactate','乳酸值','mmol/L','0.2','30','0.1'],['rpe','RPE','0–10','0','10','0.5']].map(([field,label,unit,min,max,step])=>`<div class="sample-field"><label for="${prefix}-${field}">${label}<span>${unit}</span></label><input id="${prefix}-${field}" aria-label="第${index+1}级${label}" aria-describedby="${prefix}-${field}-error" data-index="${index}" data-field="${field}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" placeholder="—" value="${esc(st[field]??'')}"><span class="sample-error" id="${prefix}-${field}-error" aria-live="polite"></span></div>`).join('')}</div>`}
function renderSampleEntry(s){const index=s.type==='custom-workflow'?s.execution.sampleEntryIndex:s.execution.stageIndex;return `<div class="sample-entry" data-stage="${index}"><div class="sample-heading"><span class="sample-symbol">${icon('droplet')}</span><h2>${s.type==='custom-workflow'?'采样记录 · '+esc(describeStage(s,index)):'准备采血 · 第 '+(index+1)+' 级'}</h2></div>${renderSampleFields(s,index,'live-sample')}</div>`}
function describeRestingSample(s){const sample=s.restingSample;return sample?.skipped?'已跳过':C.n(sample?.lactate)===null?'未记录':`${fmt(sample.lactate,1)} mmol/L`}
function renderRestingSummary(s){return `<div class="resting-summary">${icon('droplet')}<span>静息乳酸 <strong>${describeRestingSample(s)}</strong></span></div>`}
function renderRestingEntry(s){return `<div class="sample-entry resting-entry"><div class="sample-heading"><span class="sample-symbol">${icon('droplet')}</span><h2>静息乳酸测试</h2></div><div class="sample-field"><label for="resting-lactate">静息乳酸值<span>mmol/L</span></label><input id="resting-lactate" type="number" inputmode="decimal" min="0.2" max="30" step="0.1" placeholder="—" aria-describedby="resting-lactate-error" value="${esc(s.restingSample?.lactate??'')}"><span class="sample-error" id="resting-lactate-error" aria-live="polite"></span></div></div>`}
function renderLive(s){
 const e=s.execution,st=s.stages[Math.min(e.stageIndex,s.stages.length-1)];
 const next=s.stages.slice(e.stageIndex,e.stageIndex+5);
 return `<div class="card card-pad"><div class="session-line"><span class="session-title">${esc(s.name)}</span>${tag(e.status)}<span>${dateText(s.createdAt)}</span></div>${athleteLine(s)}${e.status!=='idle'&&s.type!=='custom-workflow'?renderRestingSummary(s):''}
  <div class="live-card"><div class="live-top"><span class="live-label">阶段计时</span><span class="live-mode">${s.type==='custom-workflow'?'自定义 · 连续执行':s.protocol.samplingMode==='solo'?'单人 · 分段采样':'双人 · 连续采样'}</span></div>
   ${e.status==='idle'?(s.type==='custom-workflow'?`<div class="workflow-stage-description">${s.stages.length} 个分段 · ${W.formatDuration(s.stages.reduce((sum,x)=>sum+x.durationSec,0))} · ${s.stages.filter(x=>x.sampling).length} 次采样<br>FTP ${s.athlete.ftp} W · 开始后按顺序自动执行</div>`:renderRestingEntry(s)):`<div class="live-center"><div><div class="live-step" id="live-step">${s.type==='custom-workflow'?esc(describeStage(s,e.stageIndex)):'阶段 '+String(e.stageIndex+1).padStart(2,'0')} / ${String(s.stages.length).padStart(2,'0')}</div><div class="live-power" id="live-power">${resolveLivePower(s)}<small>W</small></div></div><div class="timer-area"><label id="live-phase-label">${e.phase==='sampling'?'采样间隔':'当前阶段剩余'}</label><div id="live-time" class="timer">${fmtTime(st.durationSec*1000)}</div></div></div>
   ${s.type==='custom-workflow'?`<div class="workflow-stage-description">${esc(W.formatTarget(st))}</div><div id="workflow-sampling" class="workflow-sampling" role="status"></div>`:''}<div class="live-sensors">${[['power','实际功率','W'],['hr','心率','bpm'],['cadence','踏频','rpm'],['alpha1','DFA α1','']].map(([key,label,unit])=>`<div><span>${label}</span><strong data-live-sensor="${key}">—</strong><small>${unit}</small></div>`).join('')}</div><div class="erg-status" data-erg-status aria-live="polite"></div>
   <div class="stage-progress"><div id="live-progress" class="stage-fill"></div></div>
   <div id="live-sample-entry">${shouldShowSampleEntry(s)?renderSampleEntry(s):''}</div>`}
   <div class="live-buttons" id="live-controls">${liveControls(s)}</div>
  </div>
  <div class="card-heading" style="margin-top:24px;margin-bottom:8px"><div><div class="card-title" style="font-size:13px">阶段功率</div></div></div><div class="next-steps">${next.map((x,i)=>`<div class="power-chip ${i===0?'active':''}">${esc(W.formatTarget(x))} <span style="color:#9aa5a8;font-size:10px">· ${W.formatDuration(x.durationSec)}</span></div>`).join('')}</div>
 ${renderPendingSamples(s)}</div>`;
}
function liveControls(s){const e=s.execution;
 if(e.status==='done')return btn('duplicate',icon('copy')+' 复制此测试','btn btn-primary')+(s.recording?btn('export-fit',icon('download')+' 导出 FIT','btn btn-dark'):btn('export-json',icon('download')+' 导出 JSON','btn btn-dark'));
 if(e.status==='idle'&&s.type==='custom-workflow')return btn('skip-resting',icon('play')+' 开始流程','btn btn-primary')+btn('edit-workflow',icon('edit')+' 编辑流程','btn btn-dark');
 if(e.status==='idle')return btn('start',icon('play')+' 保存并开始','btn btn-primary')+btn('skip-resting','跳过并开始 '+icon('arrow'),'btn btn-dark');
 if(e.status==='ready')return btn('next',icon('arrow')+' '+(e.stageIndex<s.stages.length-1?'下一阶段':'结束测试'),'btn btn-primary')+btn('finish',icon('stop')+' 结束','btn btn-dark');
 return (e.status==='running'?btn('pause',icon('pause')+' 暂停','btn btn-primary'):btn('start',icon('play')+' 继续','btn btn-primary'))+btn('next',icon('arrow')+' 下一阶段','btn btn-dark')+btn('finish',icon('stop')+' 结束','btn btn-dark');
}
function fmtTime(ms){const secs=Math.ceil(Math.max(0,ms)/1000);const mm=Math.floor(secs/60),ss=secs%60;return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`}
function sessionRows(s){
 const e=s.execution;
 return s.stages.map((st,i)=>{
 const lac=C.n(st.lactate);
 return `<tr class="${i===e.stageIndex&&e.status!=='done'?'active-row':''}"><td><span class="table-index">${String(i+1).padStart(2,'0')}</span></td><td><strong>${esc(W.formatTarget(st))}</strong>${s.type==='custom-workflow'?`<div>${esc(describeStage(s,i))}${st.skipped?' · 已跳过':''}</div>`:''}</td><td>${W.formatDuration(st.durationSec)}</td>
 <td>${lac===null?'—':fmt(lac,1)}</td><td>${esc(st.hr??'—')}</td><td>${esc(st.rpe??'—')}</td>
 <td>${st.quality==='exclude'?'排除':st.quality==='suspect'?'可疑':'正常'}</td><td>${esc(st.notes||'—')}</td>
 <td>${btn('edit-sample',lac===null||C.n(st.rpe)===null?'补录':'修改','btn btn-sm',`data-index="${i}" aria-label="录入第${i+1}级数据"`)}</td></tr>`;
 }).join('');
}
function recordTable(s){
 return `<div class="card card-pad section-space"><div class="details"><div><div class="card-title">阶段记录</div></div><div class="details-tools">${btn('export-csv',icon('download')+' CSV','btn btn-sm')}${btn('export-json',icon('file')+' JSON','btn btn-sm')}</div></div>
  <div class="data-table-wrap"><table class="data-table"><thead><tr><th>级</th><th>目标功率</th><th>时长</th><th>乳酸 mmol/L</th><th>心率 bpm</th><th>RPE</th><th>样本质量</th><th>备注</th><th>记录</th></tr></thead><tbody id="record-rows">${sessionRows(s)}</tbody></table></div>
 </div>`;
}
function renderDevices(s){
 const reason=D.describeSupport();
 return `<div class="card card-pad section-space device-panel"><div class="details"><div class="card-title">设备与活动记录</div>${btn('export-fit',icon('download')+' 导出 FIT','btn btn-sm',s.recording?'':'disabled')}</div><div class="device-grid">${Object.entries(D.specs).map(([kind,spec])=>`<div class="device-slot"><span>${esc(spec.label)}</span><strong id="device-${kind}-name"></strong><small id="device-${kind}-status"></small><button class="btn btn-sm" data-action="connect-device" data-kind="${kind}" id="device-${kind}-button" ${reason?'disabled':''}>连接</button></div>`).join('')}</div><div class="erg-status" data-erg-status aria-live="polite"></div><div class="sensor-values">${[['power','实际功率','W'],['hr','实时心率','bpm'],['cadence','踏频','rpm'],['speed','骑行台速度','km/h'],['distance','活动距离','km'],['grade','模拟坡度','%']].map(([key,label,unit])=>`<div><span>${label}</span><strong id="sensor-${key}">—</strong><small>${unit}</small></div>`).join('')}</div><div class="recording-note" id="recording-note"></div>${reason?`<p class="device-warning" role="status">${esc(reason)}</p>`:''}</div>`;
}
function renderHrv(s){
 return `<div class="card card-pad section-space" id="hrv-card"><div class="details"><div class="card-title">HRV · DFA α1</div><div class="details-tools">${btn('export-hrv',icon('download')+' HRV CSV','btn btn-sm',s.recording?.hrv?.estimates.length?'':'disabled')}${btn('export-rr','RR CSV','btn btn-sm',s.recording?.hrv?.packets.length?'':'disabled')}</div></div><div class="hrv-reading"><strong id="hrv-alpha">—</strong><span id="hrv-status" role="status"></span></div><div class="chart-surface" id="hrv-chart"></div><p class="hrv-note">需要心率带提供 RR · 2 分钟窗口 · 每 5 秒更新</p></div>`;
}
function paintHrv(s){
 if(!s||!$('#hrv-card'))return;
 const result=H.readCurrent(s),value=fmt(result.alpha1,2);
 $('#hrv-alpha').textContent=value;
 $('#hrv-status').textContent=(s.execution.status==='running'?'':s.recording?.hrv?'已保存 · ':'')+H.describeStatus(result);
 const live=$('[data-live-sensor="alpha1"]');if(live)live.textContent=s.execution.status==='running'?value:'—';
 const estimates=s.recording?.hrv?.estimates||[],chart=$('#hrv-chart');
 const compact=chart.clientWidth<480,key=estimates.length+'-'+compact;
 if(chart.dataset.key!==key){chart.innerHTML=Charts.renderHrv(estimates,s.recording?.startedAt,compact);chart.dataset.key=key}
 $('[data-action="export-hrv"]').disabled=!estimates.length;
 $('[data-action="export-rr"]').disabled=!s.recording?.hrv?.packets.length;
}
function paintDevices(){
 if(!$('#recording-note'))return;
 for(const [kind,slot] of Object.entries(D.slots)){
  $(`#device-${kind}-name`).textContent=slot.name||'尚未选择设备';
  $(`#device-${kind}-status`).textContent=slot.status==='connected'?'已连接':slot.status==='connecting'?'正在连接…':'未连接';
  const button=$(`#device-${kind}-button`);button.textContent=slot.status==='connected'?'断开':slot.status==='connecting'?'连接中…':slot.name?'重新连接':'连接';button.disabled=slot.status==='connecting'||!!D.describeSupport();button.dataset.action=slot.status==='connected'?'disconnect-device':'connect-device';
 }
 const values=D.readSnapshot();for(const key of ['power','hr','cadence']){const text=values[key]===null?'—':fmt(values[key]);$(`#sensor-${key}`).textContent=text;const live=$(`[data-live-sensor="${key}"]`);if(live)live.textContent=text}
 const s=active(),r=s?.recording;paintHrv(s);
 const distance=r?.records.findLast(x=>Number.isFinite(x.distance))?.distance??null;
 for(const [key,value,digits] of [['speed',values.speed===null?null:values.speed*3.6,1],['distance',distance===null?null:distance/1000,2],['grade',values.grade,2]])$(`#sensor-${key}`).textContent=value===null?'—':fmt(value,digits);
 $('#recording-note').textContent=r?`${s.execution.status==='running'?'记录中':s.execution.status==='done'?'记录完成':'记录暂停'} · ${r.records.length.toLocaleString()} 条`:'';
 const trainer=D.slots.trainer,erg=trainer.erg?.state;
 const message=erg?.error||trainer.error||(trainer.status==='connecting'?'ERG 连接中…':erg?.phase==='running'?`ERG · ${erg.power} W`:erg?.phase==='setting'?erg.desiredPower===null?'ERG 设置中…':`ERG 设置 ${erg.desiredPower} W…`:erg?.phase==='paused'?'ERG 已暂停':erg?.phase==='stopped'?'ERG 已停止':erg?.phase==='ready'?'ERG 就绪':'');
 document.querySelectorAll('[data-erg-status]').forEach(node=>{if(node.textContent!==message)node.textContent=message;node.classList.toggle('has-error',!!(erg?.error||trainer.error))});
}
function validateErgProtocol(s){
 const trainer=D.slots.trainer;if(trainer.status!=='connected'||!trainer.erg)return;
 if(trainer.erg.state.requiresReconnect)throw Error('ERG 控制响应超时，请在设备端停止负载后断开并重新连接');
 s.stages.slice(s.execution.stageIndex).forEach(stage=>{if(s.type==='custom-workflow'){W.resolveDevicePower(trainer.erg.state.range,stage.power);W.resolveDevicePower(trainer.erg.state.range,stage.endPower)}else Lab.erg.validatePower(trainer.erg.state.range,stage.power)});
}
function syncErgControl(retry=false){
 const trainer=D.slots.trainer,s=active();if(trainer.status!=='connected'||!trainer.erg){if(s?.execution.status==='running')controlledSessionId=null;return}
 try{
  if(s?.execution.status==='running'){
   validateErgProtocol(s);controlledSessionId=s.id;
   trainer.erg.setDesired(s.execution.phase==='sampling'?'paused':'running',s.execution.phase==='sampling'?null:s.type==='custom-workflow'?W.resolveDevicePower(trainer.erg.state.range,resolveLivePower(s)):resolveLivePower(s),retry&&!!trainer.erg.state.error);
  }else if(controlledSessionId)trainer.erg.setDesired(!s||s.id!==controlledSessionId||s.execution.status==='done'?'stopped':'paused');
 }catch(error){if(s?.execution.status==='running')pause();toast(error.message)}
}
function handleDeviceChange(){
 const trainer=D.slots.trainer,s=active();
 const newlyConnected=trainer.status==='connected'&&lastTrainerStatus!=='connected';lastTrainerStatus=trainer.status;
 if(s?.execution.status==='running'&&controlledSessionId===s.id&&(trainer.status==='disconnected'||trainer.erg?.state.error)){
  const reason=trainer.erg?.state.error||trainer.error||'ERG 骑行台连接已断开，请在设备端确认负载已停止';
  pause();toast(reason+'；测试已暂停');
 }else if(newlyConnected)syncErgControl();
 if(trainer.status==='disconnected')controlledSessionId=null;
 paintDevices();
}
function captureActivity(now=Date.now()){
 const s=active();if(!s||s.execution.status!=='running')return;
 if(!s.recording)R.beginRecording(s,now);
 H.captureEstimate(s,now);
 R.captureRecord(s,{...D.readSnapshot(now),...(s.type==='custom-workflow'?{confirmedTargetPower:D.slots.trainer.erg?.state.phase==='running'?D.slots.trainer.erg.state.power:null}:{})},now);
 if(now-lastRecordingSave>=5000){persist(s);lastRecordingSave=now}
 paintDevices();
}
function pauseActive(){if(active()?.execution.status==='running')pause()}
function renderScatter(s){
 return `<div class="card card-pad"><div class="card-heading"><div class="card-title">数据散点图</div><div class="scatter-controls" aria-label="散点图数据">${[['lactate','乳酸'],['hr','心率'],['rpe','RPE']].map(([metric,label])=>btn('scatter-metric',label,`btn btn-sm ${metric===scatterMetric?'btn-soft':''}`,`data-metric="${metric}" aria-pressed="${metric===scatterMetric}"`)).join('')}</div></div><div class="chart-surface" id="scatter-chart">${Charts.renderScatter(s.stages,scatterMetric,s.type==='custom-workflow')}</div><div class="chart-legend"><span><i class="legend-dot" style="background:#178a72"></i>正常</span><span><i class="legend-dot" style="background:#dc9053"></i>可疑</span><span><i class="legend-dot" style="background:#94a2a7"></i>标记排除</span></div></div>`;
}
function renderWorkbench(){
 const s=active();
 const head=heading('测试工作台',s?btn('edit',icon('edit')+' 测试信息','btn btn-sm'):'');
 if(!s)return head+C.emptyState('暂无测试','','droplet',btn('new',icon('plus')+' 新建测试','btn btn-primary'));
 return head+(s.type==='custom-workflow'?`<div class="card card-pad workflow-profile-card"><div class="card-title">计划功率 · ${W.formatDuration(s.stages.reduce((sum,x)=>sum+x.durationSec,0))}</div><div class="workflow-profile">${W.renderProfile(s.stages,0)}</div></div>`:'')+`<div class="grid-main"><div>${renderLive(s)}</div><div id="scatter-card">${renderScatter(s)}</div></div>`+renderDevices(s)+renderHrv(s)+recordTable(s);
}
function renderHistory(){
 const filtered=db.sessions.filter(s=>s.name.toLowerCase().includes(search.toLowerCase())||s.type.includes(search.toLowerCase()));
 return `${heading('历史记录',btn('import',icon('upload')+' 导入 JSON','btn btn-sm'))}
  ${db.sessions.length?`<div class="history-toolbar"><input class="form-control" id="history-search" type="search" aria-label="搜索测试名称" placeholder="搜索测试名称" value="${esc(search)}"></div><div class="history-list" id="history-list">${renderHistoryItems(filtered)}</div>`:
  C.emptyState('暂无历史记录','','history',btn('new',icon('plus')+' 创建测试','btn btn-primary'))}`;
}
function renderHistoryItems(items){
 if(!items.length)return `<div class="card empty"><h3>没有匹配记录</h3></div>`;
 return [...items].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(s=>{
  const recorded=s.stages.filter(stage=>C.n(stage.lactate)!==null).length;
  return `<div class="history-item"><div class="history-icon">${icon(T.byId(s.type)?.icon||'activity')}</div><div class="history-main"><strong>${esc(s.name)}</strong><p>${dateText(s.createdAt)}${s.athlete?'　·　'+esc(s.athlete.name)+' · FTP '+s.athlete.ftp+' W':''}</p><div class="history-meta"><span>${tag(s.execution.status)}</span><span>${recorded}/${s.type==='custom-workflow'?s.stages.filter(st=>st.sampling||st.lactate!==null).length:s.stages.length} ${s.type==='custom-workflow'?'次采样':'级'}已录入乳酸</span><span class="code-pill">${s.type==='custom-workflow'?'自定义流程 · '+W.formatDuration(s.stages.reduce((sum,x)=>sum+x.durationSec,0)):s.protocol.startPower+'W / +'+s.protocol.increment+'W / '+s.protocol.stageMinutes+'min'}</span></div></div><div class="history-actions">${btn('open-session','打开','btn btn-sm','data-id="'+esc(s.id)+'"')}${btn('duplicate',icon('copy'),'btn btn-sm btn-icon','title="复制协议" data-id="'+esc(s.id)+'"')}${btn('export-fit',icon('download')+' FIT','btn btn-sm',`data-id="${esc(s.id)}" ${s.recording?'':'disabled'}`)}${btn('export-csv','CSV','btn btn-sm',`data-id="${esc(s.id)}"`)}${btn('export-json','JSON','btn btn-sm','title="导出 JSON" data-id="'+esc(s.id)+'"')}${btn('delete',icon('trash'),'btn btn-sm btn-icon','title="删除记录" data-id="'+esc(s.id)+'"')}</div></div>`;
 }).join('');
}

function render(){
 const focused=document.activeElement,held=active()?.type==='custom-workflow'&&focused?.closest('#live-sample-entry')?{node:focused.closest('.sample-entry'),input:focused,index:focused.dataset.index}:null;
 renderSidebar();renderTopbar();
 const root=$('#content');
 root.innerHTML=view==='history'?renderHistory():renderWorkbench();
 syncErgControl();paintLive();paintDevices();paintStorage();
 if(held&&String(active()?.execution.sampleEntryIndex)===held.index){const entry=$('#live-sample-entry');if(entry){entry.replaceChildren(held.node);held.input.focus({preventScroll:true})}}
}
function newModal(){
 const a=T.readAthlete(db.athlete)||T.readAthlete(active()?.athlete)||{name:'',sex:'',age:'',ftp:''};
 preset='fine';goal='fine';
 $('#modal-root').innerHTML=`<div class="modal-layer" data-dismiss="modal"><div class="modal protocol-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
 <div class="modal-head"><div><div class="modal-step" id="new-step-label">1 / 2 · 个人资料</div><h2 id="modal-title">新建乳酸阶梯测试</h2></div>${btn('close-modal',icon('x'),'btn btn-icon btn-ghost','aria-label="关闭"')}</div>
 <form id="new-form"><div class="modal-body"><div class="mode-options"><button type="button" class="btn btn-soft" aria-pressed="true">乳酸阶梯</button><button type="button" class="btn" data-action="new-workflow">自定义流程</button></div>
 <fieldset id="athlete-step" class="form-section"><div class="form-grid">
  <div class="form-group"><label for="athlete-name">姓名</label><input class="form-control" id="athlete-name" name="athleteName" autocomplete="name" maxlength="100" value="${esc(a.name)}" required></div>
  <div class="form-group"><label for="athlete-sex">性别</label><select class="form-control" id="athlete-sex" name="athleteSex" required><option value="">请选择</option>${[['male','男'],['female','女'],['undisclosed','不透露']].map(([value,label])=>`<option value="${value}" ${a.sex===value?'selected':''}>${label}</option>`).join('')}</select></div>
  <div class="form-group"><label for="athlete-age">年龄 / 岁</label><input class="form-control" id="athlete-age" name="athleteAge" type="number" min="1" max="120" step="1" value="${a.age}" required></div>
  <div class="form-group"><label for="athlete-ftp">预估 FTP / W</label><input class="form-control" id="athlete-ftp" name="athleteFtp" type="number" min="20" max="1200" step="1" value="${a.ftp}" required></div>
 </div></fieldset>
 <fieldset id="protocol-step" class="form-section" hidden disabled>
 <div class="athlete-summary" id="new-athlete-summary"></div>
 <h3 class="form-section-title">阶梯方案</h3>
 <div class="preset-row goal-options">${T.goals.map(g=>`<button type="button" data-action="goal" data-goal="${g.id}" aria-pressed="${g.id===goal}" class="preset ${g.id===goal?'selected':''}"><strong>${esc(g.name)}</strong><span>${g.minIncrement}–${g.maxIncrement} W / ${g.stageMinutes} min / ${g.stageCount} 级</span></button>`).join('')}</div>
 <div class="form-grid">
  <div class="form-group span2"><label for="test-name">测试名称</label><input class="form-control" id="test-name" name="name" value="乳酸阶梯测试 · ${new Date().toLocaleDateString('zh-CN')}" maxlength="100" required></div>
  <div class="form-group"><label for="start-power">起始功率 / W</label><input class="form-control" id="start-power" name="startPower" type="number" min="20" max="600" step="1" required></div>
  <div class="form-group"><label for="increment">每级递增 / W</label><input class="form-control" id="increment" name="increment" type="number" min="5" max="100" step="1" required></div>
  <div class="form-group"><label for="stage-minutes">每级时长 / min</label><input class="form-control" id="stage-minutes" name="stageMinutes" type="number" min="2" max="15" step="1" required></div>
  <div class="form-group"><label for="stage-count">阶梯数量</label><input class="form-control" id="stage-count" name="stageCount" type="number" min="3" max="25" step="1" required></div>
 </div>
 <div class="protocol-totals"><div><span>计划最高功率</span><strong id="new-max-power">—</strong></div><div><span>阶梯总时间</span><strong id="new-total-time">—</strong></div></div>
 <div class="form-grid sampling-options">
  <div class="form-group"><label for="sampling-mode">采样模式</label><select class="form-control" id="sampling-mode" name="samplingMode"><option value="assisted">有人协助 · 连续骑行</option><option value="solo">单人操作 · 间断采样</option></select></div>
  <div class="form-group"><label for="sample-site">采血部位</label><select class="form-control" id="sample-site" name="sampleSite"><option value="earlobe">耳垂</option><option value="fingertip">指尖</option></select></div>
  <div class="form-group" id="sample-pause-group" hidden><label for="sample-pause">单人采样间隔 / sec</label><input class="form-control" id="sample-pause" name="samplePauseSec" type="number" min="15" max="120" value="45" required disabled></div>
  <div class="form-group"><label>声音</label><label class="toggle" style="margin-top:8px"><input name="beep" type="checkbox" checked> 切段与采样声音提醒</label></div>
 </div></fieldset><p class="form-error" id="new-error" role="alert"></p>
 </div><div class="modal-foot"><div class="modal-back">${btn('back-profile',icon('arrow-left')+' 个人资料','btn btn-ghost','type="button" hidden')}</div>${btn('close-modal','取消','btn','type="button"')}${btn('next-protocol','下一步 '+icon('arrow'),'btn btn-primary','type="button"')}${btn('create-test',icon('plus')+' 创建测试','btn btn-primary','type="submit" hidden')}</div></form></div></div>`;
 $('#athlete-name').focus();
}
function formAthlete(){
 const f=$('#new-form');return T.validAthlete({name:f.elements.athleteName.value,sex:f.elements.athleteSex.value,age:f.elements.athleteAge.value,ftp:f.elements.athleteFtp.value});
}
function selectGoal(id){
 const f=$('#new-form');if(!f)return;
 const a=formAthlete(),parameters=T.generate(a.ftp,id);goal=id;preset=id;
 for(const key of ['startPower','increment','stageMinutes','stageCount'])f.elements[key].value=parameters[key];
 document.querySelectorAll('[data-action="goal"]').forEach(el=>{const selected=el.dataset.goal===goal;el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected))});
 updateNewSummary();
}
function protocolStep(){
 const f=$('#new-form');if(!f||!f.reportValidity())return;
 try{
  const a=formAthlete();
  if(f.dataset.generatedFtp!==String(a.ftp)){selectGoal(goal);f.dataset.generatedFtp=String(a.ftp)}
  $('#new-athlete-summary').textContent=athleteText(a);
  $('#athlete-step').hidden=true;$('#protocol-step').hidden=false;$('#protocol-step').disabled=false;
  $('#new-step-label').textContent='2 / 2 · 测试参数';
  f.querySelector('[data-action="next-protocol"]').hidden=true;
  f.querySelector('[data-action="create-test"]').hidden=false;
  f.querySelector('[data-action="back-profile"]').hidden=false;
  $('#new-error').textContent='';$('.protocol-modal').scrollTop=0;
 }catch(err){$('#new-error').textContent=err.message}
}
function profileStep(){
 const f=$('#new-form');if(!f)return;
 $('#athlete-step').hidden=false;$('#protocol-step').hidden=true;$('#protocol-step').disabled=true;
 $('#new-step-label').textContent='1 / 2 · 个人资料';
 f.querySelector('[data-action="next-protocol"]').hidden=false;
 f.querySelector('[data-action="create-test"]').hidden=true;
 f.querySelector('[data-action="back-profile"]').hidden=true;
 $('#new-error').textContent='';$('.protocol-modal').scrollTop=0;$('#athlete-name').focus();
}
function editModal(){const s=active();if(!s)return;
 $('#modal-root').innerHTML=`<div class="modal-layer" data-dismiss="modal"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">测试信息</h2></div>${btn('close-modal',icon('x'),'btn btn-icon btn-ghost','aria-label="关闭"')}</div><div class="modal-body">${athleteLine(s)}<div class="form-grid"><div class="form-group span2"><label>测试名称</label><input class="form-control" id="edit-name" maxlength="100" value="${esc(s.name)}"></div><div class="form-group"><label>测试设备 / 功率计</label><input class="form-control" id="edit-device" maxlength="120" value="${esc(s.metadata?.device||'')}"></div><div class="form-group"><label>环境温度、散热等</label><input class="form-control" id="edit-environment" maxlength="120" value="${esc(s.metadata?.environment||'')}"></div><div class="form-group span2"><label>辅助人员（可选）</label><input class="form-control" id="edit-operator" maxlength="120" value="${esc(s.metadata?.operator||'')}"></div><div class="form-group span2"><label>备注</label><textarea class="form-control" id="edit-notes" rows="3" maxlength="1500">${esc(s.metadata?.notes||'')}</textarea></div></div></div><div class="modal-foot">${btn('close-modal','取消','btn')}${btn('save-edit',icon('check')+' 保存信息','btn btn-primary')}</div></div></div>`;
}
function openSampleModal(index){const s=active();if(!s||!Number.isInteger(index)||!s.stages[index])return;const st=s.stages[index];
 $('#modal-root').innerHTML=`<div class="modal-layer" data-dismiss="modal"><div class="modal sample-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${esc(describeStage(s,index))} · ${esc(W.formatTarget(st))}</h2>${btn('close-modal',icon('x'),'btn btn-icon btn-ghost','aria-label="关闭"')}</div><div class="modal-body">${s.type==='custom-workflow'&&!st.sampleAt?'<p class="workflow-help">事后补录保留所属分段和录入时间；未知采样时刻留空。</p>':''}${renderSampleFields(s,index,'edit-sample')}<details class="sample-extras"><summary>其他记录</summary><div class="form-grid"><div class="form-group"><label for="sample-hr">心率 bpm</label><input id="sample-hr" class="form-control" data-index="${index}" data-field="hr" type="number" min="30" max="240" step="1" value="${esc(st.hr??'')}"></div><div class="form-group"><label for="sample-quality">样本质量</label><select id="sample-quality" class="form-control" data-index="${index}" data-field="quality">${[['normal','正常'],['suspect','可疑'],['exclude','排除']].map(([value,label])=>`<option value="${value}" ${st.quality===value?'selected':''}>${label}</option>`).join('')}</select></div><div class="form-group span2"><label for="sample-notes">备注</label><input id="sample-notes" class="form-control" data-index="${index}" data-field="notes" maxlength="200" value="${esc(st.notes||'')}"></div></div></details></div><div class="modal-foot">${btn('close-modal','完成','btn btn-primary')}</div></div></div>`;
 $('#edit-sample-lactate').focus();
}
function closeModal(){$('#modal-root').innerHTML=''}
function updateNewSummary(){
 const f=$('#new-form');if(!f)return;
 const st=Number(f.elements.startPower.value),inc=Number(f.elements.increment.value),cnt=Number(f.elements.stageCount.value),mins=Number(f.elements.stageMinutes.value);
 const valid=['startPower','increment','stageCount','stageMinutes'].every(key=>f.elements[key].value!==''&&f.elements[key].validity.valid);
 $('#new-max-power').textContent=valid?`${st+(cnt-1)*inc} W`:'—';
 $('#new-total-time').textContent=valid?`${cnt*mins} min`:'—';
}
function start(skipResting=false){const s=active();if(!s)return;let e=s.execution;
 if(e.status==='done')return toast('测试已结束，无法继续计时');
 if(e.status==='ready'){nextStage();return}
 if(e.status==='running')return;
 try{validateErgProtocol(s)}catch(error){toast(error.message);return}
 if(e.status==='idle'){
  if(skipResting)s.restingSample={lactate:null,recordedAt:null,skipped:true};
  else{const input=$('#resting-lactate');if(!input||!saveRestingSample(input,true))return}
  e.stageIndex=0;e.phase='effort';e.elapsedMs=0;
 }
 sampleTickSeconds.set(s.stages[e.stageIndex],Math.floor(e.elapsedMs/1000));
 if(s.protocol.beep)prepareSound();
 e.status='running';e.startedAt=Date.now();R.beginRecording(s,e.startedAt);syncErgControl(true);captureActivity(e.startedAt);persist(s);render();if(s.protocol.beep)beep();}
function saveRestingSample(input,required=false){const s=active();if(!s||s.execution.status!=='idle')return false;
 input.setCustomValidity('');
 if(required&&input.value===''&&!input.validity.badInput)input.setCustomValidity('请填写静息乳酸值，或选择跳过并开始');
 else if(!input.validity.valid)input.setCustomValidity('请输入 0.2–30 之间的数值，保留一位小数');
 showSampleError(input);
 if(!input.validity.valid){if(required){input.reportValidity();input.focus()}return false}
 s.restingSample=input.value===''?null:{lactate:Number(input.value),recordedAt:new Date().toISOString(),skipped:false};persist(s);return true;
}
function pause(){const s=active();if(!s)return;const e=s.execution;if(e.status!=='running')return;captureActivity();e.elapsedMs=elapsedNow(e);e.startedAt=null;e.status='paused';R.stopRecording(s);syncErgControl();persist(s);render()}
function finish(){const s=active();if(!s)return;if(s.execution.status==='done')return;
 if(s.execution.status!=='idle'&&!window.confirm('结束测试？结束后无法继续计时。'))return;
 captureActivity();const e=s.execution;e.status='done';e.finishedAt=new Date().toISOString();e.elapsedMs=0;e.startedAt=null;R.stopRecording(s,Date.now(),true);syncErgControl();persist(s);render()}
function nextStage(){const s=active();if(!s)return;const e=s.execution;
 if(s.type==='custom-workflow'){s.stages[e.stageIndex].skipped=elapsedNow(e)<phaseDuration(s);s.stages[e.stageIndex].sampleNotice=3}
 if(e.stageIndex>=s.stages.length-1){captureActivity();e.status='done';e.finishedAt=new Date().toISOString();e.startedAt=null;e.elapsedMs=0;R.stopRecording(s,Date.now(),true);syncErgControl();persist(s);render();return}
 e.stageIndex++;e.phase='effort';e.elapsedMs=0;e.startedAt=Date.now();e.status='running';sampleTickSeconds.set(s.stages[e.stageIndex],0);R.beginRecording(s,e.startedAt);R.syncStage(s,e.startedAt);syncErgControl();captureActivity();persist(s);render();if(s.protocol.beep){prepareSound();beep()}}
function prepareSound(){
 try{
  const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return;
  if(!soundContext||soundContext.state==='closed')soundContext=new AudioCtx();
  if(soundContext.state==='suspended')soundContext.resume().catch(()=>{});
 }catch{/* Sound is optional; timing and recording continue without audio support. */}
}
function beep(tick=false){
 try{
  const ctx=soundContext;if(!ctx||ctx.state==='suspended'||ctx.state==='closed')return;
  const o=ctx.createOscillator(),g=ctx.createGain(),now=ctx.currentTime;
  o.type='sine';o.frequency.value=tick?1200:784;
  g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(tick ? .07 : .12,now+(tick ? .004 : .02));
  g.gain.exponentialRampToValueAtTime(.0001,now+(tick ? .05 : .23));
  o.connect(g);g.connect(ctx.destination);o.onended=()=>{o.disconnect();g.disconnect()};
  o.start();o.stop(now+(tick ? .06 : .25));
 }catch{}
}
function updateExecution(){const s=active();if(!s||s.execution.status!=='running')return;updateSampleNotices(s);
 const e=s.execution;let transitions=0;
 while(e.status==='running'&&elapsedNow(e)>=phaseDuration(s)&&transitions<s.stages.length*2){
  transitions++;
  if(s.type==='custom-workflow')s.stages[e.stageIndex].sampleNotice=3;
  const stageIndex=e.stageIndex,duration=phaseDuration(s);
  const phaseOverrun=elapsedNow(e)-duration;
  if(e.phase==='effort'&&s.protocol.samplingMode==='solo'){
    e.phase='sampling';e.elapsedMs=Math.max(0,phaseOverrun);e.startedAt=Date.now();if(s.protocol.beep&&(s.type!=='custom-workflow'||phaseOverrun<phaseDuration(s)))beep();
  }else if(e.stageIndex<s.stages.length-1){
    e.stageIndex++;e.phase='effort';e.elapsedMs=Math.max(0,phaseOverrun);e.startedAt=Date.now();if(s.protocol.beep&&(s.type!=='custom-workflow'||phaseOverrun<phaseDuration(s))){sampleTickSeconds.set(s.stages[e.stageIndex],Math.floor(e.elapsedMs/1000));beep()}
  }else{
    e.status='done';e.startedAt=null;e.finishedAt=new Date().toISOString();e.elapsedMs=duration;
  }
  const boundary=Date.now()-phaseOverrun;
  if(e.status==='done'){e.finishedAt=new Date(boundary).toISOString();R.stopRecording(s,boundary,true)}else R.syncStage(s,boundary);
  persist(s);if(s.type!=='custom-workflow'){if(e.stageIndex!==stageIndex||e.status==='done')render();else paintLive();}
 }
 if(e.status==='running')updateSampleNotices(s);
 if(transitions&&s.type==='custom-workflow')render();
 syncErgControl();
}
function paintLive(){const s=active(),timer=$('#live-time');if(!s||!timer||view!=='workbench')return;
 const e=s.execution,st=s.stages[e.stageIndex];if(!st)return;
 const elapsed=Math.min(phaseDuration(s),elapsedNow(e));const remain=phaseDuration(s)-elapsed;
 timer.textContent=fmtTime(e.status==='idle'?phaseDuration(s):e.status==='done'?0:remain);
 const progress=$('#live-progress');if(progress)progress.style.width=(e.status==='done'?100:Math.min(100,Math.max(0,elapsed/phaseDuration(s)*100)))+'%';
 const title=$('#live-phase-label');if(title)title.textContent=e.phase==='sampling'?'采样间隔剩余':'当前阶段剩余';
 if(s.type==='custom-workflow'){
  $('#live-power').innerHTML=`${resolveLivePower(s)}<small>W</small>`;
  const sampling=$('#workflow-sampling'),state=W.readSamplingState(st,elapsed),until=st.sampling?Math.max(0,(st.durationSec-st.sampling.windowSec)*1000-elapsed):0;
  if(sampling){const message=e.status==='done'?'流程已完成':state==='window'?'采样窗口 · 本段结束后自动继续':state==='prepare'?`准备采样 · ${fmtTime(until)} 后开始`:st.sampling?`距采样 ${fmtTime(until)}`:'本段无需采样';if(sampling.textContent!==message)sampling.textContent=message}
  const marker=$('#workflow-position'),total=s.stages.reduce((sum,x)=>sum+x.durationSec,0),position=s.stages.slice(0,e.stageIndex).reduce((sum,x)=>sum+x.durationSec,0)+elapsed/1000;
  if(marker){const x=36+(e.status==='done'?total:position)/total*648;marker.setAttribute('x1',x);marker.setAttribute('x2',x)}
 }
 const entry=$('#live-sample-entry');if(entry){
  const visible=shouldShowSampleEntry(s);
  if(visible&&(!entry.firstElementChild||s.type==='custom-workflow'&&Number(entry.firstElementChild.dataset.stage)!==e.sampleEntryIndex))entry.innerHTML=renderSampleEntry(s);
  else if(!visible&&entry.firstElementChild)entry.innerHTML='';
 }
}
function checkSampleField(target){const s=active();if(!s)return;const index=Number(target.dataset.index),field=target.dataset.field;
 if(!Number.isInteger(index)||index<0||index>=s.stages.length||!['lactate','hr','rpe','notes','quality'].includes(field))return;
 const stage=s.stages[index];const raw=target.value;
 if(['lactate','hr','rpe'].includes(field)){
   let nv=raw===''?null:Number(raw);
   const bounds={lactate:[.2,30],hr:[30,240],rpe:[0,10]}[field];
   target.setCustomValidity('');
   if(target.validity.badInput||target.validity.stepMismatch||(nv!==null&&(!Number.isFinite(nv)||nv<bounds[0]||nv>bounds[1]))){target.setCustomValidity(`请输入 ${bounds[0]}–${bounds[1]} 之间的数值${field==='rpe'?'，以 0.5 递增':field==='lactate'?'，保留一位小数':''}`);showSampleError(target);return}
   showSampleError(target);stage[field]=nv;
   if(['lactate','rpe'].includes(field)&&nv!==null){if(!stage.recordedAt)stage.recordedAt=new Date().toISOString();if(!stage.sampleAt&&s.execution.stageIndex===index&&['running','paused'].includes(s.execution.status))stage.sampleAt=Date.now()}
 }else if(field==='notes')stage.notes=raw.slice(0,200);
 else stage.quality=['normal','suspect','exclude'].includes(raw)?raw:'normal';
 persist(s);
 document.querySelectorAll(`[data-index="${index}"][data-field="${field}"]`).forEach(peer=>{if(peer!==target){peer.value=raw;peer.setCustomValidity('');showSampleError(peer)}});
 refreshDataDisplay(target);
}
function showSampleError(target){target.setAttribute('aria-invalid',String(!!target.validationMessage));const error=document.getElementById(target.id+'-error');if(error)error.textContent=target.validationMessage}
function duplicate(source){const s=source||active();if(!s)return;pauseActive();
 if(s.type==='custom-workflow'){Lab.workflowUi.renderEditor({athlete:T.readAthlete(db.athlete)||s.athlete,source:s});return}
 const input=T.validInput({...s.protocol,athlete:s.athlete,name:s.name+'（副本）'});
 const copy=T.newSession(input);copy.metadata={...s.metadata,notes:''};db.sessions.push(copy);db.activeId=copy.id;view='workbench';persist();render()}
function exportedSession(s){const copy={id:s.id,type:s.type,schemaVersion:s.schemaVersion,name:s.name,createdAt:s.createdAt,updatedAt:s.updatedAt,athlete:s.athlete,protocol:{...s.protocol,goal:T.readGoalId(s.protocol.goal),preset:T.readGoalId(s.protocol.preset)||s.protocol.preset},metadata:s.metadata,restingSample:s.restingSample??null,stages:s.stages,execution:{...s.execution},recording:s.recording??null};
 if(s.execution.status==='running'){
  copy.execution={...s.execution,status:'paused',elapsedMs:elapsedNow(s.execution),startedAt:null};
  if(s.recording){copy.recording={...s.recording,spans:s.recording.spans.map(span=>({...span}))};R.stopRecording(copy)}
 }
 return copy}
function downloadJson(s){if(!s)return toast('请先创建测试');C.download(JSON.stringify({schemaVersion:1,exportType:'session',exportedAt:new Date().toISOString(),session:exportedSession(s)},null,2),`PaceLab_${safeFile(s.name)}.json`,'application/json;charset=utf-8')}
function downloadBackup(){
 if(!db.sessions.length)return toast('暂无可备份的测试');
 const now=new Date(),stamp=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
 const backup={schemaVersion:1,exportType:'backup',exportedAt:now.toISOString(),athlete:db.athlete??null,sessions:db.sessions.map(exportedSession)};
 C.download(JSON.stringify(backup),`PaceLab_全部测试_${stamp}.json`,'application/json;charset=utf-8');
}
function downloadFit(s){if(!s)return;try{C.download(Lab.fit.encodeSession(s),`PaceLab_${safeFile(s.name)}.fit`,'application/octet-stream')}catch(error){toast(error.message)}}
function safeFile(s){return String(s).replace(/[\\/:*?"<>|\n\r]/g,'_').slice(0,70)||'测试'}
function importSessions(data){
 const raw=data?.exportType==='backup'?data.sessions:data?.exportType==='session'?[data.session]:null;
 if(data?.schemaVersion!==1||!Array.isArray(raw))throw Error('无法识别的文件格式或数据版本');
 const additions=[],names=new Set(db.sessions.map(s=>s.name));
 for(const [position,old] of raw.entries()){
  if(!['lactate-step','custom-workflow'].includes(old?.type)||!Array.isArray(old.stages)||(old.type==='lactate-step'?(old.stages.length<3||old.stages.length>25):(old.schemaVersion!==2||old.protocol?.version!==1||old.stages.length<1||old.stages.length>500)))throw Error(`第 ${position+1} 次测试格式无效，未导入任何记录`);
  let v;try{v=old.type==='custom-workflow'?{name:String(old.name||'自定义流程'),athlete:T.validAthlete(old.athlete)}:T.validInput({...old.protocol,athlete:T.readAthlete(old.athlete),stageCount:old.stages.length,name:String(old.name||'导入测试'),samplingMode:old.protocol?.samplingMode||'assisted'})}catch(error){throw Error(`第 ${position+1} 次测试：${error.message}，未导入任何记录`)}
  const s=old.type==='custom-workflow'?W.createSession({...v,stages:old.stages,beep:old.protocol.beep}):T.newSession(v);s.id=uid();s.createdAt=Number.isFinite(Date.parse(old.createdAt))?old.createdAt:new Date().toISOString();
  s.name=v.name+(names.has(v.name)?'（导入）':'');names.add(s.name);
  s.metadata={notes:String(old.metadata?.notes||'').slice(0,1500),device:String(old.metadata?.device||'').slice(0,120),environment:String(old.metadata?.environment||'').slice(0,120),operator:String(old.metadata?.operator||'').slice(0,120)};
  const resting=old.restingSample,lactate=C.n(resting?.lactate);
  if(resting?.skipped===true)s.restingSample={lactate:null,recordedAt:null,skipped:true};
  else if(lactate!==null&&lactate>=.2&&lactate<=30)s.restingSample={lactate,recordedAt:Number.isFinite(Date.parse(resting.recordedAt))?resting.recordedAt:null,skipped:false};
  s.stages.forEach((stage,i)=>{const original=old.stages[i]||{};
    const pow=Number(original.power);if(s.type!=='custom-workflow'&&Number.isFinite(pow)&&pow>=20&&pow<=1200)stage.power=pow;
    stage.sampleNotice=C.clamp(Math.trunc(Number(original.sampleNotice)||0),0,3);
    if(s.type==='custom-workflow')stage.skipped=original.skipped===true;
    for(const [key,min,max] of [['lactate',.2,30],['hr',30,240],['rpe',0,10]]){const z=original[key];const x=Number(z);stage[key]=z===null||z===''||z===undefined||!Number.isFinite(x)||x<min||x>max?null:x}
    stage.quality=['normal','suspect','exclude'].includes(original.quality)?original.quality:'normal';
    stage.notes=String(original.notes||'').slice(0,200);stage.recordedAt=Number.isFinite(Date.parse(original.recordedAt||original.sampleAt))?(original.recordedAt||original.sampleAt):null;
    stage.sampleAt=Number.isFinite(original.sampleAt)?original.sampleAt:null;
  });
  const e=old.execution||{};
  s.execution={stageIndex:C.clamp(Math.trunc(Number(e.stageIndex)||0),0,s.stages.length-1),phase:s.type!=='custom-workflow'&&e.phase==='sampling'?'sampling':'effort',status:e.status==='done'?'done':e.status==='idle'?'idle':'paused',elapsedMs:C.clamp(Number(e.elapsedMs)||0,0,s.type==='custom-workflow'?86400000:10000000),startedAt:null,finishedAt:e.finishedAt||null};
  if(s.type==='custom-workflow'&&Number.isInteger(e.sampleEntryIndex)&&s.stages[e.sampleEntryIndex]?.sampling)s.execution.sampleEntryIndex=e.sampleEntryIndex;
  s.recording=R.readRecording(old.recording,s.stages.length);
  additions.push(s);
 }
 if(!additions.length)throw Error('文件中没有可以导入的测试或流程');
 pauseActive();
 const imported={...db,sessions:[...db.sessions,...additions],activeId:additions.at(-1).id,athlete:db.athlete||T.readAthlete(data.athlete)};
 if(!C.write(imported)){paintStorage();throw Error('无法保存到浏览器，未添加导入记录；请保留 JSON 文件，恢复存储后重试')}
 db=imported;view='history';render();toast(`已导入 ${additions.length} 次测试`);
}
function createFromForm(){
 const form=$('#new-form');if(!form)return;
 if($('#protocol-step').hidden){protocolStep();return}
 if(!form.reportValidity())return;
 const get=name=>form.querySelector(`[name="${name}"]`)?.value;
 try{
  const v=T.validInput({name:get('name'),startPower:get('startPower'),increment:get('increment'),stageMinutes:get('stageMinutes'),stageCount:get('stageCount'),samplingMode:get('samplingMode'),sampleSite:get('sampleSite'),samplePauseSec:get('samplePauseSec'),beep:form.querySelector('[name="beep"]').checked,preset,goal,athlete:formAthlete()});
  pauseActive();const s=T.newSession(v);db.sessions.push(s);db.activeId=s.id;db.athlete={...v.athlete};view='workbench';persist();closeModal();render();
 }catch(err){const target=$('#new-error');if(target)target.textContent=err.message;else toast(err.message)}
}
function openWorkflowEditor(source=null,edit=false){
 const form=$('#new-form');let athlete=T.readAthlete(db.athlete)||T.readAthlete(active()?.athlete)||{};
 if(form)athlete={name:form.elements.athleteName.value,sex:form.elements.athleteSex.value,age:form.elements.athleteAge.value,ftp:form.elements.athleteFtp.value};
 Lab.workflowUi.renderEditor({athlete:source?.athlete||athlete,source,edit});
}
function createWorkflow(){
 try{
  const result=Lab.workflowUi.readSession();if(!result)return;
  const {session,editingId}=result,existing=db.sessions.find(s=>s.id===editingId);
  if(editingId&&(!existing||existing.execution.status!=='idle'))throw Error('已开始的流程不能修改，请复制后编辑');
  pauseActive();
  if(existing){session.id=existing.id;session.createdAt=existing.createdAt;session.metadata=existing.metadata;db.sessions[db.sessions.indexOf(existing)]=session}else db.sessions.push(session);
  db.activeId=session.id;db.athlete={...session.athlete};view='workbench';persist();closeModal();render();
 }catch(error){Lab.workflowUi.showError(error.message)}
}
function saveEdit(){const s=active();if(!s)return;
 s.name=$('#edit-name').value.trim().slice(0,100)||s.name;
 s.metadata={device:$('#edit-device').value.slice(0,120),environment:$('#edit-environment').value.slice(0,120),operator:$('#edit-operator').value.slice(0,120),notes:$('#edit-notes').value.slice(0,1500)};
 persist(s);closeModal();render()
}
function handleClick(event){
 const overlay=event.target.closest('[data-dismiss="modal"]');if(overlay&&event.target===overlay){closeModal();return}
 const el=event.target.closest('[data-action]');if(!el)return;
 event.preventDefault();
 const action=el.dataset.action;
 const getSession=()=>db.sessions.find(s=>s.id===el.dataset.id)||active();
 switch(action){
  case 'toggle-menu':$('#layout').classList.toggle('show-menu');break;
  case 'view':setView(el.dataset.view);break;
  case 'go-workbench':setView('workbench');break;
  case 'new':newModal();break;
  case 'new-workflow':openWorkflowEditor();break;
  case 'edit-workflow':if(active()?.execution.status==='idle')openWorkflowEditor(active(),true);break;
  case 'close-modal':closeModal();break;
  case 'next-protocol':protocolStep();break;
  case 'back-profile':profileStep();break;
  case 'goal':selectGoal(el.dataset.goal);break;
  case 'create-test':createFromForm();break;
  case 'edit':editModal();break;
  case 'save-edit':saveEdit();break;
  case 'edit-sample':openSampleModal(Number(el.dataset.index));break;
  case 'connect-device':D.connectDevice(el.dataset.kind).then(paintDevices).catch(error=>toast(error.message));break;
  case 'disconnect-device':if(el.dataset.kind==='trainer')pauseActive();D.disconnectDevice(el.dataset.kind).catch(error=>toast(error.message));break;
  case 'start':start();break;
  case 'skip-resting':start(true);break;
  case 'pause':pause();break;
  case 'next':nextStage();break;
  case 'finish':finish();break;
  case 'duplicate':duplicate(getSession());break;
  case 'open-session':{const s=getSession();if(!s)return;if(s.id!==db.activeId)pauseActive();db.activeId=s.id;view='workbench';persist();render();break;}
  case 'scatter-metric':if(['lactate','hr','rpe'].includes(el.dataset.metric)){scatterMetric=el.dataset.metric;$('#scatter-card').innerHTML=renderScatter(active())}break;
  case 'export-csv':{const s=getSession();if(s){C.download(C.sessionCsv(s),`PaceLab_${safeFile(s.name)}.csv`,'text/csv;charset=utf-8')}break;}
  case 'export-hrv':case 'export-rr':{const s=getSession();if(s)C.download(H.exportCsv(s,action==='export-rr'),`PaceLab_${safeFile(s.name)}_${action==='export-rr'?'RR':'HRV'}.csv`,'text/csv;charset=utf-8');break;}
  case 'export-json':downloadJson(getSession());break;
  case 'export-backup':downloadBackup();break;
  case 'export-original':{const raw=S.readOriginal();if(raw!==null)C.download(raw,'PaceLab_原始数据.json','application/json;charset=utf-8');break;}
  case 'retry-save':if(persist())toast('数据已保存');break;
  case 'reload-data':if(window.confirm('重新载入会放弃本页未保存的更改。请确认已下载备份。')){window.removeEventListener('beforeunload',protectUnsaved);window.location.reload()}break;
  case 'export-fit':downloadFit(getSession());break;
  case 'import':$('#import-file').click();break;
  case 'delete':{
   const s=getSession();if(!s)return;
   if(!window.confirm(`删除「${s.name}」？此操作无法撤销。`))return;
   if(db.activeId===s.id)pauseActive();
   db.sessions=db.sessions.filter(x=>x.id!==s.id);
   if(db.activeId===s.id)db.activeId=db.sessions[db.sessions.length-1]?.id||null;
   persist();render();break;
  }
 }
}
function handleInput(event){
 const target=event.target;
 if(target.id==='resting-lactate'){saveRestingSample(target);return}
 if(target.dataset?.field){checkSampleField(target);return}
 if(target.id==='history-search'){search=target.value;const box=$('#history-list');if(box)box.innerHTML=renderHistoryItems(db.sessions.filter(s=>s.name.toLowerCase().includes(search.toLowerCase())||s.type.includes(search.toLowerCase())));return}
 if(target.closest('#new-form')&&['startPower','increment','stageMinutes','stageCount'].includes(target.name)){preset='custom';updateNewSummary()}
}
function refreshDataDisplay(changed){
 const s=active();if(!s||view!=='workbench')return;
 const plot=$('#scatter-chart');if(plot)plot.innerHTML=Charts.renderScatter(s.stages,scatterMetric,s.type==='custom-workflow');
 const rows=$('#record-rows');if(rows)rows.innerHTML=sessionRows(s);
 if(changed?.dataset?.field==='lactate')changed.classList.toggle('filled',C.n(changed.value)!==null);
}
function handleChange(event){
 const target=event.target;
 if(target.name==='samplingMode'&&target.closest('#new-form')){const solo=target.value==='solo';$('#sample-pause-group').hidden=!solo;$('#sample-pause').disabled=!solo;return}
 if(target.dataset?.field){if(target.validationMessage){toast(target.validationMessage);return}refreshDataDisplay(target);return}
}
async function handleImport(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;
 if(file.size>32*1024*1024)return toast('JSON 文件过大，单次最大 32 MB');
 try{importSessions(JSON.parse(await file.text()))}catch(error){toast('导入失败：'+error.message)}
}
document.addEventListener('click',handleClick);
document.addEventListener('input',handleInput);
document.addEventListener('change',handleChange);
document.addEventListener('submit',event=>{if(event.target.id==='new-form'){event.preventDefault();createFromForm()}else if(event.target.id==='workflow-form'){event.preventDefault();createWorkflow()}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#modal-root').innerHTML.trim())return;if(event.key==='Escape')closeModal()});
$('#import-file').addEventListener('change',handleImport);
window.addEventListener('storage',event=>{
 if(event.storageArea!==localStorage||(event.key!==C.STORAGE_KEY&&event.key!==null))return;
 const preserve=S.readStatus().status==='failed'||active()?.execution.status==='running';
 if(!S.checkForConflict())return;
 if(preserve){pauseActive();paintStorage();return}
 db=C.read();for(const s of db.sessions)R.recoverRecording(s);syncErgControl();render();toast('其他标签页已更新数据；如需在此记录，请点击继续');
});
function protectUnsaved(event){if(S.readStatus().status==='failed'&&db.sessions.length){event.preventDefault();event.returnValue=''}}
window.addEventListener('beforeunload',protectUnsaved);
window.addEventListener('pagehide',()=>{D.slots.trainer.erg?.setDesired('stopped');const s=active();if(s?.execution.status==='running'){s.execution.elapsedMs=elapsedNow(s.execution);s.execution.startedAt=null;s.execution.status='paused';R.stopRecording(s);persist(s)}});
D.subscribe(handleDeviceChange);
D.subscribeHeart(packet=>{const s=active();if(s)H.capturePacket(s,packet)});
setInterval(()=>{updateExecution();paintLive();captureActivity();paintDevices()},250);
render();
})();
