'use strict';
const $ = id => document.getElementById(id), dirty = new Set(), pending = new Map(), edits = new Map();
let state, socket, client = 0, sequence = 0, closing = false, reconnectTimer, reconnectDelay = 2000, heartbeat, noticeTimer, preferenceSaveTimer, selectedSetting, stickyOffsetsObserver, stickyNoticeObserver;
let audioContext, audioSetup, audioNode, listeningGain, micStream, micSource, listening = false, microphone = false, expectedAudio;
let audioEpoch = 0, microphoneBusy = false, listeningBusy = false, rfCaptureAction = '', rfCaptureTimer, rfCaptureBaselineStatus = '';
let preferenceSaver, tuningQueue, activePage='dashboard', renderScheduled=false, renderCost=0, lastCommandMs=0, micRegistered=false;
const rfHistory=new RfHistory(), waterfallCaches=new Map();
const browserMicAvailable=()=>!!(window.isSecureContext&&navigator.mediaDevices?.getUserMedia&&window.AudioWorkletNode);
const meterSpecs = [
  ['level.STRENGTH','SIGNAL',v=>v>=0?'S9'+(v>0?' +'+Math.round(v):''):'S'+Math.max(0,Math.min(9,Math.round((v+54)/6))),v=>(v+54)/114],
  ['level.RFPOWER_METER_WATTS','RF OUTPUT',v=>v.toFixed(1)+' W',v=>v/100],
  ['level.SWR','SWR',v=>v.toFixed(1)+' : 1',v=>(v-1)/4],
  ['level.ALC','ALC',v=>(v*100).toFixed(1)+' %',v=>v],
  ['level.COMP_METER','COMPRESSION',v=>v.toFixed(1)+' dB',v=>v/20],
  ['level.VD_METER','SUPPLY',v=>v.toFixed(1)+' V',v=>v/16],
  ['level.ID_METER','DRAIN CURRENT',v=>v.toFixed(1)+' A',v=>v/25]
];
const gainSpecs = [['level.AF','AF gain (%)',100],['level.RF','RF gain (%)',100],['level.RFPOWER','RF power (W)',100],['level.MICGAIN','Mic gain (%)',100],['level.SQL','Squelch (%)',100],['level.IF','IF shift (Hz)',1]];
const gainPresets = [
  [{label:'Mute (0%)',val:0},{label:'10%',val:10},{label:'25%',val:25},{label:'50%',val:50},{label:'75%',val:75},{label:'100%',val:100}],
  [{label:'Min (0%)',val:0},{label:'25%',val:25},{label:'50%',val:50},{label:'75%',val:75},{label:'Max (100%)',val:100}],
  [{label:'5 W (QRP)',val:5},{label:'10 W',val:10},{label:'25 W',val:25},{label:'50 W',val:50},{label:'100 W (Max)',val:100}],
  [{label:'10%',val:10},{label:'25%',val:25},{label:'50%',val:50},{label:'75%',val:75},{label:'100%',val:100}],
  [{label:'Open (0%)',val:0},{label:'15%',val:15},{label:'30%',val:30},{label:'50%',val:50},{label:'Tight (100%)',val:100}],
  [{label:'-1000',val:-1000},{label:'-500',val:-500},{label:'Center (0)',val:0},{label:'+500',val:500},{label:'+1000',val:1000}]
];
const cycleSpecs = [['preamp','Preamp: IPO'],['dnr','DNR: Off'],['nb','NB: Off']];
const functionSpecs = [['func.ANF','Auto notch'],['func.APF','APF'],['func.MON','Monitor'],['func.COMP','Processor'],['func.VOX','VOX'],['func.LOCK','Dial lock'],['func.TUNER','Tuner']];
const meterElements = [], gainElements = [], cycleElements = [], functionElements = [], settingRows = new Map();
function element(tag, text, className) { const node = document.createElement(tag); if(text !== undefined) node.textContent=text; if(className) node.className=className; return node; }
function setText(node, text) { const value=String(text ?? ''); if(node.textContent!==value) node.textContent=value; }
function value(id, next) { const node=$(id); if(!dirty.has(id) && document.activeElement!==node && !edits.has(id)) node.value=String(next ?? ''); }
function notify(message, error=true) { clearTimeout(noticeTimer); $('notice').textContent=message; $('notice').classList.toggle('error',error); if(message) noticeTimer=setTimeout(()=>$('notice').textContent='',error?12000:4500); }
function protect(fn) { return (...args)=>{try{return Promise.resolve(fn(...args)).catch(e=>notify(e.message||String(e)));}catch(e){notify(e.message||String(e));}}; }
function updateRfCaptureButtons(rf=state?.rfScope||{}) {
  const status=rf.status||'RF capture is off';
  if(rfCaptureAction==='start'&&rf.running)rfCaptureAction='';
  else if(rfCaptureAction==='start'&&!rf.running&&status!==rfCaptureBaselineStatus&&!/opening|starting|waiting/i.test(status))rfCaptureAction='';
  else if(rfCaptureAction==='stop'&&!rf.running)rfCaptureAction='';
  if(!rfCaptureAction)clearTimeout(rfCaptureTimer);
  for(const [id,short] of [['rfCapture',false],['mobileRfCapture',true]]) {
    const button=$(id);if(!button)continue;
    const label=rfCaptureAction==='start'?(short?'Starting…':'Starting RF capture…'):rfCaptureAction==='stop'?(short?'Stopping…':'Stopping RF capture…'):rf.running?(short?'Stop':'Stop RF capture'):(short?'Start':'Start RF capture');
    setText(button,label);button.classList.toggle('selected',!!rf.running);button.disabled=!!rfCaptureAction;
    button.setAttribute('aria-label',rfCaptureAction?label:rf.running?'Stop RF capture':'Start RF capture');
  }
}
async function toggleRfCapture() {
  if(rfCaptureAction||!state)return;
  const action=state.rfScope?.running?'rfStop':'rfStart';rfCaptureAction=action==='rfStart'?'start':'stop';rfCaptureBaselineStatus=state.rfScope?.status||'';
  updateRfCaptureButtons();
  rfCaptureTimer=setTimeout(()=>{
    if(!rfCaptureAction)return;
    const pendingAction=rfCaptureAction;rfCaptureAction='';updateRfCaptureButtons();
    const status=state?.rfScope?.status||'No capture status received';
    notify(pendingAction==='start'?'RF capture did not start: '+status:'RF capture did not stop: '+status);
  },8000);
  try { await command(action); }
  catch(error) { rfCaptureAction='';clearTimeout(rfCaptureTimer);updateRfCaptureButtons();throw error; }
}
function command(action, fields={}, editKey) {
  if(!socket || socket.readyState!==WebSocket.OPEN || !state) return Promise.reject(new Error('Wait for the station connection'));
  const seq=String(++sequence), payload=new URLSearchParams({action,seq,generation:String(state.generation),...fields});
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ pending.delete(seq); if(editKey&&edits.get(editKey)?.seq===seq) edits.delete(editKey); reject(new Error('No command acknowledgement; check the station connection')); },10000);
    pending.set(seq,{resolve,reject,timer,editKey,sent:performance.now()}); if(editKey) edits.set(editKey,{seq,revision:null,until:Date.now()+12000}); socket.send(payload.toString());
  });
}
const preferenceIds=['connectionKind','endpoint','baud','stopBits','flow','poll','rfSpan','rfCat2Port','rfCat2Baud','rfWaterfallLevel'];
function readStationPreferences() {
    const fields={kind:$('connectionKind').value,endpoint:$('endpoint').value};
    for(const key of ['baud','stopBits','flow','poll'])fields[key]=$(key).value;
    fields.rfSpan=$('rfSpan').value;fields.rfCat2Port=$('rfCat2Port').value.trim();fields.rfCat2Baud=$('rfCat2Baud').value;
    const levelText=$('rfWaterfallLevel').value.trim(),level=Number(levelText);
    if(preferenceSaver?.versions.has('rfWaterfallLevel')&&(levelText===''||!Number.isFinite(level)||level < -30||level > 30||!Number.isInteger(level*2)))throw new Error('Waterfall level must be -30 to +30 dB in 0.5 dB steps');
    if(levelText!==''&&Number.isFinite(level)&&level>=-30&&level<=30&&Number.isInteger(level*2))fields.rfWaterfallLevel=level.toFixed(1);
    return fields;
}
function saveStationPreferencesSoon(event) {
  const key=event?.target?.id;if(!preferenceIds.includes(key))return;
  dirty.add(key);preferenceSaver.edit(key);
}
function subscribeScopes() {
  if(socket?.readyState===1)command('subscribe',{audio:activePage==='scope'&&!document.hidden?'1':'0',rf:['dashboard','rfScope'].includes(activePage)&&!document.hidden?'1':'0'}).catch(()=>{});
}
function scheduleScopes() {
  if(renderScheduled||document.hidden)return;renderScheduled=true;
  requestAnimationFrame(()=>{renderScheduled=false;const started=performance.now();drawScope();drawRfScope();renderCost=performance.now()-started;updateDiagnostics();});
}
function updateDiagnostics() {
  if(!$('diagnosticText')||!state)return;
  const rf=state.rfScope||{};
  setText($('diagnosticText'),`CAT: ${state.connection.endpoint} · last reply ${state.contactAge>=0?(state.contactAge/1000).toFixed(1)+' s ago':'unavailable'}\nRF: ${rf.running?(rf.frameValid?'live':'waiting / stale'):'stopped'} · age ${rf.age>=0?rf.age+' ms':'unavailable'}\nBrowser: ${socket?.readyState===1?'connected':'disconnected'} · command acknowledgement ${lastCommandMs.toFixed(0)} ms\nAudio: ${audioContext?.state||'off'} · session ${navigator.audioSession?.type||'system default'} / ${navigator.audioSession?.state||'unknown'}\nDraw: ${renderCost.toFixed(1)} ms · ${state.audio.refreshing?'refreshing devices':state.audio.receiveText}\nMicrophone: ${microphone?'armed':'disarmed'} · ${state.releasePending?'PTT release retry pending':'PTT release clear'}`);
}
function setting(id) { return state?.settings?.find(item=>item.id===id); }
function discreteLevel(item, maximum, normalized) {
  const value=Number(item?.value);if(!item?.valid||!Number.isFinite(value))return -1;
  return Math.max(0,Math.min(maximum,Math.round(value*(normalized?maximum:1))));
}
function cycleControlState(name) {
  if(name==='preamp'){
    const item=setting('level.PREAMP');if(!item?.valid)return {label:'Preamp: --',enabled:false,selected:false};
    const labels={'0':'IPO','10':'AMP1','20':'AMP2'};return {label:'Preamp: '+(labels[item.value]||item.value),enabled:!!item.writable,selected:item.value!=='0'};
  }
  const dnr=name==='dnr',functionItem=setting(dnr?'func.NR':'func.NB'),level=setting(dnr?'level.NR':'level.NB'),maximum=dnr?15:10;
  if(!functionItem?.valid)return {label:(dnr?'DNR':'NB')+': --',enabled:false,selected:false};
  const enabled=functionItem.value!=='0',amount=discreteLevel(level,maximum,dnr),label=enabled?(amount<0?'--':String(amount)):'Off';
  return {label:(dnr?'DNR':'NB')+': '+label,enabled:!!functionItem.writable&&!!level?.valid&&!!level.writable,selected:enabled};
}
async function cycleControl(name) {
  if(name==='preamp'){
    const item=setting('level.PREAMP');if(!item?.valid||!item.writable)throw new Error('Preamp readback is not available');
    const next=item.value==='0'?'10':item.value==='10'?'20':'0';return command('set',{setting:item.id,value:next});
  }
  const dnr=name==='dnr',functionItem=setting(dnr?'func.NR':'func.NB'),level=setting(dnr?'level.NR':'level.NB'),maximum=dnr?15:10;
  const amount=discreteLevel(level,maximum,dnr);
  if(!functionItem?.valid||!functionItem.writable||!level?.valid||!level.writable||amount<0)throw new Error((dnr?'DNR':'NB')+' readback is not available');
  if(functionItem.value==='0'){
    await command('set',{setting:level.id,value:dnr?String(1/15):'1'});
    return command('set',{setting:functionItem.id,value:'1'});
  }
  if(amount>=maximum)return command('set',{setting:functionItem.id,value:'0'});
  return command('set',{setting:level.id,value:dnr?String((amount+1)/maximum):String(amount+1)});
}
function editAcknowledged(key, revision) { const edit=edits.get(key); if(edit && ((edit.revision!==null && revision>=edit.revision) || Date.now()>edit.until)) { edits.delete(key); dirty.delete(key); } }
function optionList(node, entries, selected) {
  const signature=JSON.stringify(entries); if(node.dataset.options!==signature) { const previous=node.value;node.replaceChildren(...entries.map(([label,value])=>{const option=element('option',label);option.value=value;return option;}));node.dataset.options=signature;if(document.activeElement===node||dirty.has(node.id))node.value=previous; }
  if(document.activeElement!==node && !dirty.has(node.id)) node.value=String(selected ?? '');
}
function showPage(name) { activePage=name;if(name==='settings'&&state)renderSettings();document.querySelectorAll('.page').forEach(node=>node.hidden=node.id!==name);document.querySelectorAll('[data-page]').forEach(node=>node.classList.toggle('selected',node.dataset.page===name));subscribeScopes();scheduleScopes();const tab=document.querySelector(`[data-page="${name}"]`);if(tab&&window.matchMedia('(max-width: 650px)').matches)tab.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});window.scrollTo(0,0); }
function updateStickyNavigation(){const header=document.querySelector('.topbar'),notice=$('notice');if(!header||!notice)return;const headerHeight=Math.ceil(header.getBoundingClientRect().height),noticeHeight=notice.getBoundingClientRect().height;document.documentElement.style.setProperty('--topbar-height',headerHeight+'px');document.documentElement.style.setProperty('--section-tabs-top',headerHeight+noticeHeight+'px');}
function frequency(hz) { return Math.round(hz).toString().padStart(8,'0').replace(/(\d+)(\d{3})(\d{3})$/,'$1.$2.$3'); }
function parseFrequencyInput(input){let text=String(input).trim().toLowerCase().replace(/\s+/g,'');let multiplier=0;for(const [unit,scale]of [['mhz',1e6],['khz',1e3],['hz',1]])if(text.endsWith(unit)){text=text.slice(0,-unit.length);multiplier=scale;break;}const separators=(text.match(/[.,]/g)||[]).length;if(separators>1)text=text.replace(/[.,]/g,'');else text=text.replace(',','.');const match=text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/);if(!match)throw new Error('Enter a frequency such as 7.074 MHz, 7074 kHz, or 7074000 Hz');const value=Number(match[1]);if(!Number.isFinite(value))throw new Error('Enter a valid radio frequency');if(!multiplier)multiplier=value<=60?1e6:value<=60000?1e3:1;const hz=Math.round(value*multiplier);if(hz<30000||hz>60000000)throw new Error('Frequency must be between 0.030 and 60 MHz');return hz;}
function band(hz) { for(const [lo,hi,name] of [[1.8e6,2e6,'160 m'],[3.5e6,4e6,'80 m'],[5.25e6,5.45e6,'60 m'],[7e6,7.3e6,'40 m'],[10.1e6,10.15e6,'30 m'],[14e6,14.35e6,'20 m'],[18.068e6,18.168e6,'17 m'],[21e6,21.45e6,'15 m'],[24.89e6,24.99e6,'12 m'],[28e6,29.7e6,'10 m'],[50e6,54e6,'6 m']]) if(hz>=lo&&hz<=hi)return name;return 'General coverage'; }
function initializeCards() {
  for(const spec of meterSpecs) {
    const card=element('article',undefined,'panel meter-card'), title=element('span',spec[1],'meter-title'), output=element('output','--','meter-value'), bar=element('div',undefined,'meter-bar'), fill=element('i'), note=element('small','No live reading','meter-note');
    bar.append(fill);card.append(title,output,bar,note);$('meters').append(card);meterElements.push({output,fill,note});
  }
  gainSpecs.forEach((spec,index)=>{
    const card=element('div',undefined,'gain-card'), label=element('div',undefined,'gain-label'), title=element('b',spec[1]), readback=element('small','Radio: --');
    const sliderRow=element('div',undefined,'gain-slider-row');
    const slider=element('input');slider.type='range';slider.id='gainRange'+index;
    const [min,max,step] = index===2 ? [5,100,1] : index===5 ? [-1200,1200,20] : [0,100,1];
    slider.min=min;slider.max=max;slider.step=step;
    const inputGroup=element('div',undefined,'gain-input-group');
    const input=element('input');input.id='gain'+index;input.type='number';input.step='any';input.setAttribute('aria-label',spec[1]);input.addEventListener('input',()=>dirty.add(input.id));
    const button=element('button','Set');button.type='button';
    inputGroup.append(input,button);
    sliderRow.append(slider,inputGroup);

    const presetRow=element('div',undefined,'log-presets');
    const presets=gainPresets[index]||[];
    const presetButtons=[];
    presets.forEach(p=>{
      const btn=element('button',p.label,'log-btn');
      btn.type='button';
      btn.addEventListener('click',protect(async()=>{
        input.value=p.val;slider.value=p.val;dirty.delete(input.id);
        await command('set',{setting:spec[0],value:String(p.val/spec[2])},input.id);
      }));
      presetRow.append(btn);
      presetButtons.push({btn,val:p.val});
    });

    slider.addEventListener('change',protect(async()=>{
      input.value=slider.value;dirty.delete(input.id);
      await command('set',{setting:spec[0],value:String(Number(slider.value)/spec[2])},input.id);
    }));
    slider.addEventListener('input',()=>{input.value=slider.value;});

    button.addEventListener('click',protect(async()=>{
      slider.value=input.value;dirty.delete(input.id);
      await command('set',{setting:spec[0],value:String(Number(input.value)/spec[2])},input.id);
    }));

    input.addEventListener('keydown',protect(async event=>{
      if(event.key==='Enter'){
        event.preventDefault();slider.value=input.value;dirty.delete(input.id);
        await command('set',{setting:spec[0],value:String(Number(input.value)/spec[2])},input.id);
      }
    }));

    label.append(title,readback);
    card.append(label,sliderRow,presetRow);
    $('quickGains').append(card);
    gainElements.push({input,slider,button,readback,presetButtons});
  });
  cycleSpecs.forEach(([name,initial])=>{const button=element('button',initial);button.addEventListener('click',protect(()=>cycleControl(name)));$('functions').append(button);cycleElements.push({name,button});});
  functionSpecs.forEach(spec=>{const button=element('button',spec[1]);button.addEventListener('click',protect(()=>{const item=setting(spec[0]);return command('set',{setting:spec[0],value:item.value==='0'?'1':'0'});}));$('functions').append(button);functionElements.push(button);});
}

