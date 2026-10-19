(function(){
'use strict';
const Lab=window.Lab;
const C=Lab.core,A=Lab.analysis,T=Lab.tests,Charts=Lab.charts;
const {esc,icon,fmt,dateText,uid}=C;
let db=C.read();
let view='workbench',preset='lt1',goal='lt1',search='',compareIds=[];
const $=q=>document.querySelector(q);
const active=()=>db.sessions.find(s=>s.id===db.activeId)||null;
const statusLabels={idle:'尚未开始',running:'测试进行中',paused:'已暂停',ready:'等待下一阶段',done:'已完成'};
const statusClass={idle:'',running:'ongoing',paused:'paused',ready:'paused',done:'done'};
const tag=(st)=>`<span class="status-pill ${statusClass[st]||''}"><span class="status-dot"></span>${statusLabels[st]||'—'}</span>`;
const btn=(action,label,style='btn',extra='')=>`<button class="${style}" data-action="${action}" ${extra}>${label}</button>`;
const sexLabel=sex=>({male:'男',female:'女',undisclosed:'不透露'}[sex]||'');
function athleteText(a){return a?[a.name,sexLabel(a.sex),`${a.age} 岁`,`FTP ${a.ftp} W`].join(' · '):''}
function athleteLine(s){const parts=[athleteText(s.athlete),T.goals.find(g=>g.id===s.protocol.goal)?.name].filter(Boolean);return parts.length?`<div class="athlete-line">${parts.map(esc).join(' · ')}</div>`:''}
function persist(s=null){if(s)s.updatedAt=new Date().toISOString();C.write(db)}
function setView(v){view=v;$('#layout')?.classList.remove('show-menu');render()}
function toast(msg){const wrap=$('#toast-stack');const node=document.createElement('div');node.className='toast';node.textContent=msg;wrap.appendChild(node);setTimeout(()=>node.remove(),4200)}
Lab.ui={toast};
function renderSidebar(){
 const nav=[['workbench','测试工作台','activity'],['analysis','结果分析','chart'],['history','历史记录','history']];
 $('#sidebar').innerHTML=`<a class="brand" href="#" data-action="go-workbench"><div class="brand-mark">${icon('activity')}</div><div class="brand-name">PaceLab<span style="color:#c5ef87">.</span></div></a>
 ${nav.map(([v,label,ic])=>`<button class="nav-link ${view===v?'active':''}" data-action="view" data-view="${v}">${icon(ic)}<span>${label}</span>${v==='history'?`<span class="tiny-pill">${db.sessions.length}</span>`:''}</button>`).join('')}
 <div class="sidebar-bottom"><button data-action="backup">${icon('download')}　备份全部数据</button></div>`;
}
function renderTopbar(){
 $('#topbar').innerHTML=`<div style="display:flex;align-items:center;gap:15px;min-width:0"><button class="btn btn-ghost btn-icon menu-button" aria-label="打开菜单" data-action="toggle-menu">${icon('menu')}</button><div class="breadcrumbs"><b>乳酸阶梯测试</b></div></div><div class="top-actions">${btn('import',icon('upload')+' 导入 JSON','btn btn-sm')}${btn('new',icon('plus')+' 新建测试','btn btn-sm btn-dark')}</div>`;
}
function heading(title,actions=''){
 return `<div class="heading"><h1>${esc(title)}</h1>${actions?`<div class="heading-actions">${actions}</div>`:''}</div>`;
}

function turnpointFoot(result,reason){return result?`定位区间 ${fmt(result.between[0])}–${fmt(result.between[1])} W`:(reason||'未识别')}
function turnpointMarkers(a){return [['LT1',a.lt1,'#9da64a'],['LT2',a.lt2,'#709bbd']].filter(([,result])=>result).map(([label,result,color])=>({x:result.power,label,color,between:result.between}))}
function metricCard(label,value,unit='',foot=''){return `<div class="card stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${value} <small>${esc(unit)}</small></div>${foot?`<div class="stat-foot">${esc(foot)}</div>`:''}</div>`}
function introStats(s,a){
 return `<div class="stats">${metricCard('有效乳酸样本',a.validCount,`/ ${s.stages.length} 级`)}${metricCard('LT1 拐点估计',a.lt1?fmt(a.lt1.power):'—','W',turnpointFoot(a.lt1,a.lt1Reason))}${metricCard('LT2 拐点估计',a.lt2?fmt(a.lt2.power):'—','W',turnpointFoot(a.lt2,a.lt2Reason))}${metricCard('最高有效乳酸',a.peak===null?'—':fmt(a.peak,1),'mmol/L')}</div>`;
}
function elapsedNow(e){return Math.max(0,(e.elapsedMs||0)+(e.status==='running'&&e.startedAt?Math.max(0,Date.now()-e.startedAt):0))}
function phaseDuration(s){return s.execution.phase==='sampling'?s.protocol.samplePauseSec*1000:s.stages[s.execution.stageIndex].durationSec*1000}
function renderLive(s){
 const e=s.execution,st=s.stages[Math.min(e.stageIndex,s.stages.length-1)];
 const next=s.stages.slice(e.stageIndex,e.stageIndex+5);
 return `<div class="card card-pad"><div class="session-line"><span class="session-title">${esc(s.name)}</span>${tag(e.status)}<span>${dateText(s.createdAt)}</span></div>${athleteLine(s)}
  <div class="live-card"><div class="live-top"><span class="live-label">阶段计时</span><span class="live-mode">${s.protocol.samplingMode==='solo'?'单人 · 分段采样':'双人 · 连续采样'}</span></div>
   <div class="live-center"><div><div class="live-step" id="live-step">阶段 ${String(e.stageIndex+1).padStart(2,'0')} / ${String(s.stages.length).padStart(2,'0')}</div><div class="live-power" id="live-power">${st.power}<small>W</small></div></div><div class="timer-area"><label id="live-phase-label">${e.phase==='sampling'?'采样间隔':'当前阶段剩余'}</label><div id="live-time" class="timer">${fmtTime(st.durationSec*1000)}</div><div class="timer-label" id="live-total">目标 ${st.durationSec/60} 分钟 / 级</div></div></div>
   <div class="stage-progress"><div id="live-progress" class="stage-fill"></div></div><div id="live-hint" class="live-hint" hidden></div>
   <div class="live-buttons" id="live-controls">${liveControls(s)}</div>
  </div>
  <div class="card-heading" style="margin-top:24px;margin-bottom:8px"><div><div class="card-title" style="font-size:13px">阶段功率</div></div></div><div class="next-steps">${next.map((x,i)=>`<div class="power-chip ${i===0?'active':''}">${x.power} W <span style="color:#9aa5a8;font-size:10px">· ${Math.round(x.durationSec/60)}′</span></div>`).join('')}</div>
 </div>`;
}
function liveControls(s){const e=s.execution;
 if(e.status==='done')return btn('duplicate',icon('copy')+' 复制此测试','btn btn-primary')+btn('view-analysis',icon('chart')+' 查看结果','btn btn-dark');
 if(e.status==='idle')return btn('start',icon('play')+' 开始测试','btn btn-primary')+btn('finish',icon('stop')+' 标记为已完成','btn btn-dark');
 if(e.status==='ready')return btn('next',icon('arrow')+' '+(e.stageIndex<s.stages.length-1?'下一阶段':'结束测试'),'btn btn-primary')+btn('finish',icon('stop')+' 结束','btn btn-dark');
 return (e.status==='running'?btn('pause',icon('pause')+' 暂停','btn btn-primary'):btn('start',icon('play')+' 继续','btn btn-primary'))+btn('next',icon('arrow')+' 下一阶段','btn btn-dark')+btn('finish',icon('stop')+' 结束','btn btn-dark');
}
function fmtTime(ms){const secs=Math.ceil(Math.max(0,ms)/1000);const mm=Math.floor(secs/60),ss=secs%60;return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`}
function sessionRows(s,editable=true){
 const e=s.execution;
 return s.stages.map((st,i)=>{
 const lac=A.value(st.lactate);
 return `<tr class="${i===e.stageIndex&&e.status!=='done'?'active-row':''}"><td><span class="table-index">${String(i+1).padStart(2,'0')}</span></td><td><strong>${st.power}</strong> W</td><td>${fmt(st.durationSec/60)} min</td>
 <td>${editable?`<input aria-label="第${i+1}级乳酸 mmol/L" class="field ${lac!==null?'filled':''}" data-index="${i}" data-field="lactate" type="number" step="0.1" min="0.2" max="30" placeholder="—" value="${st.lactate??''}">`:lac===null?'—':fmt(lac,1)}</td>
 <td>${editable?`<input aria-label="第${i+1}级心率" class="field small" data-index="${i}" data-field="hr" type="number" step="1" min="30" max="240" placeholder="—" value="${st.hr??''}">`:esc(st.hr??'—')}</td>
 <td>${editable?`<input aria-label="第${i+1}级RPE" class="field small" data-index="${i}" data-field="rpe" type="number" step="0.5" min="0" max="10" placeholder="—" value="${st.rpe??''}">`:esc(st.rpe??'—')}</td>
 <td>${editable?`<select aria-label="第${i+1}级样本质量" class="field select" data-index="${i}" data-field="quality"><option value="normal" ${st.quality==='normal'?'selected':''}>正常</option><option value="suspect" ${st.quality==='suspect'?'selected':''}>可疑</option><option value="exclude" ${st.quality==='exclude'?'selected':''}>排除</option></select>`:st.quality==='exclude'?'排除':st.quality==='suspect'?'可疑':'正常'}</td>
 <td>${editable?`<input aria-label="第${i+1}级备注" class="field note" data-index="${i}" data-field="notes" maxlength="200" value="${esc(st.notes||'')}">`:esc(st.notes||'—')}</td></tr>`;
 }).join('');
}
function recordTable(s){
 return `<div class="card card-pad section-space"><div class="details"><div><div class="card-title">阶段记录</div></div><div class="details-tools">${btn('export-csv',icon('download')+' CSV','btn btn-sm')}${btn('export-json',icon('file')+' JSON','btn btn-sm')}</div></div>
  <div class="data-table-wrap"><table class="data-table"><thead><tr><th>级</th><th>目标功率</th><th>时长</th><th>乳酸 mmol/L</th><th>心率 bpm</th><th>RPE</th><th>样本质量</th><th>备注</th></tr></thead><tbody>${sessionRows(s)}</tbody></table></div>
 </div>`;
}
function quickChart(s){const a=A.analyze(s.stages);
 return `<div class="card card-pad"><div class="card-heading"><div class="card-title">乳酸-功率曲线</div>${btn('view-analysis','完整分析 '+icon('arrow'),'btn btn-sm btn-ghost')}</div><div class="chart-surface" id="overview-lactate-chart">${Charts.curve(s.stages,'lactate',turnpointMarkers(a),a.fit)}</div><div class="chart-legend"><span><i class="legend-dot" style="background:#178a72"></i>乳酸读数</span><span><i class="legend-dot" style="background:#c98d56"></i>分段拟合</span><span>LT1 / LT2 拐点估计</span></div></div>`;
}
function renderWorkbench(){
 const s=active();
 const head=heading('测试工作台',s?btn('edit',icon('edit')+' 测试信息','btn btn-sm'):'');
 if(!s)return head+C.emptyState('暂无测试','','droplet',btn('new',icon('plus')+' 新建测试','btn btn-primary'));
 return head+introStats(s,A.analyze(s.stages))+`<div class="grid-main"><div>${renderLive(s)}</div><div>${quickChart(s)}</div></div>`+recordTable(s);
}

function renderAnalysis(){
 const s=active();const act=heading('结果分析',s?`${btn('export-csv',icon('download')+' CSV','btn')}${btn('print',icon('printer')+' 报告 / PDF','btn btn-dark')}`:btn('new',icon('plus')+' 新建测试','btn btn-primary'));
 if(!s)return act+C.emptyState('暂无测试','','chart',btn('new',icon('plus')+' 新测试','btn btn-primary'));
 const a=A.analyze(s.stages);
 const markers=turnpointMarkers(a);
 return `${act}<div class="session-line"><span class="session-title">${esc(s.name)}</span>${tag(s.execution.status)}<span>${dateText(s.createdAt)}</span></div>${athleteLine(s)}
 ${introStats(s,a)}<div class="analysis-method">连续分段线性回归 · LT1 为首次斜率增加，LT2 为再次增加 · 阴影为定位区间</div>
 <div class="analysis-grid"><div class="card card-pad"><div class="card-heading"><div><div class="card-title">血乳酸 × 功率</div></div></div><div class="chart-surface">${Charts.curve(s.stages,'lactate',markers,a.fit)}</div><div class="chart-legend"><span><i class="legend-dot" style="background:#178a72"></i>乳酸</span><span><i class="legend-dot" style="background:#c98d56"></i>分段拟合</span><span><i class="legend-dot" style="background:#9da64a"></i>LT1</span><span><i class="legend-dot" style="background:#709bbd"></i>LT2</span></div></div>
 <div class="card card-pad"><div class="card-heading"><div><div class="card-title">心率 × 功率</div></div></div><div class="chart-surface">${Charts.curve(s.stages,'hr')}</div><div class="chart-legend"><span><i class="legend-dot" style="background:#178a72"></i>阶段心率</span></div></div>
 <div class="card card-pad"><div class="card-heading"><div><div class="card-title">RPE（0–10）× 功率</div></div></div><div class="chart-surface">${Charts.curve(s.stages,'rpe')}</div></div>
 <div class="card card-pad"><div class="card-heading"><div><div class="card-title">数据质量检查</div></div></div><div class="quality-items">${(a.flags.length?a.flags:[{kind:'neutral',text:'无异常记录'}]).map(f=>`<div class="quality-item ${f.kind==='warn'?'warn':f.kind==='good'?'good':''}">${icon(f.kind==='warn'?'alert':f.kind==='good'?'check':'info')}<span>${esc(f.text)}</span></div>`).join('')}</div><div class="divider"></div><div class="report-details"><div class="report-detail"><small>分析方法</small><strong>分段线性回归</strong></div><div class="report-detail"><small>最高有效乳酸</small><strong>${a.peak!==null?fmt(a.peak,1)+' mmol/L':'—'}</strong></div><div class="report-detail"><small>采样模式</small><strong>${s.protocol.samplingMode==='solo'?'间断采样':'连续采样'}</strong></div><div class="report-detail"><small>采样部位</small><strong>${s.protocol.sampleSite==='fingertip'?'指尖':'耳垂'}</strong></div></div></div></div>`;
}
function renderHistory(){
 const actions=`${btn('import',icon('upload')+' 导入','btn')}${btn('backup',icon('download')+' 全部备份','btn btn-dark')}`;
 const filtered=db.sessions.filter(s=>s.name.toLowerCase().includes(search.toLowerCase())||s.type.includes(search.toLowerCase()));
 let compare='';
 if(db.sessions.filter(s=>A.analyze(s.stages).validCount>0).length>=2){
  const candidates=db.sessions.filter(s=>A.analyze(s.stages).validCount>0);
  compare=`<div class="card card-pad section-space"><div class="card-heading"><div><div class="card-title">历史曲线对比</div><div class="card-sub">最多选择 3 次</div></div></div>
  <div class="comparison-picker">${candidates.slice(0,18).map((s,i)=>`<label title="${esc(s.name)}"><input type="checkbox" data-compare-id="${esc(s.id)}" ${compareIds.includes(s.id)?'checked':''}> <span>${esc(s.name)} · ${dateText(s.createdAt).slice(0,10)}</span></label>`).join('')}</div>
  ${compareIds.length>=2?`<div class="chart-surface" style="height:345px">${Charts.svg({series:compareIds.map(id=>{const s=db.sessions.find(x=>x.id===id);return {label:s?.name||'未知测试',points:A.analyze(s?.stages||[]).points};}),minY:0,yAxisLabel:'血乳酸 / mmol/L'})}</div><div class="comparison-legend">${compareIds.map((id,i)=>{const s=db.sessions.find(x=>x.id===id);return `<span><i class="legend-dot" style="background:${Charts.palette[i]}"></i>${esc(s?.name||'测试')}</span>`}).join('')}</div>`:''}</div>`;
 }
 return `${heading('历史记录',actions)}
  ${db.sessions.length?`<div class="card card-pad" style="margin-bottom:16px"><div class="details" style="margin-bottom:0"><div><div class="card-title">已保存 ${db.sessions.length} 次测试</div></div><input class="form-control" style="max-width:250px" id="history-search" aria-label="搜索测试名称" placeholder="搜索测试名称" value="${esc(search)}"></div></div><div class="history-list" id="history-list">${renderHistoryItems(filtered)}</div>${compare}`:
  C.emptyState('暂无历史记录','','history',btn('new',icon('plus')+' 创建测试','btn btn-primary'))}`;
}
function renderHistoryItems(items){
 if(!items.length)return `<div class="card empty"><h3>没有匹配记录</h3></div>`;
 return [...items].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(s=>{
  const a=A.analyze(s.stages);
  return `<div class="history-item"><div class="history-icon">${icon(T.byId(s.type)?.icon||'activity')}</div><div class="history-main"><strong>${esc(s.name)}</strong><p>${dateText(s.createdAt)}${s.athlete?'　·　'+esc(s.athlete.name)+' · FTP '+s.athlete.ftp+' W':''}</p><div class="history-meta"><span>${tag(s.execution.status)}</span><span>${a.validCount}/${s.stages.length} 级有效读数</span><span class="code-pill">${s.protocol.startPower}W / +${s.protocol.increment}W / ${s.protocol.stageMinutes}min</span></div></div><div class="history-actions">${btn('open-session','打开','btn btn-sm','data-id="'+esc(s.id)+'"')}${btn('duplicate',icon('copy'),'btn btn-sm btn-icon','title="复制协议" data-id="'+esc(s.id)+'"')}${btn('export-json',icon('download'),'btn btn-sm btn-icon','title="导出 JSON" data-id="'+esc(s.id)+'"')}${btn('delete',icon('trash'),'btn btn-sm btn-icon','title="删除记录" data-id="'+esc(s.id)+'"')}</div></div>`;
 }).join('');
}

function render(){
 renderSidebar();renderTopbar();
 const root=$('#content');
 root.innerHTML=view==='analysis'?renderAnalysis():view==='history'?renderHistory():renderWorkbench();
 paintLive();
}
function newModal(){
 const a=T.readAthlete(db.athlete)||T.readAthlete(active()?.athlete)||{name:'',sex:'',age:'',ftp:''};
 preset='lt1';goal='lt1';
 $('#modal-root').innerHTML=`<div class="modal-layer" data-dismiss="modal"><div class="modal protocol-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
 <div class="modal-head"><div><div class="modal-step" id="new-step-label">1 / 2 · 个人资料</div><h2 id="modal-title">新建乳酸阶梯测试</h2></div>${btn('close-modal',icon('x'),'btn btn-icon btn-ghost','aria-label="关闭"')}</div>
 <form id="new-form"><div class="modal-body">
 <fieldset id="athlete-step" class="form-section"><div class="form-grid">
  <div class="form-group"><label for="athlete-name">姓名</label><input class="form-control" id="athlete-name" name="athleteName" autocomplete="name" maxlength="100" value="${esc(a.name)}" required></div>
  <div class="form-group"><label for="athlete-sex">性别</label><select class="form-control" id="athlete-sex" name="athleteSex" required><option value="">请选择</option>${[['male','男'],['female','女'],['undisclosed','不透露']].map(([value,label])=>`<option value="${value}" ${a.sex===value?'selected':''}>${label}</option>`).join('')}</select></div>
  <div class="form-group"><label for="athlete-age">年龄 / 岁</label><input class="form-control" id="athlete-age" name="athleteAge" type="number" min="1" max="120" step="1" value="${a.age}" required></div>
  <div class="form-group"><label for="athlete-ftp">预估 FTP / W</label><input class="form-control" id="athlete-ftp" name="athleteFtp" type="number" min="20" max="1200" step="1" value="${a.ftp}" required></div>
 </div></fieldset>
 <fieldset id="protocol-step" class="form-section" hidden disabled>
 <div class="athlete-summary" id="new-athlete-summary"></div>
 <h3 class="form-section-title">测试目的</h3>
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
  <div class="form-group"><label>声音</label><label class="toggle" style="margin-top:8px"><input name="beep" type="checkbox"> 阶段切换时播放声音</label></div>
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
function closeModal(){$('#modal-root').innerHTML=''}
function updateNewSummary(){
 const f=$('#new-form');if(!f)return;
 const st=Number(f.elements.startPower.value),inc=Number(f.elements.increment.value),cnt=Number(f.elements.stageCount.value),mins=Number(f.elements.stageMinutes.value);
 const valid=['startPower','increment','stageCount','stageMinutes'].every(key=>f.elements[key].value!==''&&f.elements[key].validity.valid);
 $('#new-max-power').textContent=valid?`${st+(cnt-1)*inc} W`:'—';
 $('#new-total-time').textContent=valid?`${cnt*mins} min`:'—';
}
function start(){const s=active();if(!s)return;let e=s.execution;
 if(e.status==='done')return toast('测试已结束，无法继续计时');
 if(e.status==='ready'){nextStage();return}
 if(e.status==='running')return;
 if(e.status==='idle'){e.stageIndex=0;e.phase='effort';e.elapsedMs=0}
 e.status='running';e.startedAt=Date.now();persist(s);render();if(s.protocol.beep)beep();}
function pause(){const s=active();if(!s)return;const e=s.execution;if(e.status!=='running')return;e.elapsedMs=elapsedNow(e);e.startedAt=null;e.status='paused';persist(s);render()}
function finish(){const s=active();if(!s)return;if(s.execution.status==='done')return;
 if(s.execution.status!=='idle'&&!window.confirm('结束测试？结束后无法继续计时。'))return;
 const e=s.execution;e.status='done';e.finishedAt=new Date().toISOString();e.elapsedMs=0;e.startedAt=null;persist(s);render()}
function nextStage(){const s=active();if(!s)return;const e=s.execution;
 if(e.stageIndex>=s.stages.length-1){e.status='done';e.finishedAt=new Date().toISOString();e.startedAt=null;e.elapsedMs=0;persist(s);render();return}
 e.stageIndex++;e.phase='effort';e.elapsedMs=0;e.startedAt=Date.now();e.status='running';persist(s);render();if(s.protocol.beep)beep();}
function beep(){try{const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return;const ctx=new AudioCtx();const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.value=784;g.gain.setValueAtTime(.0001,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.12,ctx.currentTime+.02);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.23);o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+.25);setTimeout(()=>ctx.close(),600)}catch{}}
function updateExecution(){const s=active();if(!s||s.execution.status!=='running')return;
 const e=s.execution;let transitions=0;
 while(e.status==='running'&&elapsedNow(e)>=phaseDuration(s)&&transitions<26){
  transitions++;
  const duration=phaseDuration(s);
  const phaseOverrun=elapsedNow(e)-duration;
  if(e.phase==='effort'&&s.protocol.samplingMode==='solo'){
    e.phase='sampling';e.elapsedMs=Math.max(0,phaseOverrun);e.startedAt=Date.now();if(s.protocol.beep)beep();
  }else if(e.phase==='sampling'){
    e.status='ready';e.elapsedMs=duration;e.startedAt=null;if(s.protocol.beep)beep();
  }else if(e.stageIndex<s.stages.length-1){
    e.stageIndex++;e.elapsedMs=Math.max(0,phaseOverrun);e.startedAt=Date.now();if(s.protocol.beep)beep();
  }else{
    e.status='done';e.startedAt=null;e.finishedAt=new Date().toISOString();e.elapsedMs=duration;
  }
  persist(s);render();
 }
}
function paintLive(){const s=active(),timer=$('#live-time');if(!s||!timer||view!=='workbench')return;
 const e=s.execution,st=s.stages[e.stageIndex];if(!st)return;
 const elapsed=Math.min(phaseDuration(s),elapsedNow(e));const remain=phaseDuration(s)-elapsed;
 timer.textContent=fmtTime(e.status==='idle'?phaseDuration(s):e.status==='done'?0:remain);
 const progress=$('#live-progress');if(progress)progress.style.width=(e.status==='done'?100:Math.min(100,Math.max(0,elapsed/phaseDuration(s)*100)))+'%';
 const title=$('#live-phase-label');if(title)title.textContent=e.phase==='sampling'?'采样间隔剩余':'当前阶段剩余';
 const hint=$('#live-hint');if(hint){
  const message=e.status==='ready'?'等待下一阶段':e.status!=='running'?'':e.phase==='sampling'?'采样间隔':remain<=30000?'采样窗口':remain<=60000?'阶段剩余不足 1 分钟':'';
  hint.hidden=!message;
  hint.textContent=message;
 }
}
function checkSampleField(target){const s=active();if(!s)return;const index=Number(target.dataset.index),field=target.dataset.field;
 if(!Number.isInteger(index)||index<0||index>=s.stages.length||!['lactate','hr','rpe','notes','quality'].includes(field))return;
 const stage=s.stages[index];const raw=target.value;
 if(['lactate','hr','rpe'].includes(field)){
   let nv=raw===''?null:Number(raw);
   const bounds={lactate:[.2,30],hr:[30,240],rpe:[0,10]}[field];
   if(nv!==null&&(!Number.isFinite(nv)||nv<bounds[0]||nv>bounds[1])){target.setCustomValidity(`请输入 ${bounds[0]}–${bounds[1]} 之间的数值`);return}
   target.setCustomValidity('');stage[field]=nv;
   if(field==='lactate'&&nv!==null&&!stage.recordedAt)stage.recordedAt=new Date().toISOString();
 }else if(field==='notes')stage.notes=raw.slice(0,200);
 else stage.quality=['normal','suspect','exclude'].includes(raw)?raw:'normal';
 persist(s);
}
function duplicate(source){const s=source||active();if(!s)return;
 const input=T.validInput({...s.protocol,athlete:s.athlete,name:s.name+'（副本）'});
 const copy=T.newSession(input);copy.metadata={...s.metadata,notes:''};db.sessions.push(copy);db.activeId=copy.id;view='workbench';persist();render()}
function exportedSession(s){const a=A.analyze(s.stages);return {...s,analysis:{method:a.method,lt1:a.lt1,lt2:a.lt2,reason:a.reason,lt1Reason:a.lt1Reason,lt2Reason:a.lt2Reason}}}
function downloadJson(s){if(!s)return toast('请先创建测试');C.download(JSON.stringify({schemaVersion:1,exportType:'session',exportedAt:new Date().toISOString(),session:exportedSession(s)},null,2),`PaceLab_${safeFile(s.name)}.json`,'application/json;charset=utf-8')}
function backup(){C.download(JSON.stringify({schemaVersion:1,exportType:'backup',exportedAt:new Date().toISOString(),sessions:db.sessions.map(exportedSession)},null,2),'PaceLab_全部测试备份_'+new Date().toISOString().slice(0,10)+'.json','application/json;charset=utf-8')}
function safeFile(s){return String(s).replace(/[\\/:*?"<>|\n\r]/g,'_').slice(0,70)||'测试'}
function importSessions(data){
 const raw=data?.exportType==='backup'?data.sessions:data?.exportType==='session'?[data.session]:null;
 if(data?.schemaVersion!==1||!Array.isArray(raw))throw Error('无法识别的文件格式或数据版本');
 if(raw.length>300)throw Error('一次导入的测试数量过多（上限 300）');
 let imported=0;
 for(const old of raw){
  if(old?.type!=='lactate-step'||!Array.isArray(old.stages)||old.stages.length<3||old.stages.length>25)continue;
  let v;try{v=T.validInput({...old.protocol,athlete:T.readAthlete(old.athlete),stageCount:old.stages.length,name:String(old.name||'导入测试'),samplingMode:old.protocol?.samplingMode||'assisted'})}catch{continue}
  const s=T.newSession(v);s.id=uid();s.createdAt=Number.isFinite(Date.parse(old.createdAt))?old.createdAt:new Date().toISOString();
  s.name=v.name+(db.sessions.some(x=>x.name===v.name)?'（导入）':'');
  s.metadata={notes:String(old.metadata?.notes||'').slice(0,1500),device:String(old.metadata?.device||'').slice(0,120),environment:String(old.metadata?.environment||'').slice(0,120),operator:String(old.metadata?.operator||'').slice(0,120)};
  s.stages.forEach((stage,i)=>{const original=old.stages[i]||{};
    const pow=Number(original.power);if(Number.isFinite(pow)&&pow>=20&&pow<=1200)stage.power=pow;
    for(const [key,min,max] of [['lactate',.2,30],['hr',30,240],['rpe',0,10]]){const z=original[key];const x=Number(z);stage[key]=z===null||z===''||z===undefined||!Number.isFinite(x)||x<min||x>max?null:x}
    stage.quality=['normal','suspect','exclude'].includes(original.quality)?original.quality:'normal';
    stage.notes=String(original.notes||'').slice(0,200);stage.recordedAt=Number.isFinite(Date.parse(original.recordedAt||original.sampleAt))?(original.recordedAt||original.sampleAt):null;
  });
  const e=old.execution||{};
  s.execution={stageIndex:C.clamp(Number(e.stageIndex)||0,0,s.stages.length-1),phase:e.phase==='sampling'?'sampling':'effort',status:e.status==='done'?'done':e.status==='idle'?'idle':'paused',elapsedMs:C.clamp(Number(e.elapsedMs)||0,0,10000000),startedAt:null,finishedAt:e.finishedAt||null};
  db.sessions.push(s);db.activeId=s.id;imported++;
 }
 if(!imported)throw Error('文件中没有可以导入的乳酸阶梯测试');
 persist();view='history';render();
}
function printReport(s){if(!s)return;const a=A.analyze(s.stages);const printCell=(v)=>`<td>${esc(v??'—')}</td>`;
 $('#print-report').innerHTML=`<h1>PaceLab 测试报告</h1><p>乳酸阶梯测试 · ${dateText(new Date().toISOString())}</p><hr style="border:0;border-top:1px solid #ddd;margin:15px 0">
 <h2>${esc(s.name)}</h2>${athleteLine(s)}<p>创建时间：${dateText(s.createdAt)}　|　协议：${s.protocol.startPower} W 起步 / +${s.protocol.increment} W / ${s.protocol.stageMinutes} 分钟 × ${s.stages.length} 级<br>采样方式：${s.protocol.samplingMode==='solo'?'单人间断采样':'协助连续采样'}　|　部位：${s.protocol.sampleSite==='earlobe'?'耳垂':'指尖'}<br>设备：${esc(s.metadata?.device||'未填写')}　|　环境：${esc(s.metadata?.environment||'未填写')}</p>
 <div class="print-grid">${[['有效样本',String(a.validCount)+' / '+s.stages.length],['LT1 拐点估计',a.lt1?fmt(a.lt1.power)+' W':'—'],['LT2 拐点估计',a.lt2?fmt(a.lt2.power)+' W':'—'],['最高有效乳酸',a.peak!==null?fmt(a.peak,1)+' mmol/L':'—']].map(([l,v])=>`<div class="print-box"><span>${esc(l)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>
 <h2>乳酸-功率曲线</h2>${Charts.curve(s.stages,'lactate',turnpointMarkers(a),a.fit)}
 <h2>阶段记录明细</h2><table class="data-table"><thead><tr><th>阶段</th><th>功率</th><th>时长</th><th>乳酸</th><th>心率</th><th>RPE</th><th>质量</th><th>备注</th></tr></thead><tbody>${s.stages.map((st,i)=>`<tr>${printCell(i+1)}${printCell(st.power+' W')}${printCell(st.durationSec/60+' min')}${printCell(st.lactate)}${printCell(st.hr)}${printCell(st.rpe)}${printCell(st.quality==='normal'?'正常':st.quality==='exclude'?'排除':'可疑')}${printCell(st.notes)}</tr>`).join('')}</tbody></table>
 <p>方法：连续分段线性回归（${esc(a.method)}）。LT1：${esc(turnpointFoot(a.lt1,a.lt1Reason))}；LT2：${esc(turnpointFoot(a.lt2,a.lt2Reason))}。拐点为模型估计，定位区间不是置信区间。</p><p>测试备注：${esc(s.metadata?.notes||'无')}<br>数据质量：${(a.flags.length?a.flags:[{kind:'neutral',text:'无异常记录'}]).map(f=>esc(f.text)).join('；')||'无'}</p>`;
 window.print();
}
function createFromForm(){
 const form=$('#new-form');if(!form)return;
 if($('#protocol-step').hidden){protocolStep();return}
 if(!form.reportValidity())return;
 const get=name=>form.querySelector(`[name="${name}"]`)?.value;
 try{
  const v=T.validInput({name:get('name'),startPower:get('startPower'),increment:get('increment'),stageMinutes:get('stageMinutes'),stageCount:get('stageCount'),samplingMode:get('samplingMode'),sampleSite:get('sampleSite'),samplePauseSec:get('samplePauseSec'),beep:form.querySelector('[name="beep"]').checked,preset,goal,athlete:formAthlete()});
  const s=T.newSession(v);db.sessions.push(s);db.activeId=s.id;db.athlete={...v.athlete};view='workbench';persist();closeModal();render();
 }catch(err){const target=$('#new-error');if(target)target.textContent=err.message;else toast(err.message)}
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
  case 'close-modal':closeModal();break;
  case 'next-protocol':protocolStep();break;
  case 'back-profile':profileStep();break;
  case 'goal':selectGoal(el.dataset.goal);break;
  case 'create-test':createFromForm();break;
  case 'edit':editModal();break;
  case 'save-edit':saveEdit();break;
  case 'start':start();break;
  case 'pause':pause();break;
  case 'next':nextStage();break;
  case 'finish':finish();break;
  case 'duplicate':duplicate(getSession());break;
  case 'open-session':{const s=getSession();if(!s)return;db.activeId=s.id;view='workbench';persist();render();break;}
  case 'view-analysis':setView('analysis');break;
  case 'export-csv':{const s=getSession();if(s){C.download(C.sessionCsv(s),`PaceLab_${safeFile(s.name)}.csv`,'text/csv;charset=utf-8')}break;}
  case 'export-json':downloadJson(getSession());break;
  case 'backup':backup();break;
  case 'import':$('#import-file').click();break;
  case 'print':printReport(getSession());break;
  case 'delete':{
   const s=getSession();if(!s)return;
   if(!window.confirm(`删除「${s.name}」？此操作无法撤销。`))return;
   db.sessions=db.sessions.filter(x=>x.id!==s.id);
   if(db.activeId===s.id)db.activeId=db.sessions[db.sessions.length-1]?.id||null;
   compareIds=compareIds.filter(id=>id!==s.id);persist();render();break;
  }
 }
}
function handleInput(event){
 const target=event.target;
 if(target.dataset?.field){checkSampleField(target);return}
 if(target.id==='history-search'){search=target.value;const box=$('#history-list');if(box)box.innerHTML=renderHistoryItems(db.sessions.filter(s=>s.name.toLowerCase().includes(search.toLowerCase())||s.type.includes(search.toLowerCase())));return}
 if(target.closest('#new-form')&&['startPower','increment','stageMinutes','stageCount'].includes(target.name)){preset='custom';updateNewSummary()}
}
function refreshDataDisplay(changed){
 const s=active();if(!s||view!=='workbench')return;
 const a=A.analyze(s.stages),stats=document.querySelector('.stats');
 if(stats)stats.outerHTML=introStats(s,a);
 const plot=$('#overview-lactate-chart');
 if(plot)plot.innerHTML=Charts.curve(s.stages,'lactate',turnpointMarkers(a),a.fit);
 if(changed?.dataset?.field==='lactate')changed.classList.toggle('filled',A.value(changed.value)!==null);
}
function handleChange(event){
 const target=event.target;
 if(target.name==='samplingMode'&&target.closest('#new-form')){const solo=target.value==='solo';$('#sample-pause-group').hidden=!solo;$('#sample-pause').disabled=!solo;return}
 if(target.dataset?.field){if(target.validationMessage){toast(target.validationMessage);return}refreshDataDisplay(target);return}
 if(target.dataset?.compareId){
  const id=target.dataset.compareId;
  if(target.checked){if(compareIds.length>=3){target.checked=false;toast('最多对比 3 次测试');return}compareIds.push(id)}else compareIds=compareIds.filter(x=>x!==id);
  render();return;
 }
}
async function handleImport(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;
 if(file.size>4*1024*1024)return toast('JSON 文件过大，单次最大 4 MB');
 try{importSessions(JSON.parse(await file.text()))}catch(error){toast('导入失败：'+error.message)}
}
document.addEventListener('click',handleClick);
document.addEventListener('input',handleInput);
document.addEventListener('change',handleChange);
document.addEventListener('submit',event=>{if(event.target.id==='new-form'){event.preventDefault();createFromForm()}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#modal-root').innerHTML.trim())return;if(event.key==='Escape')closeModal()});
$('#import-file').addEventListener('change',handleImport);
window.addEventListener('storage',event=>{if(event.key===C.STORAGE_KEY){db=C.read();render();toast('其他标签页已更新数据')}});
setInterval(()=>{updateExecution();paintLive()},250);
render();
})();
