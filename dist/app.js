import { fetchResource, abortable } from './resource.js?v=loading-20261118b';
import { ModelNetwork } from './model-network.js?v=network-fill-20261119';
import { OdorFieldLayer } from './odor-field.js?v=loading-20261118b';
const byId = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const TASKS = {
  D3: { name: '视觉导航', model: 'ConnectomeFlight-V · T4/T5 · 115 参数', summary: '树林 v3 · 绕行抵达球形目标', scenes: [
    {detail:'上侧目标', summary:'上侧球形目标 · 5 处树障碍'},
    {detail:'中部目标', summary:'中部球形目标 · 4 处树障碍'},
    {detail:'下侧目标', summary:'下侧球形目标 · 5 处树障碍'},
  ] },
  D4: { name: '视嗅导航', model: 'ConnectomeFlight-VO · Vis115 · 2454 参数', summary: 'Vis115 + 嗅觉残差 · update25600 · 选定成功案例', scenes: [
    {detail:'下侧气味源', summary:'下侧气味源 · 相同外观的 4 个目标'},
    {detail:'上侧气味源', summary:'上侧气味源 · 镜像树障碍布局'},
    {detail:'中部气味源', summary:'中部气味源 · 不同树障碍布局'},
  ] },
};
const ASSET_VERSION = 'loading-20261118b';
const CROPS = {follow:[0,0,1280,720],topdown:[1280,0,1280,720]};
const modelNetwork = new ModelNetwork();
const odorField = new OdorFieldLayer();
const TRACE_COLOR = '#a9dfc7';
const video = byId('replay-source');
const state = { task: 'D3', variant: 1, selectedVariants: {D3:1,D4:1}, scene: null, frame: 0, cell: 0, ready: false, pendingFrame: null, generation: 0, expanded: 'follow', loop:false, buffering:false, failed:false };
let videoCallback = null;
let videoListenerController = null;
const task = () => TASKS[state.task];
const frames = () => state.scene?.frames ?? 0;
const lastFrame = () => Math.max(0, frames()-1);
const variantInfo = () => task().scenes[state.variant-1];
const sceneTitle = () => `场景 ${String(state.variant).padStart(2,'0')}`;
const mediaStem = () => `${state.task.toLowerCase()}${state.variant===1?'':`-${state.variant}`}`;
const assetURL = suffix => `./media/${mediaStem()}${suffix}?v=${ASSET_VERSION}`;

function paint(id, crop, smooth = true) {
  const canvas = byId(id);
  if (!canvas || video.readyState < 2) return;
  const [x,y,w,h] = crop;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = smooth;
  const scale=video.videoWidth/2560;
  ctx.drawImage(video, x*scale,y*scale,w*scale,h*scale, 0,0,w,h);
  if (crop === CROPS.topdown) drawTopdownMarker(canvas, ctx);
}

