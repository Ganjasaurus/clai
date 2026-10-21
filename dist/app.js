import {Studio,createPreset} from './studio.js';
import {History,encodeProject,decodeProject,exportOBJ} from './sculpt.js';
import {readCreation,writeCreation,listCreations,deleteCreation} from './storage.js';
import {PRIMITIVES} from './primitives.js';
import {ClayAudio} from './audio.js';

const $=id=>document.getElementById(id);
const icon=(name,classes='')=>`<svg class="icon ${classes}" aria-hidden="true"><use href="./icons.svg#${name}"/></svg>`;
const escapeHTML=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const palette=[['Apricot','#ed8857'],['Butter','#e7bd54'],['Leaf','#89a275'],['Ocean','#688fb6'],['Lilac','#a69cc3'],['Milk','#f3e8cd'],['Ink','#40463e']];
const toolCopy={push:['A little squish','Press the clay inward','squish'],pull:['A little stretch','Pull the clay outward','stretch'],grow:['A little more clay','Hold to build rounded volume','grow'],smooth:['Smooth things out','Soften bumps and edges','smooth'],paint:['Make it colorful','Brush a little color on','paint'],stamp:['A little new shape','Tap the clay to blend it in','add a shape'],hole:['Peek right through','Tap to make a tunnel','make a hole'],carve:['Scoop a little away','Hold to carve into your clay','carve'],flatten:['A lovely flat spot','Gently flatten the surface','flatten'],move:['A little wiggle room','Drag to move your view','move'],clay:['Draw with clay','Draw raised lines, even past an edge','build'],engrave:['Little lines in clay','Draw a narrow groove','engrave'],polish:['A finishing touch','Gently soften tiny bumps','polish'],fill:['Color it all','Tap once to color the whole creation','fill']};
const folders={
  shape:{title:'Shape & build',hint:'A squish, a stretch, a little more.',tools:[['push','Squish','push'],['pull','Stretch','pull'],['grow','Grow','grow'],['clay','Clay pen','clay']]},
  cut:{title:'Cut & carve',hint:'Scoop away or peek right through.',tools:[['carve','Carve','carve'],['engrave','Engrave','engrave'],['hole','Hole','hole']]},
  finish:{title:'Smooth & level',hint:'A lovely little finishing touch.',tools:[['smooth','Smooth','smooth'],['flatten','Flatten','flatten'],['polish','Polish','spark']]},
  paint:{title:'Draw & color',hint:'Make your mark, big or small.',tools:[['paint','Pen','pencil'],['paint','Brush','paint'],['paint','Spray','spray'],['fill','Fill all','fill']]}
};
const toolFolder=tool=>tool==='stamp'?'shapes':Object.keys(folders).find(key=>folders[key].tools.some(t=>t[0]===tool))||'shape';
let openFolder=null,drawerTrigger=null,drawerCloseAnimation=null,paintStyle='pen',paintOpacity=1;
const audio=new ClayAudio({onChange:()=>{$('sound').setAttribute('aria-pressed',String(audio.music||audio.effects));$('sound').title=audio.music||audio.effects?'Studio sounds · on':'Studio sounds · muted';}});
let primitiveType='ball',primitiveBlend=.22;
let studio,history=new History(),shelfId=null,saveTimer,toastTimer,selectedColor=palette[0][1],savedRevision=0,revision=0,loading=true,saveQueue=Promise.resolve(),storageAvailable=true;