function getModeBadgeClass(mode){
  const m=String(mode||'').toUpperCase();
  if(m==='LSB')return 'mode-lsb';
  if(m==='USB')return 'mode-usb';
  if(m.startsWith('CW'))return 'mode-cw';
  if(m.startsWith('AM'))return 'mode-am';
  if(m.startsWith('FM'))return 'mode-fm';
  if(m.startsWith('DATA')||m.startsWith('PKT'))return 'mode-data';
  if(m.startsWith('RTTY')||m.startsWith('PSK'))return 'mode-rtty';
  return 'mode-usb';
}

const needleState={
  A:{current:0,target:0,velocity:0,mode:'S'},
  B:{current:0,target:0,velocity:0,mode:'S'}
};

function drawNeedleMeter(id,prop,mode){
  const canvas=$('needleCanvas'+id);
  if(!canvas)return;
  const dpr=window.devicePixelRatio||1;
  const logicalW=280, logicalH=115;
  if(canvas.width!==Math.round(logicalW*dpr)||canvas.height!==Math.round(logicalH*dpr)){
    canvas.width=Math.round(logicalW*dpr);
    canvas.height=Math.round(logicalH*dpr);
  }
  const ctx=canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,logicalW,logicalH);

  const cx=140, cy=180, rTop=150, rBot=120;
  const aStart=-34*Math.PI/180, aS9=4*Math.PI/180, aEnd=32*Math.PI/180;

  // Top S arc (White)
  ctx.beginPath();
  ctx.arc(cx,cy,rTop,-Math.PI/2+aStart,-Math.PI/2+aS9);
  ctx.strokeStyle='#ffffff';
  ctx.lineWidth=2;
  ctx.stroke();

  // Over S9 arc (+dB Blue)
  ctx.beginPath();
  ctx.arc(cx,cy,rTop,-Math.PI/2+aS9,-Math.PI/2+aEnd);
  ctx.strokeStyle='#3b82f6';
  ctx.lineWidth=2.5;
  ctx.stroke();

  // Red boundary tick at S9
  const s9Cos=Math.cos(-Math.PI/2+aS9), s9Sin=Math.sin(-Math.PI/2+aS9);
  ctx.beginPath();
  ctx.moveTo(cx+s9Cos*(rTop-10),cy+s9Sin*(rTop-10));
  ctx.lineTo(cx+s9Cos*(rTop+5),cy+s9Sin*(rTop+5));
  ctx.strokeStyle='#ef4444';
  ctx.lineWidth=2.2;
  ctx.stroke();

  ctx.textAlign='center';
  ctx.textBaseline='middle';

  // S Label
  ctx.font='italic bold 13px Consolas, ui-monospace, sans-serif';
  ctx.fillStyle='#ffffff';
  ctx.fillText('S',cx+Math.cos(-Math.PI/2+aStart-0.05)*(rTop+1),cy+Math.sin(-Math.PI/2+aStart-0.05)*(rTop+1));

  // S1 to S9 ticks
  const sTicks=[
    {a:-27*Math.PI/180,lbl:'1'},
    {a:-19*Math.PI/180,lbl:'3'},
    {a:-11*Math.PI/180,lbl:'5'},
    {a:-3*Math.PI/180,lbl:'7'},
    {a:3*Math.PI/180,lbl:'9'}
  ];
  ctx.font='bold 10px Consolas, ui-monospace, sans-serif';
  for(const t of sTicks){
    const cos=Math.cos(-Math.PI/2+t.a), sin=Math.sin(-Math.PI/2+t.a);
    ctx.beginPath();
    ctx.moveTo(cx+cos*(rTop-6),cy+sin*(rTop-6));
    ctx.lineTo(cx+cos*rTop,cy+sin*rTop);
    ctx.strokeStyle='#ffffff';
    ctx.lineWidth=1.2;
    ctx.stroke();
    ctx.fillStyle='#ffffff';
    ctx.fillText(t.lbl,cx+cos*(rTop+10),cy+sin*(rTop+10));
  }

  // +dB ticks
  const dbTicks=[
    {a:13*Math.PI/180,lbl:'+20'},
    {a:21*Math.PI/180,lbl:'+40'},
    {a:29*Math.PI/180,lbl:'+60'}
  ];
  ctx.font='bold 9px Consolas, ui-monospace, sans-serif';
  for(const t of dbTicks){
    const cos=Math.cos(-Math.PI/2+t.a), sin=Math.sin(-Math.PI/2+t.a);
    ctx.beginPath();
    ctx.moveTo(cx+cos*(rTop-6),cy+sin*(rTop-6));
    ctx.lineTo(cx+cos*rTop,cy+sin*rTop);
    ctx.strokeStyle='#3b82f6';
    ctx.lineWidth=1.4;
    ctx.stroke();
    ctx.fillStyle='#60a5fa';
    ctx.fillText(t.lbl,cx+cos*(rTop+10),cy+sin*(rTop+10));
  }
  ctx.font='italic bold 10px Consolas, ui-monospace, sans-serif';
  ctx.fillStyle='#60a5fa';
  ctx.fillText('dB',cx+Math.cos(-Math.PI/2+aEnd+0.04)*(rTop+14),cy+Math.sin(-Math.PI/2+aEnd+0.04)*(rTop+14));

  // Bottom Arc (COMP / Multi-meter)
  const aBotStart=-28*Math.PI/180, aBotEnd=26*Math.PI/180;
  ctx.beginPath();
  ctx.arc(cx,cy,rBot,-Math.PI/2+aBotStart,-Math.PI/2+aBotEnd);
  ctx.strokeStyle='rgba(255,255,255,0.6)';
  ctx.lineWidth=1.5;
  ctx.stroke();

  ctx.font='italic bold 9px Consolas, ui-monospace, sans-serif';
  ctx.fillStyle='#cbd5e1';
  ctx.fillText(mode==='PO'?'PO':'COMP',cx+Math.cos(-Math.PI/2+aBotStart-0.08)*(rBot-12),cy+Math.sin(-Math.PI/2+aBotStart-0.08)*(rBot-12));

  const compTicks=mode==='PO'?[
    {a:-25*Math.PI/180,lbl:'0'},
    {a:-12*Math.PI/180,lbl:'25'},
    {a:1*Math.PI/180,lbl:'50'},
    {a:14*Math.PI/180,lbl:'75'},
    {a:24*Math.PI/180,lbl:'100'}
  ]:[
    {a:-25*Math.PI/180,lbl:'0'},
    {a:-13*Math.PI/180,lbl:'5'},
    {a:-1*Math.PI/180,lbl:'10'},
    {a:11*Math.PI/180,lbl:'15'},
    {a:23*Math.PI/180,lbl:'20'}
  ];
  ctx.font='bold 9px Consolas, ui-monospace, sans-serif';
  for(const t of compTicks){
    const cos=Math.cos(-Math.PI/2+t.a), sin=Math.sin(-Math.PI/2+t.a);
    ctx.beginPath();
    ctx.moveTo(cx+cos*(rBot-5),cy+sin*(rBot-5));
    ctx.lineTo(cx+cos*rBot,cy+sin*rBot);
    ctx.strokeStyle='rgba(255,255,255,0.6)';
    ctx.lineWidth=1;
    ctx.stroke();
    ctx.fillStyle='#e2e8f0';
    ctx.fillText(t.lbl,cx+cos*(rBot-11),cy+sin*(rBot-11));
  }
  ctx.font='italic 8px Consolas, ui-monospace, sans-serif';
  ctx.fillStyle='#cbd5e1';
  ctx.fillText(mode==='PO'?'W':'dB',cx+Math.cos(-Math.PI/2+aBotEnd+0.06)*(rBot-10),cy+Math.sin(-Math.PI/2+aBotEnd+0.06)*(rBot-10));

  // Smooth Analog Needle
  const clampedProp=Math.max(0,Math.min(1.05,prop));
  const needleAngle=aStart+clampedProp*(aEnd-aStart);
  const nCos=Math.cos(-Math.PI/2+needleAngle), nSin=Math.sin(-Math.PI/2+needleAngle);

  ctx.beginPath();
  ctx.moveTo(cx+nCos*30,cy+nSin*30);
  ctx.lineTo(cx+nCos*(rTop+5),cy+nSin*(rTop+5));
  ctx.strokeStyle='#ef4444';
  ctx.lineWidth=2;
  ctx.shadowColor='rgba(239,68,68,0.6)';
  ctx.shadowBlur=5;
  ctx.stroke();

  ctx.shadowBlur=0;
  ctx.restore();
}