function drawTopdownMarker(canvas, ctx) {
  const point = state.scene?.topdownMarkerXY[state.frame];
  if (!point) return;
  const bounds = canvas.getBoundingClientRect();
  const scale = Math.min(bounds.width / canvas.width, bounds.height / canvas.height);
  if (scale <= 0) return;
  ctx.save(); ctx.translate(point[0], point[1]); ctx.scale(1 / scale, 1 / scale);
  ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.strokeStyle = '#c4fff1'; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.restore();
}
function render(frame = Math.floor(video.currentTime * 20 + .001)) {
  if (!state.ready || video.readyState < 2 || video.seeking) return;
  frame=clamp(frame,0,lastFrame());
  if (!modelNetwork.hasFrame(frame)) { seek(frame,!video.paused); return; }
  state.frame = frame;
  state.pendingFrame = null;
  paint('camera-image', CROPS.follow); paint('topdown-image', CROPS.topdown);
  modelNetwork.setFrame(state.frame);
  for(let eye=0;eye<2;eye++) {
    const canvas=byId(eye?'eye-right':'eye-left'),source=modelNetwork.eyeCanvas[eye];
    canvas.width=source.width; canvas.height=source.height; canvas.getContext('2d').drawImage(source,0,0);
    drawHex(byId(eye?'hex-right':'hex-left'),'visual',eye);
    drawHex(byId(eye?'t4-right':'t4-left'),'activity',eye);
  }
  drawTrajectory();
  const position=state.scene.positionsXYZCm[state.frame];
  byId('position-xy').textContent=`${position[0].toFixed(2)}, ${position[1].toFixed(2)}`;
  byId('distance').textContent=`${state.scene.distanceCm[state.frame].toFixed(2)} cm`;
  byId('camera-position').textContent=`高度 ${position[2].toFixed(2)} cm`;
  if(state.scene.odorConcentrations) {
    state.scene.odorConcentrations[state.frame].forEach((v,i)=>{byId(`odor-${i}`).textContent=v.toFixed(4);byId(`odor-meter-${i}`).value=v;});
    const [mean,diff]=state.scene.odorFeatures[state.frame];byId('odor-features').textContent=`强度 ${mean.toFixed(3)} · 左右差 ${diff.toFixed(3)}`;
  }
  if (byId('camera-dialog').open) paint('camera-image-large', CROPS[state.expanded]);
  updateControls();
}
function updateControls() {
  const playing = state.ready && ((!video.paused && !video.ended) || (state.buffering && state.resumeAfterBuffer));
  const ended = state.ready && state.frame >= lastFrame() && !playing;
  const label = playing ? '暂停' : ended ? '重新播放' : '播放';
  const status = state.failed ? '加载失败' : !state.ready ? '加载中' : state.buffering ? '缓冲中' : playing ? '播放中' : ended ? '回放结束' : state.frame===0 ? '就绪' : '已暂停';
  byId('playback-status').textContent=status;
  document.querySelector('.top-status').dataset.state=state.failed?'error':!state.ready?'loading':state.buffering?'buffering':playing?'playing':'paused';
  byId('timeline-state').textContent=state.ready?(state.buffering?'正在载入当前回放分段…':ended?'已播完 · 可重新播放':playing?(state.buffering?'正在缓冲…':'所有视图同步播放'):'拖动时间轴逐帧查看'):'等待回放';
  byId('play-button').setAttribute('aria-label',label);
  document.querySelectorAll('[data-playback-toggle]').forEach(button => {
    button.textContent = playing ? 'Ⅱ 暂停' : ended ? '↻ 重新播放' : '▶ 播放'; button.setAttribute('aria-label',label);
  });
  const elapsed = (state.frame*.005).toFixed(3), duration = ((lastFrame())*.005).toFixed(3);
  byId('frame-label').textContent = frames() ? `${String(state.frame+1).padStart(4,'0')} / ${String(frames()).padStart(4,'0')}` : '— / —';
  byId('sim-time').textContent = byId('topdown-time').textContent = `T + ${elapsed} S`;
  document.querySelectorAll('[data-playback-time]').forEach(el => { el.textContent = `${elapsed} / ${duration} s`; });
  document.querySelectorAll('#timeline, [data-playback-timeline]').forEach(el => {
    el.max = String(lastFrame()); el.value = String(state.pendingFrame ?? state.frame);
    el.style.setProperty('--progress', `${(state.pendingFrame??state.frame)/Math.max(1,lastFrame())*100}%`);
    el.setAttribute('aria-valuetext', frames()?`第 ${state.frame+1} 帧，共 ${frames()} 帧`:'等待回放加载');
  });
  modelNetwork.setPlaybackActive(playing);
}
function setEnabled(enabled) {
  document.querySelectorAll('#play-button, #restart-button, #loop-button, #share-open, #step-back, #step-forward, #timeline, #network-expand, [data-camera-view], [data-network-reset], [data-playback-toggle], [data-playback-timeline]').forEach(el => { el.disabled = !enabled; });
}
function showError(error) {
  videoListenerController?.abort(error);
  state.ready = false; state.failed=true; state.buffering=false; video.pause(); setEnabled(false); modelNetwork.clearScene();
  video.removeAttribute('src');video.load();
  byId('flight-panel').setAttribute('aria-busy','false');
  byId('loading-message').textContent = `未能载入${sceneTitle()}，请重试。`;
  byId('loading-hint').textContent = navigator.onLine===false?'当前处于离线状态，请连接网络后重试。':error?.name==='TimeoutError'?(error.message || '加载时间较长，请检查网络或选择其他场景。'):(error?.message || '请检查网络连接，也可以先选择其他场景。');
  byId('retry-load').hidden = false;
  byId('loading').classList.add('load-failed');
  byId('loading').classList.remove('hidden');
  byId('network-load').textContent='等待重新加载当前场景';
  updateControls();
}
function scheduleFrames(generation) {
  if (generation !== state.generation) return;
  if (video.requestVideoFrameCallback) {
    videoCallback = video.requestVideoFrameCallback((now, metadata) => {
      if (generation !== state.generation) return;
      render(Math.round(metadata.mediaTime*20)); scheduleFrames(generation);
    });
  } else {
    videoCallback = requestAnimationFrame(() => {
      const frame = Math.floor(video.currentTime * 20 + .001);
      if (!video.paused && frame !== state.frame) render(frame);
      scheduleFrames(generation);
    });
  }
}
function clearReadouts() {
  for(const id of ['eye-left','eye-right','hex-left','hex-right','t4-left','t4-right','trajectory']) {
    const canvas=byId(id),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  for(const id of ['position-xy','distance','camera-position','odor-0','odor-1','odor-features'])byId(id).textContent='—';
  for(const id of ['odor-meter-0','odor-meter-1'])byId(id).value=0;
}
function waitForVideo(signal, source) {
  return new Promise((resolve,reject)=>{
    const events=['loadeddata','canplay','loadedmetadata','progress','seeked'];
    const clean=()=>{events.forEach(e=>video.removeEventListener(e,loaded));video.removeEventListener('error',failed);signal.removeEventListener('abort',aborted);clearInterval(poll);};
    const loaded=()=>{if(video.currentSrc!==new URL(source,location.href).href || video.readyState<2)return;clean();resolve();};
    const failed=()=>{clean();reject(new Error('飞行画面加载失败，请重试'));};
    const aborted=()=>{clean();reject(signal.reason || new DOMException('回放已切换','AbortError'));};
    const poll=setInterval(loaded,200);
    events.forEach(e=>video.addEventListener(e,loaded));video.addEventListener('error',failed);signal.addEventListener('abort',aborted,{once:true});
    if(signal.aborted)aborted();else loaded();
  });
}

function validateSceneData(scene,key) {
  if(scene.format!=='presentation-v2'||scene.difficulty!==key||!Number.isInteger(scene.frames)||scene.frames<1)throw new Error('展示记录不匹配');
  for(const name of ['positionsXYZCm','actions','distanceCm','topdownMarkerXY'])if(!Array.isArray(scene[name])||scene[name].length!==scene.frames)throw new Error('展示帧数不匹配');
  if(key==='D4')for(const name of ['odorConcentrations','odorFeatures'])if(!Array.isArray(scene[name])||scene[name].length!==scene.frames)throw new Error('嗅觉帧数不匹配');
}
function validateScene(scene,key) {
  validateSceneData(scene,key);
  if(!Number.isFinite(video.duration)||Math.abs(video.duration-scene.frames/20)>.11)throw new Error('视频与展示帧数不匹配');
}
async function loadScene(key,variant,initialFrame=0) {
  try { await prepareScene(key,variant,initialFrame); }
  catch(error) { videoListenerController?.abort(error); showError(error); }
}
async function prepareScene(key, variant, initialFrame=0) {
  if (!Object.prototype.hasOwnProperty.call(TASKS,key)) key='D3';
  variant=Number(variant??state.selectedVariants[key]);
  if(!Number.isInteger(variant)||variant<1||variant>TASKS[key].scenes.length)variant=1;
  const generation=++state.generation;
  seekRequest++;
  video.pause(); state.ready=false; state.failed=false; state.buffering=false; state.task=key; state.variant=variant; state.selectedVariants[key]=variant; state.scene=null; state.frame=0; state.pendingFrame=null;
  modelNetwork.clearScene();clearReadouts();
  byId('flight-panel').setAttribute('aria-busy','true');
  if(videoCallback!==null) {
    if(video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(videoCallback);
    else cancelAnimationFrame(videoCallback);
  }
  videoListenerController?.abort(); videoListenerController=new AbortController();
  const options={signal:videoListenerController.signal};
  setEnabled(false);updateControls();
  byId('loading-message').textContent=`正在准备${task().name} · ${sceneTitle()}…`;
  byId('loading-hint').textContent='正在载入当前场景，请稍候';
  for(const id of ['load-video','load-activity'])byId(id).classList.remove('complete');
  byId('retry-load').hidden=true;byId('loading').classList.remove('hidden','load-failed');
  document.body.classList.toggle('multimodal',key==='D4');byId('odor-card').hidden=key!=='D4';
  document.querySelector('.model-tag').textContent=task().model;
  byId('task-model-note').textContent=key==='D4'
    ? '视嗅导航使用 ConnectomeFlight 冻结多模态队列的默认代表模型：ConnectomeFlight-VO，2454 参数、seed65251/update25600。完整 Vis115 分支经固定压缩和 50 ms EMA 产生视觉基准；触角气味经 32 维 RNN，与视觉记忆融合形成残差。两路相加后经 tanh 控制飞行。这里提供三个不同场景的成功案例，可对照气味源和障碍布局变化。'
    : '视觉导航使用 115 参数的 ConnectomeFlight-V（T4/T5，update800）。双眼 144 维特征经固定归一化与 104 维压缩，再经两个标量读出层、50 ms EMA 记忆和动作头，在疏朗树林 v3 中绕行抵达直径 1.8 cm 的球形目标。';
  document.querySelector('.column-heading h2').lastChild.textContent=key==='D4'?'视嗅输入':'视觉输入';
  document.querySelector('.column-heading > span').textContent=key==='D4'?'双眼 + 触角':'左眼 / 右眼';
  document.querySelector('.eye-card .card-tag').textContent=key==='D4'?'64 × 64':'32 × 32';
  byId('camera-resolution-badge').textContent=byId('quality').value==='hd'?' · HD':' · 流畅';byId('task-summary').textContent=`${sceneTitle()} · ${variantInfo().summary}`;byId('scene-id').textContent='';
  byId('network-dialog-title').textContent=`${task().model} · ${sceneTitle()} · ${key==='D4'?'视嗅融合到动作':'从视觉到动作'}`;
  document.querySelector('.footer span').textContent = 'ConnectomeFlight · 基于 FlyVis × FlyBody';
  document.querySelectorAll('[data-difficulty]').forEach(button=>{const active=button.dataset.difficulty===key;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  document.querySelectorAll('[data-scene]').forEach(button=>{
    const index=Number(button.dataset.scene),active=index===variant,info=task().scenes[index-1];
    button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    button.querySelector('.scene-detail').textContent=info.detail;
    button.setAttribute('aria-label',`${task().name}，场景 ${index}，${info.summary}`);
    button.title=info.summary;
  });
  const url=new URL(location.href);url.searchParams.set('task',key);url.searchParams.set('scene',String(variant));
  if(Number.isInteger(initialFrame)&&initialFrame>0)url.searchParams.set('frame',String(initialFrame));else url.searchParams.delete('frame');
  history.replaceState(null,'',url);
  const controller=videoListenerController;
  const timeout=setTimeout(()=>controller.abort(new DOMException('加载超时','TimeoutError')),90000);
  try {
    const progress=(received,total,retry)=>{
      if(generation!==state.generation)return;
      byId('loading-hint').textContent=retry?'连接暂时中断，正在重试…':`正在载入场景信息 · ${Math.round(received/1024)} KB`;
    };
    const scene=await fetchResource(assetURL('-display.json'),{...options,onProgress:progress});
    if(generation!==state.generation || options.signal.aborted)return;
    validateSceneData(scene,key);
    byId('loading-hint').textContent='正在载入首段活动与飞行画面…';
    const source=assetURL(byId('quality').value==='hd'?'.mp4':'-preview.mp4');
    video.removeAttribute('src');video.load();
    const mediaReady=waitForVideo(options.signal,source);
    video.preload='auto';video.src=source;video.load();video.playbackRate=Number(byId('speed').value);
    const activityReady=modelNetwork.loadScene(scene,`${task().name} · ${sceneTitle()}`,options.signal).then(()=>{if(generation===state.generation)byId('load-activity').classList.add('complete');});
    await abortable(Promise.all([activityReady,mediaReady.then(()=>{if(generation===state.generation)byId('load-video').classList.add('complete');})]),options.signal);
    if(generation!==state.generation)return;
    validateScene(scene,key);
    if(key==='D4')odorField.load(options.signal).then(()=>{if(generation===state.generation && state.ready)drawTrajectory();}).catch(()=>{if(generation===state.generation && !options.signal.aborted)toast('气味背景暂不可用，轨迹与触角读数仍正常显示');});
    state.scene=scene;
    state.ready=true;byId('flight-panel').setAttribute('aria-busy','false');byId('loading').classList.add('hidden');setEnabled(true);render(0);scheduleFrames(generation);
    if(Number.isInteger(initialFrame)&&initialFrame>0){const target=Math.min(initialFrame,lastFrame());url.searchParams.set('frame',String(target));history.replaceState(null,'',url);seek(target);}
  }catch(error){if(generation===state.generation){const reason=options.signal.reason||error;controller.abort(reason);showError(reason);}}
  finally { clearTimeout(timeout); }
}

let seekRequest=0;
async function seek(frame,resume=false) {
  if(!state.ready)return;
  frame=clamp(Math.round(frame),0,lastFrame());
  const request=++seekRequest,generation=state.generation,signal=videoListenerController.signal;
  video.pause();state.resumeAfterBuffer=resume;state.pendingFrame=frame;state.buffering=!modelNetwork.hasFrame(frame);updateControls();
  try {
    await modelNetwork.ensureFrame(frame);
    if(request!==seekRequest || generation!==state.generation || signal.aborted)return;
    if(Math.abs(video.currentTime-(frame+.1)/20)>.001) {
      await new Promise((resolve,reject)=>{
        const clean=()=>{clearTimeout(timer);video.removeEventListener('seeked',done);signal.removeEventListener('abort',aborted);};
        const done=()=>{clean();resolve();};
        const aborted=()=>{clean();reject(signal.reason || new DOMException('回放已切换','AbortError'));};
        const timer=setTimeout(()=>{clean();reject(new DOMException('视频定位超时，请重试','TimeoutError'));},90000);
        video.addEventListener('seeked',done);signal.addEventListener('abort',aborted,{once:true});
        video.currentTime=(frame+.1)/20;
        if(!video.seeking)done();
      });
    }
    if(request!==seekRequest || generation!==state.generation)return;
    state.buffering=false;render(frame);
    if(state.resumeAfterBuffer && document.visibilityState==='visible')await video.play();
  } catch(error) { if(request===seekRequest && generation===state.generation && !signal.aborted){videoListenerController.abort(error);showError(error);} }
}

async function togglePlay() {
  if(!state.ready) return;
  if(state.buffering && state.pendingFrame!==null) {state.resumeAfterBuffer=!state.resumeAfterBuffer;updateControls();return;}
  if(!video.paused) {state.resumeAfterBuffer=false;state.buffering=false;video.pause();updateControls();return;}
  if(state.frame>=lastFrame()) await seek(0);
  try{await video.play();updateControls();}catch{byId('network-sync').textContent='请再次点击播放';}
}
async function restart() {
  if(!state.ready)return;
  await seek(0);
  try{await video.play();updateControls();}catch{updateControls();}
}
let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);byId('toast').textContent=message;byId('toast').hidden=false;
  toastTimer=setTimeout(()=>{byId('toast').hidden=true;},2600);
}
video.addEventListener('seeked',()=>render());
video.addEventListener('pause',updateControls);
video.addEventListener('playing',()=>{state.buffering=false;updateControls();});
video.addEventListener('waiting',()=>{if(state.ready){state.buffering=true;updateControls();}});
video.addEventListener('error',()=>{if(state.ready)showError(new Error('视频连接中断'));});
video.addEventListener('ended',()=>{state.buffering=false;render(lastFrame());updateControls();if(state.loop&&state.ready&&document.visibilityState==='visible')restart();});
byId('play-button').addEventListener('click',togglePlay);
byId('restart-button').addEventListener('click',restart);
function toggleLoop() {
  if(!state.ready)return;
  state.loop=!state.loop;byId('loop-button').setAttribute('aria-pressed',String(state.loop));
  byId('loop-button').title=state.loop?'关闭循环播放（L）':'循环播放（L）';
  toast(state.loop?'已开启循环播放':'已关闭循环播放');
}
byId('loop-button').addEventListener('click',toggleLoop);
byId('retry-load').addEventListener('click',()=>loadScene(state.task,state.variant,state.frame));
byId('quality').addEventListener('change',()=>loadScene(state.task,state.variant,state.frame));
byId('step-back').addEventListener('click',()=>seek((state.pendingFrame ?? state.frame)-1));
byId('step-forward').addEventListener('click',()=>seek((state.pendingFrame ?? state.frame)+1));
document.querySelectorAll('#timeline, [data-playback-timeline]').forEach(el=>el.addEventListener('input',()=>seek(Number(el.value))));
document.querySelectorAll('[data-playback-toggle]').forEach(el=>el.addEventListener('click',togglePlay));
byId('speed').addEventListener('change',event=>{video.playbackRate=Number(event.target.value);});
document.querySelectorAll('[data-difficulty]').forEach(el=>el.addEventListener('click',()=>{if(state.task!==el.dataset.difficulty||!state.ready)loadScene(el.dataset.difficulty);}));
document.querySelectorAll('[data-scene]').forEach(el=>el.addEventListener('click',()=>{if(state.variant!==Number(el.dataset.scene)||!state.ready)loadScene(state.task,el.dataset.scene);}));
byId('scene-choices').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();
  const current=Number(document.activeElement?.dataset.scene)||state.variant;
  const next=event.key==='Home'?1:event.key==='End'?3:((current-1+(event.key==='ArrowRight'?1:2))%3)+1;
  const button=byId('scene-choices').querySelector(`[data-scene="${next}"]`);button.focus();button.click();
});
document.querySelectorAll('[data-cell]').forEach(button=>button.addEventListener('click',()=>{
  state.cell=Number(button.dataset.cell);
  document.querySelectorAll('[data-cell]').forEach(el=>{el.classList.toggle('selected',el===button);el.setAttribute('aria-pressed',String(el===button));});
  render();
}));
document.querySelectorAll('[data-camera-view]').forEach(button=>button.addEventListener('click',()=>{
  state.expanded=button.dataset.cameraView;
  byId('camera-dialog-title').textContent=state.expanded==='follow'?'高清跟随镜头':'TOPDOWN · 固定俯视镜头';
  byId('camera-dialog-resolution').textContent=`1280 × 720 · ${task().name} · ${sceneTitle()}`;
  byId('camera-dialog').showModal();render();
}));