function toast(message){$('toast').textContent=message;$('toast').classList.add('toast-visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('toast-visible'),3200);}
function setStatus(text,saved=true){$('save-status').replaceChildren();const dot=document.createElement('i');dot.style.background=saved?'#80a378':'#d6a45c';$('save-status').append(dot,document.createTextNode(text));}
function name(){return $('project-name').value.trim()||'My little creation';}
function refreshHistory(){$('undo').disabled=!history.canUndo;$('redo').disabled=!history.canRedo;}
function changed(){if(loading)return;history.push(studio.snapshot(name()));refreshHistory();scheduleSave();}
function scheduleSave(){revision++;setStatus(storageAvailable?'Saving your clay…':'Download to keep your clay',false);clearTimeout(saveTimer);saveTimer=setTimeout(saveCurrent,600);}
function saveCurrent(){
  clearTimeout(saveTimer);if(!studio)return Promise.resolve();
  const record={id:'current',snapshot:studio.snapshot(name()),shelfId,updated:Date.now()},rev=revision;
  saveQueue=saveQueue.catch(()=>{}).then(()=>writeCreation(record)).then(()=>{storageAvailable=true;savedRevision=rev;if(rev===revision)setStatus('Saved on this device');}).catch(()=>{storageAvailable=false;setStatus('Download to keep your clay',false);});
  return saveQueue;
}
function selectTool(tool){
  studio.finishGesture();studio.setTool(tool);studio.paintStyle=paintStyle;
  const group=toolFolder(tool),entry=folders[group]?.tools.find(t=>t[0]===tool&&(tool!=='paint'||t[2]==={pen:'pencil',brush:'paint',spray:'spray'}[paintStyle]));
  const label=tool==='stamp'?PRIMITIVES[primitiveType].label:tool==='move'?'Move':entry?.[1]||tool;
  const symbol=tool==='stamp'?'blend':tool==='move'?'move':entry?.[2]||tool;
  document.querySelectorAll('[data-folder]').forEach(b=>{const active=b.dataset.folder===group&&tool!=='move';b.classList.toggle('active',active);if(b.dataset.folder!=='color')b.setAttribute('aria-label',`${b.querySelector('span').textContent} tools${active?` · ${label} selected`:''}`);});
  document.querySelectorAll('[data-tool]').forEach(b=>{const active=b.dataset.tool===tool&&(!b.dataset.paint||b.dataset.paint===paintStyle);b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  $('move-object').setAttribute('aria-pressed',String(tool==='move'));
  const selected=document.querySelector(`[data-folder="${group}"] use`);if(selected&&tool!=='move')selected.setAttribute('href',`./icons.svg#${symbol}`);
  const sizeLabel=tool==='stamp'?'Shape size':tool==='hole'?'Hole size':tool==='paint'?'Pen size':'Brush size';$('brush-size-label').textContent=sizeLabel;$('brush-size').setAttribute('aria-label',sizeLabel);$('brush-size').disabled=['move','fill'].includes(tool);$('mirror').disabled=['move','fill'].includes(tool);
  $('strength-setting').hidden=['paint','fill','stamp','hole','move'].includes(tool);$('opacity-setting').hidden=!['paint','fill'].includes(tool);$('blend-setting').hidden=tool!=='stamp';$('size-button').disabled=tool==='move';$('size-button').setAttribute('aria-label',`${label} size and touch`);
  $('gesture-hint').querySelector('span').innerHTML=tool==='stamp'?'Tap clay to blend in a shape <b>·</b> Drag empty space to turn':tool==='hole'?'Tap clay to make a hole <b>·</b> Undo brings the clay back':tool==='move'?'Drag to move your creation <b>·</b> Tap the percentage to center it':tool==='clay'?'Draw from the clay into the space around it <b>·</b> Undo anytime':`Drag clay to ${toolCopy[tool][2]} <b>·</b> Drag the space to turn <b>·</b> Pinch to zoom`;
}
function selectColor(color,paint=true){
  selectedColor=color;studio.setColor(color);$('current-color').style.background=color;
  if($('custom-color'))$('custom-color').value=color;
  const label=palette.find(p=>p[1]===color)?.[0]||color;$('color-button').setAttribute('aria-label',`Color · ${label} selected`);
  document.querySelectorAll('.swatch').forEach(b=>{b.classList.toggle('selected',b.dataset.color===color);b.setAttribute('aria-pressed',String(b.dataset.color===color));});
  if(paint&&!['stamp','clay','fill'].includes(studio.tool))selectTool('paint');
}
function closeDrawer(restoreFocus=false,animate=true){
  const trigger=drawerTrigger,panel=$('tool-drawer');drawerCloseAnimation?.cancel();drawerCloseAnimation=null;
  document.querySelectorAll('[aria-controls="tool-drawer"]').forEach(b=>b.setAttribute('aria-expanded','false'));
  openFolder=null;drawerTrigger=null;
  if(animate&&!panel.hidden&&panel.animate&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
    const above=panel.dataset.direction==='up',animation=panel.animate([{opacity:1,clipPath:'inset(0 0 0 0 round 16px)'},{opacity:0,clipPath:above?'inset(100% 0 0 0 round 16px)':'inset(0 100% 0 0 round 16px)'}],{duration:130,easing:'ease-in',fill:'forwards'});
    drawerCloseAnimation=animation;animation.finished.then(()=>{if(drawerCloseAnimation===animation){panel.hidden=true;animation.cancel();drawerCloseAnimation=null;}}).catch(()=>{});
  }else panel.hidden=true;
  if(restoreFocus)trigger?.focus({preventScroll:true});
}
function positionDrawer(){
  if(!drawerTrigger||!$('tool-drawer').getBoundingClientRect)return;
  const panel=$('tool-drawer'),area=$('workspace').getBoundingClientRect(),anchor=drawerTrigger.getBoundingClientRect(),gap=8;
  const portrait=area.width<=620&&area.height>area.width,rail=!!drawerTrigger.closest('.tool-rail');
  const space=rail&&!portrait?area.right-anchor.right-18:area.width-20;
  panel.style.maxWidth=`${Math.max(100,Math.min(384,space))}px`;panel.style.maxHeight=`${Math.max(90,area.height-20)}px`;
  const {width,height}=panel.getBoundingClientRect();let x=anchor.right-area.left+gap,y=anchor.top-area.top+(anchor.height-height)/2;
  panel.dataset.direction='right';
  if(portrait||!rail){x=anchor.left-area.left+(anchor.width-width)/2;y=anchor.top-area.top-height-gap;panel.dataset.direction='up';if(y<10){y=anchor.bottom-area.top+gap;panel.dataset.direction='down';}}
  panel.style.left=`${Math.max(10,Math.min(x,area.width-width-10))}px`;panel.style.top=`${Math.max(10,Math.min(y,area.height-height-10))}px`;
}
function openDrawer(key,trigger,title,content){
  if(openFolder===key&&drawerTrigger===trigger){closeDrawer();return false;}
  closeDrawer(false,false);studio.finishGesture();openFolder=key;drawerTrigger=trigger;
  const panel=$('tool-drawer');panel.setAttribute('aria-label',title);panel.classList.toggle('selection-strip',!['size','sound'].includes(key));
  $('drawer-content').innerHTML=content;$('size-settings').hidden=key!=='size';
  void panel.offsetWidth;panel.hidden=false;trigger.setAttribute('aria-expanded','true');positionDrawer();return true;
}
function showSize(){openDrawer('size',$('size-button'),'Size and touch','');}
function showFolder(key,trigger=document.querySelector(`[data-folder="${key}"]`)){
  if(key==='shapes')return showPrimitives(trigger);if(key==='color')return showColors(trigger);
  const folder=folders[key];
  const choices=folder.tools.map(([tool,label,symbol],i)=>{const style=key==='paint'&&tool==='paint'?['pen','brush','spray'][i]:null,active=studio.tool===tool&&(!style||style===paintStyle);return `<button class="folder-choice${active?' active':''}" data-tool="${tool}" ${style?`data-paint="${style}"`:''} aria-pressed="${active}">${icon(symbol)}<span>${label}</span></button>`;}).join('');
  if(!openDrawer(key,trigger,folder.title,`<div class="folder-choices">${choices}</div>`))return;
  document.querySelectorAll('[data-tool]').forEach(button=>button.onclick=()=>{if(button.dataset.paint)paintStyle=button.dataset.paint;selectTool(button.dataset.tool);closeDrawer(true);});
}

function showColors(trigger=$('color-button')){
  if(!openDrawer('color',trigger,'A little color',`<div id="swatches" class="drawer-swatches">${palette.map(([label,color])=>`<button class="swatch${selectedColor===color?' selected':''}" style="--color:${color}" data-color="${color}" aria-label="${label}" title="${label}" aria-pressed="${selectedColor===color}"></button>`).join('')}<label class="custom-color" title="Mix your own color"><input type="color" id="custom-color" value="${selectedColor}" aria-label="Mix your own color">${icon('plus')}</label></div>`))return;
  document.querySelectorAll('.swatch').forEach(b=>b.onclick=()=>{selectColor(b.dataset.color);closeDrawer(true);});$('custom-color').oninput=e=>selectColor(e.target.value);$('custom-color').onchange=()=>closeDrawer(true);
}
function openModal(html,eyebrow='YOUR LITTLE STUDIO'){
  closeDrawer();studio.finishGesture();$('modal-content').innerHTML=html;$('modal-eyebrow').textContent=eyebrow;$('modal').setAttribute('aria-labelledby','modal-title');
  if(!$('modal').open)$('modal').showModal();
}
function closeModal(){$('modal').close();}

const previews={
  head:'<ellipse cx="24" cy="49" rx="9" ry="13"/><ellipse cx="76" cy="49" rx="9" ry="13"/><path d="M24 43c0-43 52-43 52 0 0 26-12 44-26 44S24 69 24 43Z"/><ellipse cx="50" cy="53" rx="5" ry="7" fill="#d87b51"/><circle cx="39" cy="42" r="3" fill="#434737"/><circle cx="61" cy="42" r="3" fill="#434737"/><path d="M42 66q8 6 16 0" stroke="#434737" stroke-width="2" fill="none" stroke-linecap="round"/>',
  egg:'<path d="M50 12c-13 0-27 32-27 47a27 27 0 0 0 54 0c0-15-14-47-27-47Z"/><ellipse cx="40" cy="38" rx="6" ry="10" fill="white" opacity=".22" transform="rotate(20 40 38)"/>',
  capsule:'<rect x="31" y="9" width="38" height="78" rx="19" transform="rotate(22 50 48)"/><path d="m44 29-7 18" stroke="white" stroke-width="6" opacity=".22" stroke-linecap="round"/>',
  cube:'<path d="M15 31q0-5 5-7l25-13q5-2 10 0l25 13q5 2 5 7v37q0 5-5 7L55 88q-5 2-10 0L20 75q-5-2-5-7Z"/><path d="m18 28 32 17 32-17M50 45v42" fill="none" stroke="white" stroke-opacity=".3" stroke-width="3"/>',
  bunny:'<ellipse cx="50" cy="61" rx="23" ry="25"/><ellipse cx="40" cy="22" rx="8" ry="20" transform="rotate(-9 40 22)"/><ellipse cx="61" cy="22" rx="8" ry="20" transform="rotate(9 61 22)"/><ellipse cx="50" cy="43" rx="24" ry="21"/><ellipse cx="36" cy="83" rx="13" ry="7"/><ellipse cx="64" cy="83" rx="13" ry="7"/><ellipse cx="50" cy="65" rx="13" ry="15" fill="#f7dab0"/><circle cx="41" cy="43" r="2.8" fill="#434737"/><circle cx="59" cy="43" r="2.8" fill="#434737"/>',
  blob:'<path d="M24 71c-5-24 2-55 24-55s33 23 28 52c-1 15-14 20-27 19S28 84 24 71Z"/><circle cx="40" cy="44" r="3" fill="#434737"/><circle cx="58" cy="44" r="3" fill="#434737"/><path d="M45 54q4 4 8 0" fill="none" stroke="#434737" stroke-width="2" stroke-linecap="round"/>',
  mushroom:'<path d="M38 49h25l6 30q-18 17-37 0Z" fill="#f7dab0"/><path d="M13 49c3-24 16-37 37-37s36 16 38 37Q51 72 13 49Z"/><ellipse cx="35" cy="32" rx="8" ry="6" fill="#f7dab0"/><ellipse cx="65" cy="42" rx="7" ry="5" fill="#f7dab0"/><circle cx="44" cy="71" r="2" fill="#434737"/><circle cx="57" cy="71" r="2" fill="#434737"/>',
  ball:'<circle cx="50" cy="50" r="34"/><ellipse cx="39" cy="33" rx="13" ry="9" fill="white" opacity=".2" transform="rotate(-35 39 33)"/>',
  pebble:'<path d="M18 66C3 48 23 15 47 16s43 22 40 42-49 35-69 8Z"/><path d="M27 39q5-15 20-13" stroke="white" opacity=".2" stroke-width="8" fill="none" stroke-linecap="round"/>',
  snowman:'<circle cx="50" cy="72" r="22"/><circle cx="50" cy="44" r="18"/><circle cx="50" cy="21" r="13"/><circle cx="46" cy="19" r="1.8" fill="#434737"/><circle cx="54" cy="19" r="1.8" fill="#434737"/><circle cx="50" cy="41" r="2" fill="#434737"/><circle cx="50" cy="50" r="2" fill="#434737"/>'
};
function shapePreview(id,color){return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}-fill" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".8"/></linearGradient></defs><ellipse cx="50" cy="88" rx="28" ry="5" fill="#6c765f" opacity=".1"/><g fill="url(#${id}-fill)">${previews[id]}</g></svg>`;}
function showStarters(){
  if(!openDrawer('starters',$('new-clay'),'A fresh beginning',`<div class="shape-grid starter-grid"><button class="shape-card" data-starter="head">${shapePreview('head',selectedColor)}<span>Head</span></button><button class="shape-card" data-starter="ball">${shapePreview('ball',selectedColor)}<span>Ball</span></button><button class="folder-choice" id="reset-shape" ${studio.resetAnimation?'disabled':''}>${icon('reset')}<span>Reset</span></button></div>`))return;
  document.querySelectorAll('[data-starter]').forEach(button=>button.onclick=()=>{
    const preset=createPreset(button.dataset.starter,selectedColor);studio.load(preset);$('project-name').value=preset.name;shelfId=null;studio.resetView();history.push(studio.snapshot(name()));refreshHistory();scheduleSave();selectTool('push');closeDrawer();audio.sound('stamp');toast('A fresh little beginning. Undo brings the last one back.');
  });
  $('reset-shape').onclick=()=>{closeDrawer();resetShape();};
}
function resetShape(){if(!studio.resetShape())toast('Already a lovely little ball.');}
function showSound(){
  if(!openDrawer('sound',$('sound'),'Sound',`<div class="folder-choices"><button class="folder-choice" id="music-toggle" aria-pressed="${audio.music}">${icon('music')}<span>Music</span></button><button class="folder-choice" id="effects-toggle" aria-pressed="${audio.effects}">${icon('sound')}<span>Sounds</span></button><button class="folder-choice" id="test-sound" title="Enable sounds and try a squish">${icon('hand')}<span>Try it</span></button></div><div class="setting-row sound-volume"><label for="sound-volume">Volume</label><input id="sound-volume" type="range" min="0" max="100" value="${Math.round(audio.volume*100)}"><output id="sound-volume-value">${Math.round(audio.volume*100)}%</output></div>`))return;
  for(const [id,kind] of [['music-toggle','music'],['effects-toggle','effects']])$(id).onclick=async()=>{const button=$(id);button.disabled=true;const okay=await audio.set(kind,!audio[kind]);button.setAttribute('aria-pressed',String(audio[kind]));button.disabled=false;if(!okay)toast('Sound is unavailable in this browser. Your clay is ready to play.');else if(kind==='effects')audio.sound('stamp');};
  $('sound-volume').oninput=e=>{audio.setVolume(Number(e.target.value)/100);$('sound-volume-value').textContent=`${e.target.value}%`;fillRange(e.target);};
  $('test-sound').onclick=async()=>{if(await audio.set('effects',true)){if(audio.volume===0){audio.setVolume(.75);if($('sound-volume')){$('sound-volume').value='75';$('sound-volume-value').textContent='75%';}}audio.lastSound=-Infinity;audio.sound('push');$('effects-toggle')?.setAttribute('aria-pressed','true');}else toast('Sound could not start. Try your browser’s sound settings.');};
}
function showPrimitives(trigger=$('add-shape')){
  if(!openDrawer('shapes',trigger,'Shapes',`<div class="shape-grid primitive-grid">${Object.entries(PRIMITIVES).map(([id,p])=>`<button class="shape-card" data-primitive="${id}" aria-pressed="${id===primitiveType}">${shapePreview(id,selectedColor)}<span>${p.label}</span></button>`).join('')}</div>`))return;
  document.querySelectorAll('[data-primitive]').forEach(button=>button.onclick=()=>{primitiveType=button.dataset.primitive;studio.setPrimitive(primitiveType,primitiveBlend);selectTool('stamp');closeDrawer(true);});
}
function showHelp(){
  openModal(`<h2 id="modal-title">Little hands. Big ideas.</h2><p class="subtitle">There’s no wrong way to play with clay.</p><div class="help-list"><div class="help-step">${icon('push')}<div><strong>Squish, stretch, smooth. Or grow!</strong><p>Drag to shape your clay, or hold Grow to build up rounded volume. Your clay is solid all the way through. Keep squishing inward, or choose Carve in Cut to scoop it away.</p></div></div><div class="help-step">${icon('blend')}<div><strong>A little shape, a whole new idea.</strong><p>Open Shapes, pick a ball, egg, pill, or soft cube, then tap your clay. Drag the preview into place before lifting your finger. Size opens shape size and soft blend controls. Soft blend melts joins together.</p></div></div><div class="help-step">${icon('hole')}<div><strong>Make a little window.</strong><p>Open Cut and choose Hole. Tap the clay to cut a tunnel through both sides. Drag before lifting to place it. Open Finish for Flatten, Smooth, and a gentle Polish. All these tools work with Mirror magic.</p></div></div><div class="help-step">${icon('paint')}<div><strong>A splash of you.</strong><p>Open Draw for a crisp Pen, soft Brush, misty Spray, or Fill all. Use the separate Size button for pen size and ink strength. Mirror has its own button beside Size. The Color button shows your current color; open it to choose another. Shape also has a Clay pen for drawing raised lines beyond an edge. Mirror magic paints or sculpts both sides at once.</p></div></div><div class="help-step">${icon('orbit')}<div><strong>Your own little pottery wheel.</strong><p>Switch on the wheel by the zoom buttons. It keeps turning while you sculpt or paint—even while you hold still. Drag empty space to look around, or drag with two fingers to pan the camera and pinch to zoom. The four-arrow Move button shifts your view of the whole creation. Tap the percentage to center it again.</p></div></div><div class="help-step">${icon('heart')}<div><strong>A fresh shape, in a little moment.</strong><p>Reset in New clay softly returns your clay to a ball and keeps your colors. Undo brings your shape back. Your clay saves on this device; download a clai file for a backup.</p></div></div></div><div class="help-keys">Keyboard: <kbd>1</kbd>–<kbd>5</kbd> tools · <kbd>6</kbd> reset shape · <kbd>7</kbd> add shapes · <kbd>8</kbd> hole · <kbd>9</kbd> carve · <kbd>M</kbd> move · <kbd>Ctrl/⌘ Z</kbd> undo · <kbd>Shift Z</kbd> with Ctrl/⌘ to redo · <kbd>[</kbd> <kbd>]</kbd> brush size · <kbd>0</kbd> reset view<br>Right-drag or hold <kbd>Space</kbd> on the canvas to turn. A stylus can control pressure.</div>`,'A QUICK LITTLE HOW-TO');
}
function download(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function safeName(){return name().replace(/[^a-zA-Z0-9 _-]/g,'').trim().replace(/\s+/g,'-').toLowerCase()||'my-clai';}
function showKeep(){
  openModal(`<h2 id="modal-title">Made something lovely?</h2><p class="subtitle">A tiny masterpiece deserves to be kept.</p><div class="export-options"><button class="export-card" id="export-image">${icon('image')}<span><strong>Take a picture</strong><small>A PNG of this view. Ready to show off.</small></span>${icon('chevron','chev')}</button><button class="export-card" id="export-project">${icon('folder')}<span><strong>Keep the clay</strong><small>A .clai file to open and play with later.</small></span>${icon('chevron','chev')}</button><button class="export-card" id="export-model">${icon('cube')}<span><strong>Take it into 3D</strong><small>An OBJ shape for Blender or a 3D printing app.</small></span>${icon('chevron','chev')}</button></div><button class="button primary save-shelf-button" id="save-shelf">${icon('shelf')} Keep on my shelf</button><p class="modal-footnote">Your shelf lives on this device. Download a .clai file for a backup. OBJ keeps the shape; .clai keeps colors too.</p>`,'A LITTLE KEEPSAKE');
  $('export-image').onclick=async()=>{try{const data=studio.capture(),blob=await(await fetch(data)).blob();download(blob,`${safeName()}.png`);toast('A little moment, captured.');}catch{toast('The picture could not be saved. Try keeping the clay file.');}};
  $('export-project').onclick=()=>{download(new Blob([JSON.stringify(encodeProject(studio.snapshot(name())))],{type:'application/json'}),`${safeName()}.clai`);toast('Your clay is coming with you.');};
  $('export-model').onclick=()=>{download(new Blob([exportOBJ(studio.snapshot(name()))],{type:'text/plain'}),`${safeName()}.obj`);toast('A little shape for a bigger world.');};
  $('save-shelf').onclick=async()=>{const b=$('save-shelf');b.disabled=true;b.textContent='Finding a spot…';const okay=await saveToShelf();if(okay){closeModal();toast('A lovely new addition to your shelf.');}else{b.disabled=false;b.innerHTML=icon('shelf')+' Try saving again';}};
}
async function saveToShelf(){
  const id=shelfId||globalThis.crypto?.randomUUID?.()||`clay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try{await writeCreation({id,snapshot:studio.snapshot(name()),thumbnail:studio.capture(420),updated:Date.now()});shelfId=id;await saveCurrent();return true;}catch{toast('Your shelf could not save. Download a .clai file to keep this one.');return false;}
}
async function showShelf(){
  openModal('<h2 id="modal-title">Your little collection.</h2><p class="subtitle">Finding your favorite things…</p>','MY SHELF');
  let items=[];
  try{items=await listCreations();}catch{toast('Device storage is unavailable. You can still open and download clay files.');}
  if(!$('modal').open||$('modal-eyebrow').textContent!=='MY SHELF')return;
  openModal(`<h2 id="modal-title">Your little collection.</h2><p class="subtitle">A shelf full of “I made that.”</p>${items.length?`<div class="shelf-grid">${items.map((item,i)=>`<div class="shelf-item"><button data-open="${i}" aria-label="Open ${escapeHTML(item.snapshot.name)}">${item.thumbnail?`<img src="${escapeHTML(item.thumbnail)}" alt="${escapeHTML(item.snapshot.name)}">`:shapePreview('ball','#df9d78')}<span class="shelf-info"><strong>${escapeHTML(item.snapshot.name)}</strong><small>${new Date(item.updated).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</small></span></button><button class="delete-creation" data-delete="${i}" aria-label="Delete ${escapeHTML(item.snapshot.name)}">${icon('trash')}</button></div>`).join('')}</div>`:`<div class="shelf-empty">${icon('shelf')}<p>Your shelf is waiting for its first little wonder.<br>Keep your current creation right here.</p></div>`}<div class="shelf-actions"><button class="button primary" id="shelf-keep">${icon('plus')} Keep this creation</button><button class="button" id="import-project">${icon('folder')} Open a file</button></div><p class="modal-footnote">Private to this browser and device. Download your favorites as .clai files to keep a backup.</p>`,'MY SHELF');
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{
    const item=items[Number(b.dataset.open)];studio.load(item.snapshot);$('project-name').value=item.snapshot.name;shelfId=item.id;history.push(studio.snapshot(name()));refreshHistory();scheduleSave();studio.resetView();closeModal();toast('Welcome back, little creation.');
  });
  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{
    const item=items[Number(b.dataset.delete)];openModal(`<h2 id="modal-title">Make a little room?</h2><p class="subtitle">Remove “${escapeHTML(item.snapshot.name)}” from your shelf? Any downloaded copies stay safe.</p><div class="shelf-actions"><button class="button" id="cancel-delete">Keep it</button><button class="button danger" id="confirm-delete">Remove from shelf</button></div>`,'YOUR SHELF');
    $('cancel-delete').onclick=showShelf;$('confirm-delete').onclick=async()=>{try{await deleteCreation(item.id);if(shelfId===item.id){shelfId=null;await saveCurrent();}await showShelf();toast('A little room for something new.');}catch{toast('That creation could not be removed.');}};
  });
  $('shelf-keep').onclick=async()=>{const b=$('shelf-keep');b.disabled=true;if(await saveToShelf()){await showShelf();toast('Safe on your shelf.');}else b.disabled=false;};
  $('import-project').onclick=()=>$('import-file').click();
}
function restoreHistory(direction){studio.finishGesture();const state=direction==='undo'?history.undo():history.redo();if(!state)return;studio.load(state);$('project-name').value=state.name;shelfId=null;refreshHistory();scheduleSave();}
function fillRange(input){input.style.setProperty('--fill',`${(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100}%`);}
function changeSize(value){const size=Math.max(12,Math.min(150,Number(value)||42));$('brush-size').value=String(size);studio.radius=size/100;$('brush-size-value').textContent=size<28?'S':size<65?'M':size<100?'L':'XL';fillRange($('brush-size'));studio.brushRing.scale.setScalar(studio.brushRadius?.()||studio.radius);studio.requestRender();}

async function start(){
  try{
    studio=new Studio($('viewport'),{onChange:changed,onZoom:z=>$('reset-view').innerHTML=`${z}<span>%</span>`,onFirstSculpt:()=>$('workspace').classList.add('focus-mode'),onError:toast,onSound:tool=>audio.sound(tool),onResetState:active=>{const button=$('reset-shape');if(button){button.disabled=active;button.setAttribute('aria-busy',String(active));}$('new-clay').classList.toggle('is-resetting',active);}});
  }catch(error){
    $('loading').innerHTML=`<div class="webgl-error"><h2>The clay needs a little graphics help.</h2><p>This browser couldn’t open a 3D canvas. Try a current browser with WebGL enabled.</p><button class="button" id="retry-canvas">Try again</button></div>`;$('retry-canvas').onclick=()=>location.reload();
    ['keep','open-shelf','new-clay'].forEach(id=>$(id).disabled=true);return;
  }
  let initial;
  try{const current=await readCreation('current');if(current?.snapshot){
    initial=current.snapshot;shelfId=current.shelfId||null;$('workspace').classList.add('focus-mode');
    if(current.snapshot.surface!=='solid-clay-v1')await writeCreation({id:`before-solid-${current.updated||Date.now()}`,snapshot:current.snapshot,updated:current.updated||Date.now()});
  }}catch{storageAvailable=false;}
  if(!initial)initial=createPreset();
  try{studio.load(initial);}catch{initial=createPreset();studio.load(initial);shelfId=null;toast('We started fresh because the previous save couldn’t be opened.');}
  $('project-name').value=initial.name;history.push(studio.snapshot(name()));loading=false;refreshHistory();
  $('loading').classList.add('done');setTimeout(()=>$('loading').hidden=true,450);
  if(storageAvailable)await saveCurrent();else setStatus('Download to keep your clay',false);
  selectColor(selectedColor,false);selectTool('push');
  document.querySelectorAll('[data-folder]').forEach(button=>button.onclick=e=>{showFolder(button.dataset.folder,button);if(e.detail===0&&!$('tool-drawer').hidden)$('drawer-content').querySelector('button,input')?.focus();});
  $('size-button').onclick=showSize;
  $('paint-opacity').oninput=e=>{paintOpacity=Number(e.target.value)/100;studio.paintOpacity=paintOpacity;$('paint-opacity-value').textContent=`${e.target.value}%`;fillRange(e.target);};
  $('primitive-blend').oninput=e=>{primitiveBlend=Number(e.target.value)/100;studio.primitiveBlend=primitiveBlend;$('primitive-blend-value').textContent=primitiveBlend>.33?'Melty':primitiveBlend<.18?'Gentle':'Soft';fillRange(e.target);};
  document.querySelectorAll('#size-settings input').forEach(fillRange);
  document.addEventListener('pointerdown',e=>{if(openFolder&&!e.target.closest('#tool-drawer,[aria-controls="tool-drawer"]'))closeDrawer();audio.resume();},{capture:true,passive:true});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&openFolder){e.preventDefault();closeDrawer(true);return;}if(!openFolder||!e.target.matches('.folder-choice,.shape-card,.swatch'))return;const list=[...e.target.parentElement.querySelectorAll('button')],index=list.indexOf(e.target);let next;if(['ArrowRight','ArrowDown'].includes(e.key))next=(index+1)%list.length;if(['ArrowLeft','ArrowUp'].includes(e.key))next=(index+list.length-1)%list.length;if(e.key==='Home')next=0;if(e.key==='End')next=list.length-1;if(next!==undefined){e.preventDefault();list[next].focus();}});
  window.addEventListener('resize',positionDrawer);
  $('brush-strength').oninput=e=>{studio.brushStrength=Number(e.target.value)/100;$('brush-strength-value').textContent=studio.brushStrength<.65?'Feather':studio.brushStrength>1.15?'Firm':'Gentle';fillRange(e.target);};
  $('brush-size').oninput=e=>changeSize(e.target.value);changeSize(42);
  $('mirror').onclick=()=>{studio.mirror=!studio.mirror;$('mirror').setAttribute('aria-pressed',String(studio.mirror));toast(studio.mirror?'Both sides, a little magic.':'One side at a time.');};
  $('undo').onclick=()=>restoreHistory('undo');$('redo').onclick=()=>restoreHistory('redo');
  $('new-clay').onclick=showStarters;$('move-object').onclick=()=>selectTool(studio.tool==='move'?'push':'move');$('sound').onclick=showSound;$('help').onclick=showHelp;$('keep').onclick=showKeep;$('open-shelf').onclick=showShelf;
  $('close-modal').onclick=closeModal;$('modal').addEventListener('click',e=>{if(e.target===$('modal')){const r=$('modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
  $('zoom-in').onclick=()=>studio.zoomBy(1.15);$('zoom-out').onclick=()=>studio.zoomBy(1/1.15);$('reset-view').onclick=()=>studio.resetView();
  $('spin').onclick=()=>{const active=studio.toggleSpin();$('spin').setAttribute('aria-pressed',String(active));$('spin').setAttribute('aria-label',active?'Turn pottery wheel off':'Turn pottery wheel on');};
  $('project-name').addEventListener('input',scheduleSave);$('project-name').addEventListener('change',()=>{const value=name();$('project-name').value=value;changed();});
  $('fullscreen').onclick=async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else toast('For more room, add clai to your Home Screen from your browser’s Share menu.');}catch{toast('This browser controls full screen. Try its full-screen or Home Screen option.');}
  };
  document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit full screen':'Enter full screen');$('fullscreen').title=document.fullscreenElement?'Exit full screen':'Full screen';});
  $('import-file').onchange=async e=>{
    const file=e.target.files[0];e.target.value='';if(!file)return;
    try{if(file.size>15*1024*1024)throw new Error('This file is too big. Try a smaller clai creation.');const snapshot=decodeProject(JSON.parse(await file.text()));studio.load(snapshot);$('project-name').value=snapshot.name;shelfId=null;history.push(studio.snapshot(name()));refreshHistory();scheduleSave();studio.resetView();closeModal();toast('Your little creation is back.');}catch(error){toast(error instanceof SyntaxError?'This file couldn’t be read as a clai creation.':error.message);}
  };
  window.addEventListener('keydown',e=>{
    if(e.target.matches('input,textarea')||$('modal').open)return;
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();restoreHistory(e.shiftKey?'redo':'undo');return;}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='y'){e.preventDefault();restoreHistory('redo');return;}
    if(e.metaKey||e.ctrlKey||e.altKey)return;
    const map={'1':'push','2':'pull','3':'grow','4':'smooth','5':'paint','8':'hole','9':'carve','m':'move','M':'move'};
    if(map[e.key]){e.preventDefault();selectTool(map[e.key]);}
    if(e.key==='6'){e.preventDefault();resetShape();}
    if(e.key==='7'){e.preventDefault();showPrimitives();}
    if(e.key==='[')changeSize(Number($('brush-size').value)-5);
    if(e.key===']')changeSize(Number($('brush-size').value)+5);
    if(e.key==='0')studio.resetView();
  });
  document.addEventListener('click',e=>{if(e.target.closest('button'))audio.sound('tap');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&revision!==savedRevision)saveCurrent();});
  window.addEventListener('pagehide',()=>{if(revision!==savedRevision)saveCurrent();});
}
start().catch(()=>{setStatus('Download to keep your clay',false);toast('Something paused the studio. Reload to try again.');});