let needleAnimId=null;
function startNeedleLoop(){
  if(needleAnimId)return;
  const tension=0.088, damping=0.77;
  function frame(){
    for(const id of ['A','B']){
      const n=needleState[id];
      const force=(n.target-n.current)*tension;
      n.velocity=(n.velocity+force)*damping;
      n.current+=n.velocity;
      drawNeedleMeter(id,n.current,n.mode);
    }
    needleAnimId=requestAnimationFrame(frame);
  }
  needleAnimId=requestAnimationFrame(frame);
}
startNeedleLoop();

function render(next) {
  const previous=state;state=next;const live=state.online&&!state.busy, tx=state.pttKnown&&state.transmitting;
  if(previous && previous.generation!==state.generation) { edits.clear();for(const key of [...dirty])if(!preferenceSaver?.versions.has(key))dirty.delete(key);tuningQueue?.clear();stopClientAudio();scopeRows=[];scopeBins=null;scopePeaks=null;scopeGeneration=-1;rfHistory.clear();rfRows=[];rfBins=null; }
  const off=(state.poweredOff||state.standby)&&!state.busy,status=off?'Powered off':state.status;
  const error=off&&state.error?.startsWith('Frequency read:')?'':state.error;
  $('login').hidden=true;$('app').hidden=false;$('app').inert=false;$('mobilePttBar').hidden=false;setText($('connectionStatus'),status+(state.demo?' · DEMO':''));setText($('footerStatus'),error||(off?status:`${status} · ${state.pttKnown?(tx?'TX':'RX'):'TX status unknown'} · ${state.settings.length} driver settings`));
  if(off&&$('notice').textContent.startsWith('Frequency read:'))notify('');
  if(error && error!==previous?.error) notify(error);
  const owned=state.dashboardPtt||state.pttPending;
  $('ptt').classList.toggle('active',owned||state.releasePending);setText($('ptt'),state.releasePending?'Retrying PTT release…':owned?(state.pttPending&&!state.dashboardPtt?'Starting TX…':'PTT off'):tx?'External TX':'PTT on');$('ptt').disabled=!owned&&!state.releasePending&&(!live||!state.canPtt||!state.pttKnown||tx);
  const active=state.vfos[state.activeVfo==='B'?1:0], frequencyText=active.frequencyValid?frequency(active.frequency):'Frequency unavailable';
  setText($('mobileTxStatus'),!state.portOpen?'Connect to radio':state.busy?'Connecting to radio…':off?'Radio powered off':tx?'TRANSMITTING · tap PTT to unkey':`RX · ${frequencyText}`);
  const radioOn = live && !off;
  const powerBtn = $('powerToggle');
  if(powerBtn){
    powerBtn.classList.toggle('active', radioOn);
    powerBtn.classList.toggle('off', !radioOn);
    setText($('powerText'), radioOn ? 'Power ON' : 'Power OFF');
    powerBtn.disabled = radioOn ? (!live || !state.canPower) : (!state.portOpen || state.busy || !state.canPower || state.transmitting || state.releasePending);
  }
  const connection=state.connection;
  setText($('connectionSummary'),`${state.portOpen?(off?'Powered off':'Connected'):'Not connected'} · ${connection.endpoint||'Choose an endpoint'}`);
  if($('connectionBtnText')){
    setText($('connectionBtnText'),state.portOpen?(off?'Standby':'Connected'):'Connect');
    $('openConnection')?.classList.toggle('active',Boolean(state.portOpen&&!off));
  }
  value('connectionKind',connection.kind);for(const key of ['endpoint','baud','stopBits','flow','poll'])value(key,connection[key]);
  for(const id of ['connectionKind','endpoint','baud','stopBits','flow','poll'])$(id).disabled=state.portOpen||state.busy;
  $('endpoint').disabled=state.portOpen||state.busy||connection.kind===2;$('connectRadio').disabled=state.busy;setText($('connectRadio'),state.portOpen?'Disconnect':state.busy?'Opening…':'Connect');
  if(!dirty.has('shareEnabled'))$('shareEnabled').checked=state.sharing.wanted;value('sharePort',state.sharing.port);$('shareEnabled').disabled=connection.kind===1;$('saveSharing').disabled=connection.kind===1||state.busy;
  setText($('sharingStatus'),state.sharing.error||(state.sharing.running?`127.0.0.1:${state.sharing.port} · ${state.sharing.clients} Hamlib clients`:'CAT sharing inactive'));
  const curStep = Number(localStorage.getItem('step') || $('step')?.value || '100');
  const stepLabel = (curStep >= 1e6 ? (curStep/1e6)+' MHz' : curStep >= 1e3 ? (curStep/1e3)+' kHz' : curStep+' Hz') + ' step';
  ['A','B'].forEach((name,index)=>{
    const vfo=state.vfos[index];
    setText($('freq'+name),vfo.frequencyValid?frequency(vfo.frequency):'--.---.---');
    setText($('mode'+name),vfo.modeValid?vfo.mode:'--');
    const modeBtn=$('mode'+name);
    if(modeBtn&&vfo.modeValid){modeBtn.className='mode-badge-pill '+getModeBadgeClass(vfo.mode);}
    setText($('width'+name),vfo.modeValid?vfo.width+' Hz filter':'-- Hz filter');
    setText($('band'+name),vfo.frequencyValid?band(vfo.frequency):'-- m');
    const isActive=state.online&&state.activeVfo===name;
    $('card'+name).classList.toggle('active',isActive);
    if($('step'+name)){
      setText($('step'+name),stepLabel);
      $('step'+name).style.display=isActive?'inline-flex':'none';
    }
  });
  editAcknowledged('controlVfo',state.vfoRevision);value('controlVfo',state.activeVfo);const index=$('controlVfo').value==='B'?1:0,vfo=state.vfos[index];
  editAcknowledged('frequency',vfo.frequencyRevision);editAcknowledged('mode',vfo.modeRevision);editAcknowledged('width',vfo.modeRevision);
  value('frequency',vfo.frequencyValid?(vfo.frequency/1e6).toFixed(6):'');optionList($('mode'),state.modes.map(mode=>[mode,mode]),vfo.modeValid?vfo.mode:'');value('width',vfo.modeValid?vfo.width:'');
  for(const id of ['frequency','mode','width','controlVfo','up','down'])$(id).disabled=!live;
  document.querySelectorAll('[data-vfo],[data-action="swap"],[data-action="copy"]').forEach(node=>node.disabled=!live);
  meterSpecs.forEach(([id,title,format,proportion],idx)=>{
    let item=setting(id),raw=Number(item?.value),valid=live&&item?.valid&&item.age<=2000&&(!item.txOnly||tx),note=item?.status||'Unavailable';
    if(idx===1&&!item){item=setting('level.RFPOWER_METER');raw=Number(item?.value)*100;valid=live&&item?.valid&&item.age<=2000&&tx;}
    if(!Number.isFinite(raw))valid=false;if(item?.txOnly&&!tx)note=state.pttKnown?'TX only':'TX status unavailable';else if(item?.age>2000)note='Stale / waiting for CAT';
    if(idx===1){const power=setting('level.RFPOWER');if(power?.valid)note=(valid?'Measured · set ':'TX only · set ')+Math.round(Number(power.value)*100)+' W';}
    if(idx===3&&valid)note='ALC reference scale';if(idx===0&&valid)note=raw+' dB relative to S9';
    const elements=meterElements[idx];if(elements){setText(elements.output,valid?format(raw):'--');setText(elements.note,note);elements.fill.style.width=(valid?Math.max(0,Math.min(1,proportion(raw)))*100:0)+'%';elements.output.style.color=idx===2&&raw>=3&&valid?'var(--red)':idx===2&&raw>=2&&valid?'var(--amber)':'var(--mint)';}
  });

  // Calculate live values for Yaesu meters
  const sigItem=setting('level.STRENGTH'),sigRaw=Number(sigItem?.value),sigValid=live&&sigItem?.valid&&sigItem.age<=2000&&!tx;
  const sigProp=sigValid&&Number.isFinite(sigRaw)?Math.max(0,Math.min(1,(sigRaw+54)/114)):0;

  let pwrItem=setting('level.RFPOWER_METER_WATTS')||setting('level.RFPOWER_METER'),pwrRaw=Number(pwrItem?.value);
  if(pwrItem?.id==='level.RFPOWER_METER')pwrRaw*=100;
  const pwrValid=live&&pwrItem?.valid&&pwrItem.age<=2000&&tx;
  const pwrProp=pwrValid&&Number.isFinite(pwrRaw)?Math.max(0,Math.min(1,pwrRaw/100)):0;
  const pwrVal=pwrValid?pwrRaw.toFixed(1)+' W':'--';

  const swrItem=setting('level.SWR'),swrRaw=Number(swrItem?.value),swrValid=live&&swrItem?.valid&&swrItem.age<=2000&&tx;
  const swrVal=swrValid?swrRaw.toFixed(1):'--';

  const alcItem=setting('level.ALC'),alcRaw=Number(alcItem?.value),alcValid=live&&alcItem?.valid&&alcItem.age<=2000&&tx;
  const alcVal=alcValid?(alcRaw*100).toFixed(0)+'%':'--';

  const compItem=setting('level.COMP_METER'),compRaw=Number(compItem?.value),compValid=live&&compItem?.valid&&compItem.age<=2000&&tx;
  const compVal=compValid?compRaw.toFixed(1)+' dB':'--';

  const idItem=setting('level.ID_METER'),idRaw=Number(idItem?.value),idValid=live&&idItem?.valid&&idItem.age<=2000&&tx;
  const idVal=idValid?idRaw.toFixed(1)+' A':'--';

  ['A','B'].forEach(name=>{
    const isActive=state.online&&state.activeVfo===name;
    if(isActive){
      needleState[name].target=tx?pwrProp:sigProp;
      needleState[name].mode=tx?'PO':'S';
    }else{
      needleState[name].target=0;
      needleState[name].mode='S';
    }
    setText($('microPo'+name),'PO '+(pwrValid?pwrVal:'--'));
    setText($('microSwr'+name),'SWR '+(swrValid?swrVal:'--'));
    setText($('microAlc'+name),'ALC '+(alcValid?alcVal:'--'));
    setText($('microComp'+name),'COMP '+(compValid?compVal:'--'));
    setText($('microId'+name),'ID '+(idValid?idVal:'--'));
  });
  gainSpecs.forEach(([id,label,scale],index)=>{
    const item=setting(id),elements=gainElements[index];
    editAcknowledged(elements.input.id,item?.revision||0);
    if(item?.valid){
      const raw=Number(item.value)*scale;
      const roundedVal=scale===100?Math.round(raw):raw;
      value(elements.input.id,roundedVal);
      if(elements.slider&&document.activeElement!==elements.slider)elements.slider.value=roundedVal;
      setText(elements.readback,'Radio: '+roundedVal+(index===2?' W':index===5?' Hz':' %'));
      elements.presetButtons?.forEach(p=>{
        p.btn.classList.toggle('active',Math.abs(p.val-roundedVal)<0.5);
      });
    }else{
      value(elements.input.id,'');
      if(elements.slider)elements.slider.value=0;
      setText(elements.readback,'Radio: --');
      elements.presetButtons?.forEach(p=>p.btn.classList.remove('active'));
    }
    const disabled=!live||!item?.valid||!item.writable;
    elements.input.disabled=elements.button.disabled=disabled;
    if(elements.slider)elements.slider.disabled=disabled;
    elements.presetButtons?.forEach(p=>{p.btn.disabled=disabled;});
  });
  setText($('gainVfo'),'RF power / meters: shared · Gains: '+state.settingsVfo);
  cycleElements.forEach(({name,button})=>{const current=cycleControlState(name);setText(button,current.label);button.disabled=!live||!current.enabled;button.classList.toggle('selected',current.selected);});
  functionSpecs.forEach(([id],index)=>{const item=setting(id),button=functionElements[index];button.disabled=!live||!item?.valid||!item.writable;button.classList.toggle('selected',!!item?.valid&&item.value!=='0');});
  value('settingsVfo',state.settingsVfo);if(activePage==='settings')renderSettings();renderAudio();
  const log=state.activity.join('\n'),pre=$('activityLog'),bottom=pre.scrollHeight-pre.scrollTop-pre.clientHeight<30;if(pre.textContent!==log){pre.textContent=log;if(bottom)pre.scrollTop=pre.scrollHeight;}
  $('catQuery').disabled=$('catWrite').disabled=!live||state.demo||connection.kind!==0;
  setText($('scopeStatus'),state.scope.generated?'DEMO / GENERATED AUDIO · no radio audio device is open':!state.online?'Connect the radio and enable Receive audio':tx?'Paused during TX · earlier waterfall history retained':state.scope.fresh?'Live receive audio · source: '+(state.audio.devices.find(device=>device.id===state.audio.maps[0])?.name||'radio receive'):'Waiting for receive samples · '+state.audio.receiveText);
  const rf=state.rfScope||{};
  const rfStatus=rf.status||'RF capture is off';if(previous?.rfScope&& !rf.running&&rfStatus!==previous.rfScope.status&&!/stopped|off/i.test(rfStatus))notify('RF capture: '+rfStatus);
  setText($('rfStatus'),rfStatus);updateRfCaptureButtons(rf);
  if(rf.requestedSpanIndex>=0&&rf.requestedSpanIndex<=9&&!dirty.has('rfSpan')&&document.activeElement!==$('rfSpan'))$('rfSpan').value=String(rf.requestedSpanIndex);
  if(rf.cat2Port!==undefined&&!dirty.has('rfCat2Port')&&document.activeElement!==$('rfCat2Port'))$('rfCat2Port').value=rf.cat2Port;
  if(rf.cat2Baud!==undefined&&!dirty.has('rfCat2Baud')&&document.activeElement!==$('rfCat2Baud'))$('rfCat2Baud').value=rf.cat2Baud;
  if(rf.levelDb!==undefined&&!dirty.has('rfWaterfallLevel')&&document.activeElement!==$('rfWaterfallLevel'))$('rfWaterfallLevel').value=Number(rf.levelDb).toFixed(1);
  $('rfApplySpan').disabled=!!rf.applying;setText($('rfApplyStatus'),rf.applyStatus||'');scheduleScopes();
  if(microphone&&(!state.online||!state.audio.microphoneWanted||state.audio.maps[2]!=='browser:capture'))stopMicrophone();
  audioNode?.port.postMessage({kind:'gate',enabled:!!(microphone&&tx&&state.dashboardPtt&&state.browserOwner===client),lease:state.micLease||0});
  audioNode?.port.postMessage({kind:'listen',enabled:listening&&!tx&&state.online&&state.pttKnown});
  if(!state.scope.fresh&&!scopeFrozen)scopeBins=null;scheduleScopes();updateDiagnostics();
}
function renderSettings() {
  const query=$('settingFilter').value.toLowerCase(),alive=new Set();let count=0;
  for(const item of state.settings){alive.add(item.id);let row=settingRows.get(item.id);if(!row){row=element('tr');for(let i=0;i<5;i++)row.append(element('td'));const cell=element('td'),button=element('button','Edit'),access=element('span','Read only');button.addEventListener('click',()=>openSetting(item.id));cell.append(button,access);row.append(cell);row.editButton=button;row.accessLabel=access;row.addEventListener('dblclick',()=>openSetting(item.id));settingRows.set(item.id,row);$('settingRows').append(row);}const cells=row.children;setText(cells[0],item.name);setText(cells[1],item.group);setText(cells[2],item.valid?item.display:'--');setText(cells[3],item.range);setText(cells[4],item.status+(item.valid?` · ${(item.age/1000).toFixed(1)} s`:''));row.editButton.disabled=!state.online||state.busy||!item.writable;row.editButton.hidden=!item.writable;row.accessLabel.hidden=item.writable;row.hidden=!!query&&!`${item.id} ${item.name} ${item.group}`.toLowerCase().includes(query);if(!row.hidden)count++;}
  for(const [id,row]of settingRows)if(!alive.has(id)){row.remove();settingRows.delete(id);}setText($('settingCount'),`${count} / ${state.settings.length} settings`);
}
function openSetting(id) {
  const item=setting(id);if(!item?.writable||!state.online)return;selectedSetting=id;setText($('settingTitle'),item.name);setText($('settingDescription'),item.description);setText($('settingReadback'),'Radio: '+(item.valid?item.display:'unavailable'));setText($('settingRange'),item.range+' · '+item.units);
  const choices=item.type==='boolean'?[['Off','0'],['On','1']]:item.choices.map((label,i)=>[label,item.choiceValues[i]??label]);$('settingChoices').hidden=!choices.length;$('settingValue').hidden=!!choices.length;
  if(choices.length)optionList($('settingChoices'),choices,item.valid?item.value:choices[0][1]);else{$('settingValue').value=item.valid?item.value:'';$('settingValue').type=item.type==='text'?'text':'number';$('settingValue').step=item.step||'any';if(item.bounded){$('settingValue').min=item.minimum;$('settingValue').max=item.maximum;}else{$('settingValue').removeAttribute('min');$('settingValue').removeAttribute('max');}}
  $('settingDialog').showModal();
}
function renderAudio() {
  const a=state.audio;setText($('audioError'),a.error);
  $('unattended').checked=!!a.unattended;
  setText($('hostReceiveState'),a.receiveWanted?'On':'Off');setText($('hostMicrophoneState'),a.microphoneWanted?'On':'Off');
  for(let slot=0;slot<4;slot++){const input=slot===0||slot===2,radio=slot===0||slot===3;const devices=a.devices.filter(device=>device.input===input&&(!radio||!device.remote));const entries=[['Choose a device',''],...devices.map(device=>[device.name,device.id])];if(a.maps[slot]&&!devices.some(device=>device.id===a.maps[slot]))entries.push(['Saved device unavailable / reconnect',a.maps[slot]]);optionList($('audioMap'+slot),entries,a.maps[slot]);}
  for(const [id,wanted,label]of [['receiveRoute',a.receiveWanted,'Receive audio'],['scopeReceive',a.receiveWanted,'Receive audio'],['microphoneRoute',a.microphoneWanted,'Microphone']]){setText($(id),label+': '+(wanted?'On':'Off'));$(id).classList.toggle('selected',wanted);$(id).disabled=!wanted&&(!state.online||state.demo||state.busy);}
  setText($('receiveStatus'),a.receiveText);setText($('microphoneStatus'),a.microphoneText);value('receiveLevel',a.receiveLevel);value('microphoneLevel',a.microphoneLevel);value('pttLimit',a.pttLimit);
  for(const [id,amount]of [['receiveInput',a.inputPeak],['receiveOutput',a.outputPeak],['microphoneInput',a.micInputPeak],['microphoneOutput',a.micOutputPeak]])$(id).value=Math.min(1,Math.max(0,amount));
  $('listen').classList.toggle('selected',listening);setText($('listen'),listening?'Stop listening':'Listen in this browser');$('listen').disabled=listeningBusy;$('microphone').classList.toggle('selected',microphone);setText($('microphone'),microphone?'Disarm browser microphone':!browserMicAvailable()?'Browser microphone unavailable':microphoneBusy?'Waiting for microphone…':'Arm browser microphone');$('microphone').disabled=microphoneBusy||!browserMicAvailable();
}
function reconnect() {
  if(closing)return;clearTimeout(reconnectTimer);
  reconnectTimer=setTimeout(async()=>{try{const reply=await fetch('/api/state',{signal:AbortSignal.timeout(6000)});if(reply.status===401){$('login').hidden=false;$('app').hidden=true;return;}if(!reply.ok)throw new Error('Station unavailable');connectWeb();}catch{reconnectDelay=Math.min(10000,reconnectDelay*1.5);reconnect();}},reconnectDelay);
}
async function connectWeb() {
  if(closing)return;clearTimeout(reconnectTimer);clearInterval(heartbeat);let receivedState=false;const proto=location.protocol==='https:'?'wss:':'ws:';const connection=new WebSocket(`${proto}//${location.host}/ws`);socket=connection;socket.binaryType='arraybuffer';
  socket.onopen=()=>{if(socket!==connection)return;reconnectDelay=2000;subscribeScopes();heartbeat=setInterval(()=>{if(connection.readyState===1)connection.send(new URLSearchParams({action:'heartbeat'}).toString());},2000);};
  socket.onmessage=event=>{
    if(socket!==connection)return;
    if(typeof event.data!=='string'){binary(event.data);return;}
    const data=JSON.parse(event.data);
    if(data.type==='delta'){if(!state)return;render(mergeState(state,data));return;}
    if(data.type==='hello'){client=data.client;return;}if(data.type==='state'){render(data);if(!receivedState){receivedState=true;subscribeScopes();preferenceSaver?.flush();}return;}
    if(data.type==='error'){notify(data.error);return;}
    if(data.type==='ack'){const waiting=pending.get(data.seq);if(!waiting)return;lastCommandMs=performance.now()-waiting.sent;clearTimeout(waiting.timer);pending.delete(data.seq);const edit=edits.get(waiting.editKey);if(data.ok){if(edit?.seq===data.seq)edit.revision=data.revision||0;waiting.resolve(data);}else{if(edit?.seq===data.seq)edits.delete(waiting.editKey);waiting.reject(new Error(data.error));}}
  };
  socket.onclose=()=>{if(socket!==connection)return;clearInterval(heartbeat);tuningQueue?.clear();stopClientAudio();for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Station connection lost'));}pending.clear();edits.clear();client=0;$('ptt').disabled=true;if($('powerToggle'))$('powerToggle').disabled=true;$('app').inert=true;setText($('connectionStatus'),'Browser disconnected · readings paused');setText($('footerStatus'),'Connection lost · controls paused · browser audio stopped');if(!scopeFrozen){scopeBins=null;scheduleScopes();}if(!closing){notify('Station connection lost. Browser audio stopped; reconnecting…');reconnect();}};
  socket.onerror=()=>{};
}
function audioSessionType(capturing=false) {
  try { if(navigator.audioSession)navigator.audioSession.type=capturing||(listening&&$('stableAudio')?.checked)?'play-and-record':'playback'; }catch{}
}
function audioInterrupted(message) {
  if(state?.browserOwner===client)command('ptt',{enabled:'0'}).catch(()=>{});
  stopMicrophone();setText($('browserStatus'),message);$('resumeAudio').hidden=false;updateDiagnostics();
}
async function ensureAudio() {
  if(!window.AudioContext)throw new Error('This browser does not support Web Audio playback');
  if(!audioContext){audioContext=new AudioContext({latencyHint:'interactive',sampleRate:48000});const context=audioContext;const resumed=context.resume();audioSetup=(async()=>{await resumed;if(isSecureContext&&window.AudioWorkletNode&&context.audioWorklet){await context.audioWorklet.addModule('/audio-worklet.js');audioNode=new AudioWorkletNode(context,'station-audio',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});audioNode.supportsMicrophone=true;}else audioNode=new StationPlayback(context);listeningGain=context.createGain();listeningGain.gain.value=Number($('browserVolume').value)/100;audioNode.connect(listeningGain).connect(context.destination);if(isSecureContext&&context.setSinkId&&$('browserOutput').value)await context.setSinkId($('browserOutput').value);audioNode.port.onmessage=({data})=>{if(data.kind==='mic'&&microphone&&socket?.readyState===1&&socket.bufferedAmount<8192)socket.send(data.buffer);if(data.kind==='peak')$('clientMicPeak').value=data.value;};})().catch(async error=>{await context.close().catch(()=>{});if(audioContext===context){audioContext=audioNode=listeningGain=audioSetup=null;}throw error;});}
  await audioSetup;
  audioContext.onstatechange=()=>{updateDiagnostics();if(['interrupted','suspended','closed'].includes(audioContext.state)&&(microphone||microphoneBusy))audioInterrupted('Audio interrupted. Tap Resume audio, then arm the microphone again.');};
  await audioContext.resume();
}
async function ensureReceive() {
  if(!state.online||state.demo)throw new Error('Connect the physical radio before enabling audio');
  if(!state.audio.maps[0])throw new Error('Choose the radio USB recording device first');
  if(!state.audio.maps[1])await command('audioMap',{slot:'1',device:'browser:playback'});
  if(!state.audio.receiveWanted)await command('audioRoute',{route:'receive',enabled:'1'});
}
async function listen() {
  if(listeningBusy)return;listeningBusy=true;const epoch=audioEpoch;renderAudio();
  try{if(listening){listening=false;audioNode?.port.postMessage({kind:'listen',enabled:false});await command('listen',{enabled:'0'});setText($('browserStatus'),'Listening stopped.');}
  else{if($('stableAudio')?.checked){try{if(navigator.audioSession)navigator.audioSession.type='play-and-record';}catch{}}await ensureAudio();await ensureReceive();await command('listen',{enabled:'1'});if(epoch!==audioEpoch||socket?.readyState!==1)throw new Error('Connection changed; enable listening again');listening=true;expectedAudio=undefined;audioSessionType();audioNode.port.postMessage({kind:'listen',enabled:!state.transmitting});setText($('browserStatus'),'Listening to radio receive audio in this browser.');}}
  finally{listeningBusy=false;renderAudio();}
}
function stopMicrophone() { ++audioEpoch;microphone=false;audioNode?.port.postMessage({kind:'gate',enabled:false,lease:0});micSource?.disconnect();micSource=null;micStream?.getTracks().forEach(track=>track.stop());micStream=null;if(micRegistered){micRegistered=false;command('browserMic',{enabled:'0'}).catch(()=>{});}audioSessionType();$('clientMicPeak').value=0;if(state)renderAudio(); }
function stopClientAudio() { listening=false;stopMicrophone();audioNode?.port.postMessage({kind:'listen',enabled:false});audioNode?.port.postMessage({kind:'reset'});expectedAudio=undefined;setText($('browserStatus'),'Browser audio stopped.');if(state)renderAudio(); }
async function armMicrophone() {
  if(microphone){if(state.browserOwner===client)await command('ptt',{enabled:'0'});stopMicrophone();setText($('browserStatus'),'Browser microphone disarmed.');return;}
  if(!browserMicAvailable())throw new Error('Microphone capture needs a supported browser and trusted HTTPS. Install and trust the station certificate, then open this page in Safari or another current browser.');
  if(!state.online||state.demo||!state.audio.maps[3])throw new Error('Connect the radio and choose its USB transmit playback device first');
  if(microphoneBusy)return;microphoneBusy=true;const epoch=audioEpoch,owner=client;renderAudio();
  try{audioSessionType(true);await ensureAudio();const device=$('browserInput').value;const stream=await navigator.mediaDevices.getUserMedia({audio:{...(device?{deviceId:{exact:device}}:{}),channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});micStream=stream;if(epoch!==audioEpoch||owner!==client||socket?.readyState!==1||!state.online)throw new Error('Connection changed; arm the microphone again');await command('audioMap',{slot:'2',device:'browser:capture'});await command('browserMic',{enabled:'1'});micRegistered=true;if(epoch!==audioEpoch||owner!==client||socket?.readyState!==1||!state.online)throw new Error('Connection changed; arm the microphone again');for(const track of stream.getAudioTracks()){track.addEventListener('ended',()=>audioInterrupted('Microphone disconnected. Choose a device and arm it again.'),{once:true});track.addEventListener('mute',()=>audioInterrupted('Microphone interrupted. Tap Resume audio and arm it again.'),{once:true});}await audioContext.resume();micSource=audioContext.createMediaStreamSource(stream);micSource.connect(audioNode);microphone=true;audioNode.port.postMessage({kind:'gate',enabled:!!(state.transmitting&&state.dashboardPtt&&state.browserOwner===client),lease:state.micLease||0});setText($('browserStatus'),'Microphone armed. Tap PTT on to transmit, then PTT off.');browserDevices().catch(error=>notify(error.message));}
  catch(error){stopMicrophone();throw error;}
  finally{microphoneBusy=false;renderAudio();}
}
async function browserDevices() {
  if(!navigator.mediaDevices?.enumerateDevices)throw new Error('Browser device selection is unavailable. Check HTTPS certificate trust and browser permissions; use the phone or OS controls for its speaker or headset.');const devices=await navigator.mediaDevices.enumerateDevices();
  for(const [id,kind]of [['browserInput','audioinput'],['browserOutput','audiooutput']]){const current=$(id).value;const entries=[['System default',''],...devices.filter(device=>device.kind===kind&&device.deviceId&&device.deviceId!=='default').map((device,index)=>[device.label||`${kind==='audioinput'?'Microphone':'Output'} ${index+1}`,device.deviceId])];if(current&&!entries.some(entry=>entry[1]===current))entries.push(['Saved device unavailable / allow access',current]);optionList($(id),entries,current);}
  const sink=!!(isSecureContext&&(audioContext?.setSinkId||window.AudioContext?.prototype.setSinkId));$('browserOutput').disabled=!sink;setText($('outputSupport'),sink?'Browser output selection is available.':'This browser uses the device’s system audio output. Change the speaker/headset in the phone or OS controls.');
}
function binary(buffer) {
  const header=new DataView(buffer);if(buffer.byteLength<8)return;const type=header.getUint32(0,true);
  if(type===1&&listening&&audioNode){const sequence=header.getUint32(4,true),pcm=new Int16Array(buffer,8),samples=new Float32Array(pcm.length);for(let i=0;i<pcm.length;i++)samples[i]=pcm[i]/32768;const reset=expectedAudio!==undefined&&expectedAudio!==sequence;expectedAudio=(sequence+pcm.length)>>>0;audioNode.port.postMessage({kind:'rx',samples,reset},[samples.buffer]);}
  if(type===2&&buffer.byteLength===12+2049*4){const rate=header.getUint32(4,true),generation=header.getUint32(8,true);if(generation!==scopeGeneration){clearScope();scopeGeneration=generation;}scopeRate=rate;if(!scopeFrozen){const bins=new Float32Array(buffer,12).slice();if(scopeBins)for(let i=0;i<bins.length;i++)bins[i]=10*Math.log10(.55*Math.pow(10,scopeBins[i]/10)+.45*Math.pow(10,bins[i]/10));scopeBins=bins;const raw=new Float32Array(buffer,12).slice();if(scopePeakHold){if(!scopePeaks)scopePeaks=raw.slice();else for(let i=0;i<raw.length;i++)scopePeaks[i]=Math.max(scopePeaks[i],raw[i]);}scopeRows.unshift({bins:raw,time:performance.now()});if(scopeRows.length>300)scopeRows.pop();scheduleScopes();}}
  if(type===4&&buffer.byteLength===20+850){const center=header.getUint32(4,true),span=header.getUint32(8,true),generation=header.getUint32(12,true),seq=header.getUint32(16,true),bins=new Uint8Array(buffer.slice(20));if(rfHistory.push(center,span,generation,seq,bins)){rfCenterHz=center;rfSpanHz=span;rfBins=bins;rfRows=rfHistory.rows;scheduleScopes();}}
}
let scopeRate=48000,scopeGeneration=-1,scopeBins=null,scopePeaks=null,scopeRows=[],scopeFrozen=false,scopePeakHold=false;
let rfCenterHz=0,rfSpanHz=200000,rfBins=null,rfRows=[];
const palette=[[8,16,29],[24,45,116],[24,128,189],[52,213,181],[255,202,83],[255,92,75]];
const rfPalette=[[5,8,30],[27,25,108],[22,79,184],[0,170,216],[37,220,151],[236,231,74],[255,121,35],[255,246,220]];
function lookupPalette(stops,size){const result=new Uint8ClampedArray(size*4);for(let i=0;i<size;i++){const p=i/(size-1)*(stops.length-1),index=Math.min(stops.length-2,Math.floor(p)),part=p-index;for(let c=0;c<3;c++)result[i*4+c]=Math.round(stops[index][c]+part*(stops[index+1][c]-stops[index][c]));result[i*4+3]=255;}return result;}
const audioColors=lookupPalette(palette,1024),rfColors=lookupPalette(rfPalette,256);
function waterfallImage(key,width,height,rows,signature,pixel){
  let cache=waterfallCaches.get(key);const reset=!cache||cache.width!==width||cache.height!==height||cache.signature!==signature;
  if(reset){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;cache={canvas,context:canvas.getContext('2d'),width,height,signature};waterfallCaches.set(key,cache);}
  if(!reset&&cache.last===rows[0])return cache.canvas;
  let added=reset?height:rows.indexOf(cache.last);if(added<0)added=height;added=Math.min(height,added);
  if(added<height&&added>0)cache.context.drawImage(cache.canvas,0,0,width,height-added,0,added,width,height-added);
  if(added>0){const pixels=cache.context.createImageData(width,added);for(let y=0;y<added;y++)for(let x=0;x<width;x++)pixel(rows[y],x,width,pixels.data,(y*width+x)*4);cache.context.putImageData(pixels,0,0);}
  cache.last=rows[0];return cache.canvas;
}
function color(fraction){const scale=Math.max(0,Math.min(1,fraction))*5,index=Math.min(4,Math.floor(scale)),part=scale-index;return palette[index].map((channel,i)=>Math.round(channel+part*(palette[index+1][i]-channel)));}
function clearScope(){scopeBins=null;scopePeaks=null;scopeRows=[];scheduleScopes();}
function canvasContext(id){const canvas=$(id),ratio=devicePixelRatio||1,width=canvas.clientWidth,height=canvas.clientHeight;if(!width||!height)return null;if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);}const context=canvas.getContext('2d');context.setTransform(ratio,0,0,ratio,0,0);return {context,width,height};}
function drawScope(){
  if($('scope').hidden)return;const top=canvasContext('spectrumCanvas'),bottom=canvasContext('waterfallCanvas');if(!top||!bottom)return;
  const span=Math.min(Number($('scopeSpan').value),scopeRate/2),gain=Number($('scopeGain').value),floor=Number($('scopeFloor').value),maxBin=span*4096/scopeRate;
  function prepare(item){const {context:c,width,height}=item;c.fillStyle='#08101d';c.fillRect(0,0,width,height);c.font='11px system-ui';return {c,x:48,y:8,w:width-65,h:height-35};}
  function axes(plot,db){const {c,x,y,w,h}=plot;c.strokeStyle='#1f3040';c.fillStyle='#8da2b8';c.lineWidth=1;for(let i=0;i<=6;i++){const pos=x+w*i/6;c.beginPath();c.moveTo(pos,y);c.lineTo(pos,y+h);c.stroke();c.textAlign='center';c.fillText((span*i/6>=1000?(span*i/6000).toFixed(span<12000?1:0)+' k':Math.round(span*i/6)),pos,y+h+20);}if(db)for(let i=0;i<=4;i++){const pos=y+h*i/4;c.beginPath();c.moveTo(x,pos);c.lineTo(x+w,pos);c.stroke();c.textAlign='right';c.fillText(String(floor*i/4-gain),x-8,pos+4);}}
  function column(bins,x,width){const begin=Math.min(2048,Math.floor(x*maxBin/width)),end=Math.min(2049,Math.max(begin+1,Math.floor((x+1)*maxBin/width)));let peak=-140;for(let bin=begin;bin<end;bin++)peak=Math.max(peak,bins[bin]);return peak;}
  const spectrum=prepare(top);axes(spectrum,true);
  function trace(bins,stroke,width){if(!bins)return;const {c,x,y,w,h}=spectrum;c.strokeStyle=stroke;c.lineWidth=width;c.beginPath();for(let i=0;i<Math.floor(w);i++){const db=column(bins,i,w),level=Math.max(0,Math.min(1,(db+gain-floor)/-floor)),pos=y+h*(1-level);if(i)c.lineTo(x+i,pos);else c.moveTo(x+i,pos);}c.stroke();}
  if(scopeBins){if(scopePeakHold)trace(scopePeaks,'#ffc165',1);trace(scopeBins,'#50d3c2',2);let strongest=1;for(let i=2;i<=Math.min(2048,Math.floor(maxBin));i++)if(scopeBins[i]>scopeBins[strongest])strongest=i;setText($('spectrumDetail'),`Peak ${Math.round(strongest*scopeRate/4096)} Hz · ${scopeBins[strongest].toFixed(1)} dBFS · ${(scopeRate/4096).toFixed(1)} Hz / bin`);}else{spectrum.c.textAlign='center';spectrum.c.fillStyle='#8da2b8';spectrum.c.fillText('Waiting for receive samples',spectrum.x+spectrum.w/2,spectrum.y+spectrum.h/2);setText($('spectrumDetail'),'4096-point Hann FFT');}
  const waterfall=prepare(bottom),image=waterfallImage('audio',512,300,scopeRows,[span,gain,floor,scopeGeneration].join('/'),(row,x,width,data,offset)=>{const index=row?Math.max(0,Math.min(1023,Math.round((column(row.bins,x,width)+gain-floor)/-floor*1023))):0;data.set(audioColors.subarray(index*4,index*4+4),offset);});
  waterfall.c.drawImage(image,waterfall.x,waterfall.y,waterfall.w,waterfall.h);
  const gradient=waterfall.c.createLinearGradient(0,waterfall.y,0,waterfall.y+waterfall.h);palette.forEach((rgb,i)=>gradient.addColorStop(1-i/5,`rgb(${rgb.join(',')})`));waterfall.c.fillStyle=gradient;waterfall.c.fillRect(waterfall.x-12,waterfall.y,6,waterfall.h);waterfall.c.fillStyle='#8da2b8';waterfall.c.textAlign='right';waterfall.c.fillText(String(-gain),waterfall.x-16,waterfall.y+10);waterfall.c.fillText(String(floor-gain),waterfall.x-16,waterfall.y+waterfall.h);
  axes(waterfall,false);const seconds=scopeRows.length?(scopeRows[0].time-scopeRows.at(-1).time)/1000:0;setText($('waterfallDetail'),`${scopeFrozen?'Frozen':'Newest at top'} · ${scopeRows.length} frames · ${seconds.toFixed(1)} s between first / last`);
}
function drawRfSpectrumCanvas(canvasId,detailId,compact=false){
  const item=canvasContext(canvasId);if(!item)return;
  const center=rfCenterHz||state?.rfScope?.centerHz||state?.vfos?.[state.activeVfo==='B'?1:0]?.frequency||0,span=rfSpanHz||200000;
  const {context:c,width,height}=item;c.fillStyle='#08101d';c.fillRect(0,0,width,height);c.font='11px system-ui';
  const showFreqLabels=canvasId!=='rfSpectrumCanvas'||height>90;
  const plot={c,x:54,y:5,w:width-70,h:showFreqLabels?height-35:Math.max(10,height-10)},divisions=compact?2:4;const {x,y,w,h}=plot;
  c.strokeStyle='#1f3040';c.fillStyle='#8da2b8';c.lineWidth=1;
  for(let i=0;i<=divisions;i++){
    const px=x+w*i/divisions;c.beginPath();c.moveTo(px,y);c.lineTo(px,y+h);c.stroke();
    if(showFreqLabels){c.textAlign=i===0?'left':i===divisions?'right':'center';const hz=center?center-span/2+span*i/divisions:0;c.fillText(center?frequency(hz):`${Math.round((i/divisions-.5)*span/1000)} kHz`,px,y+h+20);}
  }
  for(let i=0;i<=4;i++){const py=y+h*i/4;c.beginPath();c.moveTo(x,py);c.lineTo(x+w,py);c.stroke();}
  if(rfBins){c.strokeStyle='#50d3c2';c.lineWidth=1.5;c.beginPath();for(let i=0;i<rfBins.length;i++){const px=x+w*i/(rfBins.length-1),py=y+h*(1-rfBins[i]/255);if(i)c.lineTo(px,py);else c.moveTo(px,py);}c.stroke();let peak=0;for(let i=1;i<rfBins.length;i++)if(rfBins[i]>rfBins[peak])peak=i;setText($(detailId),`${center?frequency(center)+' center':'Center unavailable'} · ${(span/1000).toLocaleString()} kHz · peak ${((peak/rfBins.length-.5)*span/1000>=0?'+':'')}${((peak/rfBins.length-.5)*span/1000).toFixed(1)} kHz`);}
  else{c.fillStyle='#8da2b8';c.textAlign='center';c.fillText('Waiting for RF scope frames',x+w/2,y+h/2);setText($(detailId),compact?'Tap spectrum to tune · waiting for RF frames':'No FT4222 RF scope frames');}
}
function drawMobileRfPreview(){
  if(!$('dashboard')||$('dashboard').hidden||!window.matchMedia('(max-width: 650px)').matches)return;
  drawRfSpectrumCanvas('mobileRfSpectrumCanvas','mobileRfDetail',true);
  drawRfWaterfallCanvas('mobileRfWaterfallCanvas','mobileRfWaterfallDetail',true);
}
function drawRfWaterfallCanvas(canvasId,detailId,compact=false){
  const item=canvasContext(canvasId);if(!item)return;
  const center=rfCenterHz||state?.rfScope?.centerHz||state?.vfos?.[state.activeVfo==='B'?1:0]?.frequency||0,span=rfSpanHz||200000;
  const {context:c,width,height}=item;c.fillStyle='#08101d';c.fillRect(0,0,width,height);c.font='11px system-ui';const waterfall={c,x:54,y:8,w:width-70,h:height-35};
  const pixelRatio=devicePixelRatio||1,rows=Math.min(rfRows.length,Math.ceil(waterfall.h*pixelRatio));
  if(rows){const image=waterfallImage(canvasId,850,Math.ceil(waterfall.h*pixelRatio),rfRows,[rfCenterHz,rfSpanHz,rfHistory.generation].join('/'),(row,x,width,data,offset)=>{const value=row?row[x]:0;for(let c=0;c<4;c++)data[offset+c]=rfColors[value*4+c];});waterfall.c.drawImage(image,waterfall.x,waterfall.y,waterfall.w,waterfall.h);}
  const divisions=compact?2:4;c.fillStyle='#8da2b8';c.strokeStyle='#1f3040';c.lineWidth=1;
  for(let i=0;i<=divisions;i++){const px=waterfall.x+waterfall.w*i/divisions;c.beginPath();c.moveTo(px,waterfall.y);c.lineTo(px,waterfall.y+waterfall.h);c.stroke();c.textAlign=i===0?'left':i===divisions?'right':'center';const hz=center?center-span/2+span*i/divisions:0;c.fillText(center?frequency(hz):`${Math.round((i/divisions-.5)*span/1000)} kHz`,px,waterfall.y+waterfall.h+20);}
  const fresh=state?.rfScope?.frameValid&&rfHistory.fresh();setText($(detailId),rfRows.length?(fresh?(compact?`${Math.min(rfRows.length,rows)} rows · newest at top`:`${rfRows.length} frames · newest at top`):'Frozen history · waiting for fresh RF frames'):(compact?'Waiting for RF frames':'No RF frames received'));
}
function drawRfScope(){
  drawMobileRfPreview();if(!$('dashboard')||$('dashboard').hidden)return;
  drawRfSpectrumCanvas('rfSpectrumCanvas','rfSpectrumDetail');
  drawRfWaterfallCanvas('rfWaterfallCanvas','rfWaterfallDetail');
}
function tuneRfFromCanvas(event,id){
  if(!state?.online||state.busy||!rfBins||!state.rfScope?.frameValid||!rfHistory.fresh())throw new Error('Wait for a fresh RF scope frame before tuning');
  const canvas=$(id),rect=canvas.getBoundingClientRect(),plotLeft=54,plotWidth=Math.max(1,rect.width-70);
  const fraction=Math.max(0,Math.min(1,(event.clientX-rect.left-plotLeft)/plotWidth));
  const activeVfo=state.activeVfo==='B'?1:0,center=rfCenterHz||state.rfScope?.centerHz||state.vfos[activeVfo]?.frequency||0;
  const target=center-rfSpanHz/2+fraction*rfSpanHz;
  if(!Number.isFinite(target)||target<30000||target>60000000)throw new Error('This spectrum position is outside the FT-710 tuning range');
  $('controlVfo').value=state.activeVfo;dirty.delete('frequency');
  return command('frequency',{vfo:state.activeVfo,hz:String(Math.round(target))},'frequency');
}
function installPageLifecycle(){
  window.addEventListener('resize',scheduleScopes);
  window.addEventListener('pagehide',()=>{closing=true;clearInterval(heartbeat);clearTimeout(reconnectTimer);tuningQueue?.clear();stopClientAudio();socket?.close();for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Page closed'));}pending.clear();edits.clear();});
  window.addEventListener('pageshow',event=>{if(event.persisted){closing=false;connectWeb();setText($('browserStatus'),'Page restored. Enable listening and arm the microphone again.');}});
}
async function exportCsv(){if(!state)return;const cell=value=>'"'+String(value??'').replace(/"/g,'""')+'"',utc=new Date().toISOString();const rows=[['Name','Group','Hamlib ID','Value','Raw value','Access','Range','Status','VFO','UTC']];state.vfos.forEach((vfo,index)=>{const name=index?'B':'A';for(const [field,label,valid,reading]of [['frequency','frequency (Hz)',vfo.frequencyValid,String(vfo.frequency)],['mode','mode / width',vfo.modeValid,vfo.mode+' / '+vfo.width]])rows.push(['VFO '+name+' '+label,'Radio / VFO','VFO'+name+'.'+field,valid?reading:'',valid?reading:'','Read / write','',valid?'Live':'Unavailable',name,utc]);});for(const item of state.settings)rows.push([item.name,item.group,item.id,item.valid?item.display:'',item.valid?item.value:'',item.writable?'Read / write':'Read only',item.range,item.status,state.settingsVfo,utc]);const blob=new Blob(['\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=element('a');link.href=url;link.download='FT710-settings.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function setup(){
  preferenceSaver=new PreferenceSaver(readStationPreferences,fields=>command('preferences',fields),key=>dirty.delete(key),(text,failed)=>{setText($('preferenceStatus'),text);$('retryPreferences').hidden=!failed;});
  $('retryPreferences').addEventListener('click',()=>preferenceSaver.flush());
  const phoneLayout=window.matchMedia('(max-width: 650px)');
  if(phoneLayout.matches){$('hostReceiveRoute').open=false;$('hostMicrophoneRoute').open=false;$('rfControlPanel').open=false;}
  phoneLayout.addEventListener?.('change',event=>{if(!event.matches){$('hostReceiveRoute').open=true;$('hostMicrophoneRoute').open=true;$('rfControlPanel').open=true;}});
  $('openConnection')?.addEventListener('click',()=>$('connectionDialog').showModal());
  $('closeConnection')?.addEventListener('click',()=>$('connectionDialog').close());
  $('connectionDialog')?.addEventListener('click',event=>{if(event.target===$('connectionDialog'))$('connectionDialog').close();});
  $('openRxTxModal')?.addEventListener('click',()=>$('rxTxDialog').showModal());
  $('closeRxTx')?.addEventListener('click',()=>$('rxTxDialog').close());
  $('rxTxDialog')?.addEventListener('click',event=>{if(event.target===$('rxTxDialog'))$('rxTxDialog').close();});
  updateStickyNavigation();
  if(window.ResizeObserver){stickyOffsetsObserver=new ResizeObserver(updateStickyNavigation);stickyOffsetsObserver.observe(document.querySelector('.topbar'));stickyOffsetsObserver.observe($('notice'));}
  stickyNoticeObserver=new MutationObserver(updateStickyNavigation);stickyNoticeObserver.observe($('notice'),{childList:true,characterData:true,subtree:true});window.addEventListener('resize',updateStickyNavigation);
  initializeCards();document.querySelectorAll('input,select').forEach(node=>node.addEventListener('input',()=>dirty.add(node.id)));
  for(const id of preferenceIds){$(id).addEventListener('input',saveStationPreferencesSoon);$(id).addEventListener('change',saveStationPreferencesSoon);}
  document.querySelectorAll('[data-page]').forEach(node=>node.addEventListener('click',()=>showPage(node.dataset.page)));
  document.querySelectorAll('[data-action]').forEach(node=>node.addEventListener('click',protect(()=>command(node.dataset.action))));
  document.querySelectorAll('[data-vfo]').forEach(node=>node.addEventListener('click',protect(()=>{$('controlVfo').value=node.dataset.vfo;dirty.delete('frequency');dirty.delete('width');return command('vfo',{vfo:node.dataset.vfo},'controlVfo');})));
  $('loginForm').addEventListener('submit',protect(async event=>{event.preventDefault();const reply=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:$('accessCode').value})});const data=await reply.json();if(!reply.ok){$('loginError').textContent=data.error;return;}$('accessCode').value='';closing=false;connectWeb();}));
  $('connectionForm').addEventListener('submit',protect(event=>{event.preventDefault();clearTimeout(preferenceSaveTimer);if(state.portOpen)return command('disconnect');const fields={kind:$('connectionKind').value};for(const key of ['endpoint','baud','stopBits','flow','poll'])fields[key]=$(key).value;for(const key of ['connectionKind','endpoint','baud','stopBits','flow','poll'])dirty.delete(key);return command('connect',fields);}));
  $('connectionKind').addEventListener('change',()=>{const before=$('endpoint').value;if($('connectionKind').value==='1'&&!before.includes(':'))$('endpoint').value='127.0.0.1:4532';if($('connectionKind').value==='0'&&before.includes(':'))$('endpoint').value='COM3';if(before!==$('endpoint').value){dirty.add('endpoint');preferenceSaver.edit('endpoint');}});
  $('saveSharing').addEventListener('click',protect(async()=>{await command('sharing',{enabled:$('shareEnabled').checked?'1':'0',port:$('sharePort').value});dirty.delete('shareEnabled');dirty.delete('sharePort');}));
  $('ptt').addEventListener('click',protect(()=>command('ptt',{enabled:state.dashboardPtt||state.pttPending?'0':'1'})));
  $('powerToggle')?.addEventListener('click',protect(()=>{
    const off=(state?.poweredOff||state?.standby)&&!state?.busy;
    const radioOn=state?.online&&!state?.busy&&!off;
    return command(radioOn?'powerOff':'powerOn');
  }));
  $('frequencyForm').addEventListener('submit',protect(event=>{event.preventDefault();return command('frequency',{vfo:$('controlVfo').value,hz:String(parseFrequencyInput($('frequency').value))},'frequency');}));
  $('mode').addEventListener('change',protect(async()=>{dirty.delete('width');edits.set('width',{revision:null,until:Date.now()+12000});try{const ack=await command('mode',{vfo:$('controlVfo').value,mode:$('mode').value,width:'0'},'mode');const edit=edits.get('width');if(edit)edit.revision=ack.revision||0;}catch(error){edits.delete('width');throw error;}}));
  $('filterForm').addEventListener('submit',protect(event=>{event.preventDefault();return command('mode',{vfo:$('controlVfo').value,mode:$('mode').value,width:$('width').value},'width');}));
  $('controlVfo').addEventListener('change',protect(()=>{dirty.delete('frequency');dirty.delete('width');return command('vfo',{vfo:$('controlVfo').value},'controlVfo');}));
  const tune=(steps,target=$('controlVfo').value)=>{if(!state?.online||state.busy||!steps)return;dirty.delete('frequency');return command('step',{vfo:target,hz:String(steps*Number($('step').value))},'frequency');};
  $('up').addEventListener('click',protect(()=>tune(1)));$('down').addEventListener('click',protect(()=>tune(-1)));
  tuningQueue=new TuningQueue(async(vfo,hz)=>{if(!state?.online||state.busy)return;dirty.delete('frequency');await command('step',{vfo,hz:String(hz)},'frequency');},90,error=>notify(error.message));
  let drag,lastX,motion=0;const queue=(delta,target=$('controlVfo').value)=>tuningQueue.add(target,delta*Number($('step').value));
  $('dial').addEventListener('pointerdown',event=>{if(!state?.online)return;drag=event.pointerId;lastX=event.clientX;motion=0;$('dial').setPointerCapture(drag);});$('dial').addEventListener('pointermove',event=>{if(drag!==event.pointerId)return;motion+=event.clientX-lastX;lastX=event.clientX;const count=Math.trunc(motion/12);if(count){motion-=count*12;queue(count);}});for(const name of ['pointerup','pointercancel','lostpointercapture'])$('dial').addEventListener(name,()=>{drag=undefined;tuningQueue.flush().catch(error=>notify(error.message));});
  $('dial').addEventListener('keydown',protect(event=>{if(['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','PageUp','PageDown'].includes(event.key)){event.preventDefault();return tune(event.key==='PageUp'?10:event.key==='PageDown'?-10:event.key==='ArrowLeft'||event.key==='ArrowDown'?-1:1);}}));
  for(const id of ['dial','freqA','freqB'])$(id).addEventListener('wheel',event=>{event.preventDefault();queue(event.deltaY<0?1:-1,id==='dial'?$('controlVfo').value:id==='freqB'?'B':'A');},{passive:false});

  function formatStepLabel(hz){if(hz>=1e6)return (hz/1e6)+' MHz';if(hz>=1e3)return (hz/1e3)+' kHz';return hz+' Hz';}
  function updateVfoStepBadges(){const cur=Number(localStorage.getItem('step')||$('step')?.value||'100');const lbl=formatStepLabel(cur)+' step';['A','B'].forEach(name=>{if($('step'+name)){setText($('step'+name),lbl);const isAct=state?.online&&state?.activeVfo===name;$('step'+name).style.display=isAct?'inline-flex':'none';}});}

  let modalTargetVfo='A';
  let modalSelectedStep=Number(localStorage.getItem('step')||'100');

  function openFreqModal(vfoName){
    modalTargetVfo=vfoName;
    setText($('freqModalTitle'),'VFO '+vfoName+' Frequency');
    const index=vfoName==='B'?1:0;
    const vfo=state?.vfos?.[index];
    $('freqManualInput').value=vfo&&vfo.frequencyValid?frequency(vfo.frequency):'14.074.000';
    modalSelectedStep=Number(localStorage.getItem('step')||$('step')?.value||'100');
    document.querySelectorAll('#freqStepsGrid .step-chip').forEach(chip=>{
      chip.classList.toggle('selected',Number(chip.dataset.step)===modalSelectedStep);
    });
    setText($('freqStepPreview'),'Step: '+formatStepLabel(modalSelectedStep));
    $('freqDialog').showModal();
    setTimeout(()=>$('freqManualInput').select(),50);
  }

  function openModeModal(vfoName){
    modalTargetVfo=vfoName;
    setText($('modeModalTitle'),'VFO '+vfoName+' Operating Mode');
    const index=vfoName==='B'?1:0;
    const vfo=state?.vfos?.[index];
    const curMode=vfo?.modeValid?vfo.mode:'USB';
    const curWidth=vfo?.modeValid?vfo.width:3000;
    setText($('currentFilterDisplay'),curWidth?curWidth+' Hz':'Normal (0 Hz)');
    document.querySelectorAll('#modeButtonsGrid .mode-chip').forEach(chip=>{
      chip.classList.toggle('selected',chip.dataset.mode===curMode);
    });
    document.querySelectorAll('#filterPresetsRow .filter-chip').forEach(chip=>{
      chip.classList.toggle('selected',Number(chip.dataset.width)===Number(curWidth));
    });
    $('modeDialog').showModal();
  }

  $('freqA').addEventListener('click',()=>openFreqModal('A'));
  $('freqB').addEventListener('click',()=>openFreqModal('B'));
  $('modeA').addEventListener('click',()=>openModeModal('A'));
  $('modeB').addEventListener('click',()=>openModeModal('B'));

  $('closeFreqModal').addEventListener('click',()=>$('freqDialog').close());
  $('freqModalCancel').addEventListener('click',()=>$('freqDialog').close());

  document.querySelectorAll('#freqStepsGrid .step-chip').forEach(chip=>{
    chip.addEventListener('click',()=>{
      modalSelectedStep=Number(chip.dataset.step);
      document.querySelectorAll('#freqStepsGrid .step-chip').forEach(c=>c.classList.toggle('selected',c===chip));
      setText($('freqStepPreview'),'Step: '+formatStepLabel(modalSelectedStep));
    });
  });

  const nudgeModalFreq=(isUp)=>{
    try{
      let currentHz=parseFrequencyInput($('freqManualInput').value);
      const delta=isUp?modalSelectedStep:-modalSelectedStep;
      currentHz=Math.max(30000,Math.min(60000000,currentHz+delta));
      $('freqManualInput').value=frequency(currentHz);
    }catch(err){notify(err.message);}
  };
  $('freqModalUp').addEventListener('click',()=>nudgeModalFreq(true));
  $('freqModalDown').addEventListener('click',()=>nudgeModalFreq(false));

  $('freqModalForm').addEventListener('submit',protect(async(event)=>{
    event.preventDefault();
    const hz=parseFrequencyInput($('freqManualInput').value);
    await command('frequency',{vfo:modalTargetVfo,hz:String(hz)},'frequency');
    localStorage.setItem('step',String(modalSelectedStep));
    if($('step'))$('step').value=String(modalSelectedStep);
    updateVfoStepBadges();
    $('freqDialog').close();
    notify('VFO '+modalTargetVfo+' frequency set to '+frequency(hz),false);
  }));

  $('closeModeModal').addEventListener('click',()=>$('modeDialog').close());

  document.querySelectorAll('#modeButtonsGrid .mode-chip').forEach(btn=>{
    btn.addEventListener('click',protect(async()=>{
      const newMode=btn.dataset.mode;
      document.querySelectorAll('#modeButtonsGrid .mode-chip').forEach(b=>b.classList.toggle('selected',b.dataset.mode===newMode));
      await command('mode',{vfo:modalTargetVfo,mode:newMode,width:'0'},'mode');
      notify('VFO '+modalTargetVfo+' mode: '+newMode,false);
    }));
  });

  document.querySelectorAll('#filterPresetsRow .filter-chip').forEach(btn=>{
    btn.addEventListener('click',protect(async()=>{
      const newWidth=btn.dataset.width;
      document.querySelectorAll('#filterPresetsRow .filter-chip').forEach(b=>b.classList.toggle('selected',b.dataset.width===newWidth));
      setText($('currentFilterDisplay'),Number(newWidth)?newWidth+' Hz':'Normal (0 Hz)');
      const vfo=state?.vfos?.[modalTargetVfo==='B'?1:0];
      const curMode=vfo?.modeValid?vfo.mode:'USB';
      await command('mode',{vfo:modalTargetVfo,mode:curMode,width:String(newWidth)},'width');
      notify('Filter: '+(Number(newWidth)?newWidth+' Hz':'Normal'),false);
    }));
  });

  $('filterModalCustomForm').addEventListener('submit',protect(async(event)=>{
    event.preventDefault();
    const val=$('modalFilterCustomInput').value.trim();
    if(!val)return;
    const vfo=state?.vfos?.[modalTargetVfo==='B'?1:0];
    const curMode=vfo?.modeValid?vfo.mode:'USB';
    await command('mode',{vfo:modalTargetVfo,mode:curMode,width:val},'width');
    setText($('currentFilterDisplay'),val+' Hz');
    notify('Filter: '+val+' Hz',false);
  }));
  $('settingFilter').addEventListener('input',()=>state&&renderSettings());$('settingsVfo').addEventListener('change',protect(async()=>{await command('settingsVfo',{vfo:$('settingsVfo').value});dirty.delete('settingsVfo');}));
  $('closeSetting').addEventListener('click',()=>$('settingDialog').close());$('settingForm').addEventListener('submit',protect(async event=>{event.preventDefault();await command('set',{setting:selectedSetting,value:$('settingChoices').hidden?$('settingValue').value:$('settingChoices').value});$('settingDialog').close();notify('Setting queued. Radio readback appears in the table.',false);}));
  $('clearLog').addEventListener('click',protect(()=>command('clearLog')));$('catPreset').addEventListener('change',()=>$('catCommand').value=$('catPreset').value);$('catForm').addEventListener('submit',protect(event=>{event.preventDefault();return command('rawQuery',{text:$('catCommand').value});}));$('catWrite').addEventListener('click',protect(()=>command('rawWrite',{text:$('catCommand').value})));
  $('audioRefresh').addEventListener('click',protect(()=>command('audioRefresh')));
  for(let slot=0;slot<4;slot++)$('audioMap'+slot).addEventListener('change',protect(async()=>{await command('audioMap',{slot:String(slot),device:$('audioMap'+slot).value});dirty.delete('audioMap'+slot);}));
  for(const id of ['receiveRoute','scopeReceive'])$(id).addEventListener('click',protect(()=>command('audioRoute',{route:'receive',enabled:state.audio.receiveWanted?'0':'1'})));
  $('microphoneRoute').addEventListener('click',protect(()=>command('audioRoute',{route:'microphone',enabled:state.audio.microphoneWanted?'0':'1'})));
  for(const route of ['receive','microphone'])$(route+'Level').addEventListener('change',protect(async()=>{await command('audioLevel',{route,value:$(route+'Level').value});dirty.delete(route+'Level');}));
  $('pttLimit').addEventListener('change',protect(async()=>{await command('pttLimit',{index:$('pttLimit').value});dirty.delete('pttLimit');}));
  $('browserMappings').addEventListener('click',protect(async()=>{await command('audioMap',{slot:'1',device:'browser:playback'});if(browserMicAvailable())await command('audioMap',{slot:'2',device:'browser:capture'});notify('Browser listening selected. Choose the radio USB source, then enable receive audio.',false);}));
  $('listen').addEventListener('click',protect(listen));$('microphone').addEventListener('click',protect(armMicrophone));$('browserDevices').addEventListener('click',protect(browserDevices));
  for(const id of ['browserInput','browserOutput']){const saved=localStorage.getItem(id);if(saved){const option=element('option','Saved device / refresh devices');option.value=saved;$(id).append(option);$(id).value=saved;}}
  const savedVolume=localStorage.getItem('browserVolume');if(savedVolume!==null&&Number.isFinite(Number(savedVolume)))$('browserVolume').value=Math.max(0,Math.min(100,Number(savedVolume)));
  $('browserInput').addEventListener('change',()=>{localStorage.setItem('browserInput',$('browserInput').value);if(microphone||microphoneBusy){stopMicrophone();notify('Microphone selection changed. Arm the browser microphone again.',false);if(state?.browserOwner===client)command('ptt',{enabled:'0'}).catch(()=>{});}});
  $('browserOutput').addEventListener('change',protect(async()=>{await ensureAudio();if(!audioContext.setSinkId)throw new Error('This browser uses the system output');await audioContext.setSinkId($('browserOutput').value);localStorage.setItem('browserOutput',$('browserOutput').value);}));$('browserVolume').addEventListener('input',()=>{localStorage.setItem('browserVolume',$('browserVolume').value);if(listeningGain)listeningGain.gain.value=Number($('browserVolume').value)/100;});
  for(const id of ['scopeSpan','scopeGain','scopeFloor']){const saved=localStorage.getItem(id);if([...$(id).options].some(option=>option.value===saved))$(id).value=saved;$(id).addEventListener('change',()=>{localStorage.setItem(id,$(id).value);drawScope();});}
  // Station preferences come from the server; localStorage holds local display/audio choices only.
  const savedRfLevel=localStorage.getItem('rfWaterfallLevel');if(savedRfLevel!==null&&Number.isFinite(Number(savedRfLevel))&&Number(savedRfLevel)>=-30&&Number(savedRfLevel)<=30&&Number.isInteger(Number(savedRfLevel)*2))$('rfWaterfallLevel').value=Number(savedRfLevel).toFixed(1);
  $('rfWaterfallLevel').addEventListener('change',()=>localStorage.setItem('rfWaterfallLevel',Number($('rfWaterfallLevel').value).toFixed(1)));
  for(const id of ['rfCapture','mobileRfCapture'])$(id).addEventListener('click',protect(toggleRfCapture));
  $('rfApplySpan').addEventListener('click',protect(async()=>{const port=$('rfCat2Port').value.trim(),level=Number($('rfWaterfallLevel').value);if(!/^COM\d+$/i.test(port))throw new Error('Enter the radio Standard / CAT-2 COM port, for example COM5');if(!Number.isFinite(level)||level < -30||level > 30||!Number.isInteger(level*2))throw new Error('Waterfall level must be -30 to +30 dB in 0.5 dB steps');await command('rfSpan',{port,baud:$('rfCat2Baud').value,span:$('rfSpan').value,level:level.toFixed(1)});dirty.delete('rfSpan');dirty.delete('rfWaterfallLevel');localStorage.setItem('rfWaterfallLevel',level.toFixed(1));notify('Radio confirmed CENTER mode, RF span, and waterfall level.',false);}));
  $('rfClear').addEventListener('click',()=>{rfHistory.clear();rfRows=[];rfBins=null;waterfallCaches.clear();scheduleScopes();});
  for(const id of ['rfSpectrumCanvas','rfWaterfallCanvas','mobileRfSpectrumCanvas','mobileRfWaterfallCanvas'])$(id).addEventListener('click',protect(event=>tuneRfFromCanvas(event,id)));
  const savedStep=localStorage.getItem('step');if([...$('step').options].some(option=>option.value===savedStep))$('step').value=savedStep;$('step').addEventListener('change',()=>localStorage.setItem('step',$('step').value));
  $('scopeFreeze').addEventListener('click',()=>{scopeFrozen=!scopeFrozen;setText($('scopeFreeze'),scopeFrozen?'Resume':'Freeze');$('scopeFreeze').classList.toggle('selected',scopeFrozen);drawScope();});$('scopePeak').addEventListener('click',()=>{scopePeakHold=!scopePeakHold;scopePeaks=null;setText($('scopePeak'),'Peak hold: '+(scopePeakHold?'On':'Off'));$('scopePeak').classList.toggle('selected',scopePeakHold);drawScope();});$('scopeClear').addEventListener('click',clearScope);
  $('logout').addEventListener('click',protect(async()=>{if(state?.browserOwner===client)await command('ptt',{enabled:'0'});closing=true;clearTimeout(reconnectTimer);socket?.close();stopClientAudio();await fetch('/api/logout',{method:'POST'});$('app').hidden=true;$('mobilePttBar').hidden=true;$('login').hidden=false;}));
  const stable=localStorage.getItem('stableAudio');$('stableAudio').checked=stable!=='0';$('stableAudio').disabled=!navigator.audioSession;
  $('stableAudio').addEventListener('change',()=>{localStorage.setItem('stableAudio',$('stableAudio').checked?'1':'0');audioSessionType(microphone);});
  $('resumeAudio').addEventListener('click',protect(async()=>{await ensureAudio();$('resumeAudio').hidden=true;setText($('browserStatus'),'Audio resumed. Arm the microphone again to transmit.');}));
  $('unattended').addEventListener('change',protect(()=>command('unattended',{enabled:$('unattended').checked?'1':'0'})));
  navigator.mediaDevices?.addEventListener?.('devicechange',()=>{browserDevices().catch(()=>{});updateDiagnostics();});
  navigator.audioSession?.addEventListener?.('statechange',()=>{if(navigator.audioSession.state==='interrupted')audioInterrupted('Phone audio interrupted. Tap Resume audio.');});
  document.addEventListener('visibilitychange',()=>{subscribeScopes();if(document.hidden&&(microphone||microphoneBusy))audioInterrupted('Microphone disarmed while the page was hidden. Arm it again to transmit.');else scheduleScopes();});
  installPageLifecycle();
  setInterval(()=>setText($('clock'),new Date().toISOString().slice(11,19)+' UTC'),1000);
  const code=new URLSearchParams(location.hash.slice(1)).get('code');if(code){$('accessCode').value=code;history.replaceState(null,'',location.pathname);}else if(location.pathname.includes('dashboard')&&!$('accessCode').value){$('accessCode').value='demo';}
  fetch('/api/state').then(reply=>{if(reply.ok){closing=false;connectWeb();}}).catch(()=>{});
  const sink=!!(isSecureContext&&window.AudioContext?.prototype.setSinkId);$('browserOutput').disabled=!sink;$('browserInput').disabled=$('browserDevices').disabled=!navigator.mediaDevices?.enumerateDevices;
  setText($('outputSupport'),sink?'Browser output selection is available.':'This browser uses the device’s system audio output.');
  if(navigator.mediaDevices?.enumerateDevices)browserDevices().catch(()=>{});
  const support=element('p',browserMicAvailable()?'Tap Arm browser microphone and allow microphone access. On iPhone, select the speaker or headset using the phone’s audio controls.':'Microphone capture needs a supported browser and trusted HTTPS. Install and trust the station certificate before opening the dashboard.','muted');$('outputSupport').after(support);$('microphone').disabled=!browserMicAvailable();if(!browserMicAvailable())setText($('browserMappings'),'Use browser receive mapping');
}
setup();