for(const id of ['info','camera']) byId(`${id}-close`).addEventListener('click',()=>byId(`${id}-dialog`).close());
byId('info-open').addEventListener('click',()=>{video.pause();byId('info-dialog').showModal();});
byId('cell-types-open').addEventListener('click',()=>{video.pause();byId('cell-type-details').open=true;byId('info-dialog').showModal();byId('cell-type-details').scrollIntoView({block:'nearest'});});
byId('network-cell-types').addEventListener('click',event=>{if(event.target.closest('button'))byId('info-dialog').close();});
byId('camera-original').addEventListener('click',()=>{byId('camera-original').download=`ConnectomeFlight-${state.task}-scene${state.variant}-frame${state.frame+1}.png`;byId('camera-original').href=byId('camera-image-large').toDataURL('image/png');});
for(const dialog of document.querySelectorAll('dialog')) {
  let pressedBackdrop=false;
  const outside=event=>{const r=dialog.getBoundingClientRect();return event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);};
  dialog.addEventListener('pointerdown',event=>{pressedBackdrop=outside(event);});
  dialog.addEventListener('pointerup',event=>{if(pressedBackdrop&&outside(event))dialog.close();pressedBackdrop=false;});
}
function updateShareLink() {
  const url=new URL(location.href);url.hash='';url.searchParams.set('task',state.task);url.searchParams.set('scene',String(state.variant));
  if(byId('share-frame').checked)url.searchParams.set('frame',String(state.frame));else url.searchParams.delete('frame');
  byId('share-url').value=url.href;
  byId('share-feedback').textContent='打开链接后，可继续播放或切换其他场景。';
}
byId('share-open').addEventListener('click',()=>{
  video.pause();updateShareLink();
  byId('share-description').textContent=`${task().name} · ${sceneTitle()} · ${variantInfo().detail} · 第 ${state.frame+1} 帧`;
  byId('share-feedback').textContent='打开链接后，可继续播放或切换其他场景。';
  byId('share-dialog').showModal();
});
byId('share-close').addEventListener('click',()=>byId('share-dialog').close());
byId('share-frame').addEventListener('change',updateShareLink);
byId('share-url').addEventListener('click',()=>byId('share-url').select());
byId('share-copy').addEventListener('click',async()=>{
  const value=byId('share-url').value;
  try {
    await navigator.clipboard.writeText(value);
    if(byId('share-url').value===value){byId('share-feedback').textContent='链接已复制，可以直接分享。';toast('场景链接已复制');}
    else byId('share-feedback').textContent='分享选项已变更，请重新复制链接。';
  } catch {
    byId('share-url').focus();byId('share-url').select();
    byId('share-feedback').textContent='链接已选中，请使用系统复制操作。';
  }
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){state.resumeAfterBuffer=false;video.pause();state.buffering=false;updateControls();}});
window.addEventListener('resize',()=>{if(state.ready)render();});

window.addEventListener('keydown',event=>{
  if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||byId('info-dialog').open||byId('share-dialog').open||document.activeElement?.isContentEditable||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  if(event.code==='Space'&&document.activeElement?.tagName!=='BUTTON'){event.preventDefault();togglePlay();}
  if(event.code==='ArrowLeft'){event.preventDefault();seek((state.pendingFrame ?? state.frame)-1);}
  if(event.code==='ArrowRight'){event.preventDefault();seek((state.pendingFrame ?? state.frame)+1);}
  if(event.code==='KeyR'){event.preventDefault();restart();}
  if(event.code==='KeyL'){event.preventDefault();toggleLoop();}
});
for(const [selector,attribute] of [['.task-switcher','difficulty'],['.cell-controls','cell']]) {
  document.querySelector(selector).addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const buttons=[...event.currentTarget.querySelectorAll(`[data-${attribute}]`)];
    const index=buttons.indexOf(document.activeElement);if(index<0)return;
    event.preventDefault();event.stopPropagation();
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length;
    buttons[next].focus();buttons[next].click();
  });
}
function canvasContext(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth; canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function hexGeometry(width, height) {
  const unit = Math.min((width - 9) / 28.8, (height - 9) / 32.5);
  return { unit, radius: unit / Math.sqrt(3) * 0.97, x0: width / 2, y0: height / 2 };
}
function hexCenter(uv, geometry) {
  const [u, v] = uv;
  // FlyVis BoxEye receptor_centers are stored as (y, x) = (u + v/2, v).
  // Scale x by sqrt(3)/2 only to draw a regular hex lattice.
  return [geometry.x0 + v * Math.sqrt(3) / 2 * geometry.unit,
    geometry.y0 + (u + v / 2) * geometry.unit];
}

const hexPaths=new WeakMap();
function drawHex(canvas, kind, eye) {
  const { ctx, width, height } = canvasContext(canvas);
  const uv = state.scene.hexUV;
  let cached=hexPaths.get(canvas);
  if(!cached||cached.width!==width||cached.height!==height||cached.uv!==uv) {
    const geometry=hexGeometry(width,height);
    const paths=uv.map(point=>{
      const [x,y]=hexCenter(point,geometry),path=new Path2D();
      for(let p=0;p<6;p++){const a=p*Math.PI/3,px=x+Math.cos(a)*geometry.radius,py=y+Math.sin(a)*geometry.radius;if(p===0)path.moveTo(px,py);else path.lineTo(px,py);}
      path.closePath();return path;
    });
    cached={width,height,uv,paths};hexPaths.set(canvas,cached);
  }
  ctx.fillStyle = '#0d1820';
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < uv.length; i++) {
    const index = kind === 'visual' ? state.scene.sensorOffsets.hexVisual + eye * 721 + i : state.scene.sensorOffsets.hexActivity + (eye * 8 + state.cell) * 721 + i;
    ctx.fillStyle = modelNetwork.colorAt(index);
    ctx.fill(cached.paths[i]);
  }
}


function drawTrajectory() {
  const canvas = byId('trajectory');
  const { ctx, width, height } = canvasContext(canvas);
  const points = state.scene.positionsXYZCm;
  const obstacles = state.scene.obstaclePositionsXYCm;
  const source = state.scene.sourcePositionXYCm;
  const sphere = state.scene.goalSphereRadiusCm;
  const marker = state.scene.goalMarkerSegmentXYCm;
  const markerPoint = fraction => marker[0].map((v, axis) => v + (marker[1][axis] - v) * (fraction + .5));
  const markerEnds = marker ? [markerPoint(-.5), markerPoint(.5)] : [];
  const allX = [...points.map((p) => p[0]), ...obstacles.map((p) => p[0]), ...markerEnds.map(p => p[0]), ...(state.scene.goalPositionsXYCm || []).map(p => p[0]), source[0]];
  const allY = [...points.map((p) => p[1]), ...obstacles.map((p) => p[1]), ...markerEnds.map(p => p[1]), ...(state.scene.goalPositionsXYCm || []).map(p => p[1]), source[1]];
  const minX = Math.min(...allX) - 2.5, maxX = Math.max(...allX) + 2.5;
  const minY = Math.min(...allY) - 2.5, maxY = Math.max(...allY) + 2.5;
  // Rotate the display by 90 degrees in a tall panel; preserve uniform scale and scene geometry.
  const vertical = height > width * 1.2;
  const scale = Math.min((width - 34) / (vertical ? maxY - minY : maxX - minX), (height - 34) / (vertical ? maxX - minX : maxY - minY));
  const worldWidth = (vertical ? maxY - minY : maxX - minX) * scale, worldHeight = (vertical ? maxX - minX : maxY - minY) * scale;
  const offsetX = (width - worldWidth) / 2, offsetY = (height - worldHeight) / 2;
  const project = (p) => vertical
    ? [width - offsetX - (p[1] - minY) * scale, height - offsetY - (p[0] - minX) * scale]
    : [offsetX + (p[0] - minX) * scale, height - offsetY - (p[1] - minY) * scale];
  const unproject = (p) => vertical
    ? [minX + (height - offsetY - p[1]) / scale, minY + (width - offsetX - p[0]) / scale]
    : [minX + (p[0] - offsetX) / scale, minY + (height - offsetY - p[1]) / scale];
  const odor = state.scene.odorConcentrations;
  byId('trajectory-view').textContent = vertical ? '俯视 · X↑' : '俯视 · X→';
  ctx.fillStyle = '#0d1820'; ctx.fillRect(0, 0, width, height);
  if (odor) odorField.draw(ctx, { width, height, unproject, source, time: state.frame * .05 });
  ctx.strokeStyle = 'rgba(170,199,207,.07)'; ctx.lineWidth = 1;
  const extraX = (vertical ? offsetY : offsetX) / scale, extraY = (vertical ? offsetX : offsetY) / scale;
  for (let x = Math.ceil((minX - extraX) / 2) * 2; x <= maxX + extraX; x += 2) {
    const [px, py] = project([x, 0]); ctx.beginPath(); ctx.moveTo(vertical ? 0 : px, vertical ? py : 0); ctx.lineTo(vertical ? width : px, vertical ? py : height); ctx.stroke();
  }
  for (let y = Math.ceil((minY - extraY) / 2) * 2; y <= maxY + extraY; y += 2) {
    const [px, py] = project([0, y]); ctx.beginPath(); ctx.moveTo(vertical ? px : 0, vertical ? 0 : py); ctx.lineTo(vertical ? px : width, vertical ? height : py); ctx.stroke();
  }
  ctx.fillStyle = '#79949f'; ctx.font = '9px ui-monospace,monospace'; ctx.textAlign = 'left';
  ctx.fillText(vertical ? 'Y ←' : 'Y ↑', 11, 17);
  ctx.fillText('2 cm', 11, height - 19); ctx.strokeStyle = '#79949f';
  ctx.beginPath(); ctx.moveTo(11, height - 11); ctx.lineTo(11 + scale * 2, height - 11); ctx.stroke();
  obstacles.forEach((position, i) => {
    const [x, y] = project(position), radius = state.scene.obstacleRadiiCm[i] * scale;
    ctx.fillStyle = '#2b414b'; ctx.strokeStyle = '#728b96'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, Math.max(radius, 3), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d2e0e5'; ctx.font = '9px ui-monospace,monospace'; ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), x, y + 3);
  });
  (state.scene.goalPositionsXYCm || []).forEach((goal, index) => {
    if (index === state.scene.activeGoal) return;
    const [gx, gy] = project(goal);
    ctx.strokeStyle = '#92a5b6'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(gx, gy, 5, 0, Math.PI * 2); ctx.stroke();
  });
  const [tx, ty] = project(source);
  if (sphere) {
    ctx.fillStyle = '#e6d499'; ctx.beginPath(); ctx.arc(tx, ty, sphere * scale, 0, Math.PI * 2); ctx.fill();
  }
  if (marker) {
    for (let column = 0; column < 3; column++) {
      const a = project(markerPoint(column / 3 - .5));
      const b = project(markerPoint((column + 1) / 3 - .5));
      ctx.strokeStyle = column % 2 ? '#59656c' : '#e7edee'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    }
  }
  ctx.strokeStyle = '#dfbb83'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(tx, ty, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tx - 12, ty); ctx.lineTo(tx - 8, ty); ctx.moveTo(tx + 8, ty); ctx.lineTo(tx + 12, ty); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tx, ty - 12); ctx.lineTo(tx, ty - 8); ctx.moveTo(tx, ty + 8); ctx.lineTo(tx, ty + 12); ctx.stroke();
  ctx.fillStyle = '#dfbb83'; ctx.font = '600 10px -apple-system, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(state.scene.odorFeatures ? '气味源' : sphere ? '球形目标' : marker ? '棋盘目标' : '目标', tx, ty + 25);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = '#617b84'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
  ctx.beginPath(); points.forEach((p, i) => { const [x, y] = project(p); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = TRACE_COLOR; ctx.lineWidth = 2.5;
  ctx.beginPath(); points.slice(0, state.frame + 1).forEach((p, i) => { const [x, y] = project(p); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
  const [sx, sy] = project(points[0]);
  ctx.fillStyle = '#0d1820'; ctx.strokeStyle = TRACE_COLOR; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#9fbbb4'; ctx.fillText('起点', sx, sy + 22);
  const position = points[state.frame], previous = points[Math.max(0, state.frame - 1)];
  const following = points[Math.min(points.length - 1, state.frame + 1)];
  const [fx, fy] = project(position);
  ctx.fillStyle = '#a9dfc71a'; ctx.beginPath(); ctx.arc(fx, fy, 16, 0, Math.PI * 2); ctx.fill();
  const angle = Math.atan2(following[1] - previous[1], following[0] - previous[0]);
  ctx.save(); ctx.translate(fx, fy); ctx.rotate(-angle - (vertical ? Math.PI / 2 : 0));
  ctx.fillStyle = TRACE_COLOR; ctx.strokeStyle = '#0d1820'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, -6); ctx.lineTo(-4, 0); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}


function bindPanelDivider() {
  const workspace = document.querySelector('.workspace');
  const flight = byId('flight-panel');
  const divider = byId('panel-divider');
  const desktop = window.matchMedia('(min-width:1100px) and (min-height:720px)');
  let preferredRatio = null;
  let drag = null;

  const limits = () => {
    const style = getComputedStyle(workspace);
    const available = workspace.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - parseFloat(style.rowGap);
    const min = Math.min(160, available * .48);
    // Both panels retain useful minimum heights; the camera never gains stretched space.
    const max = Math.max(min, Math.min((flight.clientWidth - 10) * 9 / 32 + 116, available - Math.min(278, available - min)));
    return { available, min, max };
  };
  const sync = () => {
    if (!desktop.matches) { workspace.style.removeProperty('--flight-height'); divider.hidden = true; return; }
    const { available, min, max } = limits();
    divider.hidden = max - min < 2;
    if (preferredRatio === null) workspace.style.removeProperty('--flight-height');
    else workspace.style.setProperty('--flight-height', `${clamp(preferredRatio * available, min, max)}px`);
    const height = flight.getBoundingClientRect().height;
    const percent = Math.round(height / available * 100);
    divider.setAttribute('aria-valuemin', String(Math.round(min / available * 100)));
    divider.setAttribute('aria-valuemax', String(Math.round(max / available * 100)));
    divider.setAttribute('aria-valuenow', String(percent));
    divider.setAttribute('aria-valuetext', `飞行画面 ${percent}%，模型活动 ${100 - percent}%`);
  };
  const adjust = height => {
    if (!desktop.matches) return;
    const { available, min, max } = limits();
    preferredRatio = clamp(height, min, max) / available;
    sync();
  };
  const reset = () => { preferredRatio = null; sync(); };
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !desktop.matches) return;
    event.preventDefault();
    divider.focus({ preventScroll: true });
    drag = { y: event.clientY, height: flight.getBoundingClientRect().height, pointer: event.pointerId };
    divider.setPointerCapture(event.pointerId);
    workspace.classList.add('is-resizing');
  });
  divider.addEventListener('pointermove', event => {
    if (drag && event.pointerId === drag.pointer) adjust(drag.height + event.clientY - drag.y);
  });
  const release = () => { drag = null; workspace.classList.remove('is-resizing'); };
  divider.addEventListener('pointerup', release);
  divider.addEventListener('pointercancel', release);
  divider.addEventListener('lostpointercapture', release);
  divider.addEventListener('dblclick', reset);
  divider.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Home') reset();
    else if (event.key === 'End') adjust(limits().max);
    else adjust(flight.getBoundingClientRect().height + (event.key === 'ArrowUp' ? -1 : 1) * (event.shiftKey ? 36 : 12));
  });
  new ResizeObserver(sync).observe(workspace);
  window.addEventListener('resize', sync);
  sync();
}

bindPanelDivider();
const initialQuery=new URLSearchParams(location.search);
loadScene(initialQuery.get('task'),initialQuery.get('scene')||1,Number(initialQuery.get('frame')));
window.addEventListener('popstate',()=>{const query=new URLSearchParams(location.search);loadScene(query.get('task'),query.get('scene')||1,Number(query.get('frame')));});
