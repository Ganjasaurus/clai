import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import 'fake-indexeddb/auto';
import * as storage from '../dist/storage.js';
import * as sculpt from '../dist/sculpt.js';
import {createPreset} from '../dist/studio.js';
import {PRIMITIVES} from '../dist/primitives.js';

test('device saves, shelf records and deletion round trip typed mesh data',async()=>{
  const snapshot=createPreset('ball');
  await storage.writeCreation({id:'storage-test',snapshot,updated:1});
  const loaded=await storage.readCreation('storage-test');assert.deepEqual(loaded.snapshot,snapshot);
  await storage.writeCreation({id:'current',snapshot,updated:2});
  assert.ok(!(await storage.listCreations()).some(c=>c.id==='current'));
  await storage.deleteCreation('storage-test');assert.equal(await storage.readCreation('storage-test'),undefined);
  await storage.deleteCreation('current');
});

test('pullout folders, pen options, color, sound, starters, undo and shelf preserve existing clay',async()=>{
  const earlier=createPreset('ball');await storage.writeCreation({id:'current',snapshot:earlier,updated:1});
  const {window,document}=parseHTML(await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8'));
  const modal=document.getElementById('modal');Object.defineProperty(modal,'open',{get(){return this.hasAttribute('open');}});modal.showModal=function(){this.setAttribute('open','');};modal.close=function(){this.removeAttribute('open');};
  class MockStudio {
    constructor(el,callbacks){this.el=el;this.callbacks=callbacks;this.tool='push';this.brushRing={scale:{setScalar(){}}};this.mirror=false;MockStudio.instance=this;}
    load(snapshot){this.state=structuredClone(snapshot);}
    snapshot(name){return {...structuredClone(this.state),name};}
    finishGesture(){} setTool(tool){this.tool=tool;} setColor(color){this.color=color;}
    resetView(){this.callbacks.onZoom(100);} requestRender(){} zoomBy(){} toggleSpin(){return this.spin=!this.spin;}
    resetShape(){this.resetCalled=true;return true;}
    setPrimitive(type,blend){this.primitiveType=type;this.primitiveBlend=blend;this.tool='stamp';}
    capture(){return 'data:image/png;base64,iVBORw0KGgo=';}
  }
  class MockAudio{
    constructor(options){this.options=options;this.music=false;this.effects=false;this.volume=.75;MockAudio.instance=this;}
    async set(kind,on){this[kind]=on;this.options.onChange();return true;} sound(tool){this.lastTool=tool;} resume(){} setVolume(value){this.volume=value;}
  }
  const source=(await fs.readFile(new URL('../dist/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
  const timers=new Set();
  const context=vm.createContext({window,document,Studio:MockStudio,ClayAudio:MockAudio,createPreset,PRIMITIVES,...sculpt,...storage,console,Blob,URL,structuredClone,crypto:globalThis.crypto,
    setTimeout(fn,ms){const timer=setTimeout(()=>{timers.delete(timer);fn();},ms>=3000?1:Math.min(ms,20));timers.add(timer);return timer;},clearTimeout(timer){clearTimeout(timer);timers.delete(timer);}});
  vm.runInContext(source,context);
  const settle=async()=>{await new Promise(r=>setTimeout(r,40));};await settle();
  const click=selector=>{const element=document.querySelector(selector);assert.ok(element,selector);element.dispatchEvent(new window.Event('click',{bubbles:true}));};
  const drawer=document.getElementById('tool-drawer'),settings=document.getElementById('size-settings');
  const choose=(folder,tool)=>{click(`#${folder}`);click(`[data-tool="${tool}"]`);assert.equal(drawer.hidden,true);};
  assert.equal(drawer.hidden,true);assert.equal(document.querySelectorAll('.tool-rail button').length,6);
  assert.ok(!drawer.contains(document.getElementById('mirror')),'Mirror is a separate button');assert.ok(!drawer.contains(document.getElementById('size-button')),'Size has its own button');
  click('#shape-tools');assert.equal(drawer.hidden,false);assert.equal(modal.open,false);assert.equal(settings.hidden,true);assert.equal(document.getElementById('shape-tools').getAttribute('aria-expanded'),'true');
  assert.equal(document.querySelectorAll('#drawer-content .folder-choice').length,4);assert.equal(document.querySelectorAll('#drawer-content h2,#drawer-content p,#drawer-content input,#drawer-content small').length,0,'selection is icons and labels only');
  click('[data-tool="pull"]');assert.equal(MockStudio.instance.tool,'pull');assert.equal(drawer.hidden,true);assert.match(document.getElementById('shape-tools').getAttribute('aria-label'),/Stretch selected/);
  click('#color-button');assert.equal(document.querySelectorAll('.swatch').length,7);click('.swatch[data-color="#688fb6"]');assert.equal(MockStudio.instance.tool,'paint');assert.equal(MockStudio.instance.color,'#688fb6');assert.match(document.getElementById('color-button').getAttribute('aria-label'),/Ocean/);assert.equal(document.getElementById('current-color').style.background,'#688fb6');assert.equal(drawer.hidden,true);
  click('#paint-tools');click('[data-paint="spray"]');assert.equal(MockStudio.instance.paintStyle,'spray');assert.equal(drawer.hidden,true);
  click('#size-button');assert.equal(settings.hidden,false);assert.equal(document.getElementById('opacity-setting').hidden,false);assert.equal(document.getElementById('strength-setting').hidden,true);
  const opacity=document.getElementById('paint-opacity');opacity.value='35';opacity.dispatchEvent(new window.Event('input'));assert.equal(MockStudio.instance.paintOpacity,.35);click('#size-button');assert.equal(drawer.hidden,true);
  choose('paint-tools','fill');assert.equal(MockStudio.instance.tool,'fill');assert.equal(document.getElementById('brush-size').disabled,true);
  click('#paint-tools');click('[data-paint="pen"]');assert.equal(MockStudio.instance.paintStyle,'pen');assert.equal(document.getElementById('brush-size').disabled,false);
  click('#mirror');assert.equal(MockStudio.instance.mirror,true);assert.equal(drawer.hidden,true,'Mirror toggles without opening a panel');
  assert.equal(MockStudio.instance.state.meshes.length,1);assert.equal(MockStudio.instance.state.surface,'protected-ball-v1');
  assert.deepEqual((await storage.readCreation('before-solid-1')).snapshot,earlier,'the exact older autosave is archived before upgrading');
  choose('shape-tools','grow');assert.equal(MockStudio.instance.tool,'grow');choose('shape-tools','clay');assert.equal(MockStudio.instance.tool,'clay');
  click('#spin');assert.equal(MockStudio.instance.spin,true);
  choose('cut-tools','hole');assert.equal(MockStudio.instance.tool,'hole');assert.equal(document.getElementById('brush-size-label').textContent,'Hole size');
  choose('cut-tools','carve');assert.equal(MockStudio.instance.tool,'carve');choose('cut-tools','engrave');assert.equal(MockStudio.instance.tool,'engrave');
  choose('finish-tools','flatten');assert.equal(MockStudio.instance.tool,'flatten');choose('finish-tools','polish');assert.equal(MockStudio.instance.tool,'polish');
  click('#move-object');assert.equal(MockStudio.instance.tool,'move');assert.equal(document.getElementById('brush-size').disabled,true);
  choose('shape-tools','grow');assert.equal(document.getElementById('brush-size').disabled,false);
  click('#size-button');const size=document.getElementById('brush-size');size.value='125';size.dispatchEvent(new window.Event('input'));assert.equal(MockStudio.instance.radius,1.25);click('#size-button');
  click('#new-clay');assert.equal(document.querySelectorAll('#drawer-content p,#drawer-content small').length,0);click('#reset-shape');assert.equal(MockStudio.instance.resetCalled,true);assert.equal(MockStudio.instance.tool,'grow');assert.equal(MockStudio.instance.spin,true);
  click('#sound');assert.equal(MockAudio.instance.music,false);click('#music-toggle');await settle();assert.equal(MockAudio.instance.music,true);assert.equal(document.getElementById('sound').getAttribute('aria-pressed'),'true');click('#test-sound');await settle();assert.equal(MockAudio.instance.effects,true);assert.equal(MockAudio.instance.lastTool,'push');click('#sound');assert.equal(drawer.hidden,true);
  click('#add-shape');assert.equal(modal.open,false);assert.equal(document.querySelectorAll('[data-primitive]').length,4);assert.equal(settings.hidden,true);
  click('[data-primitive="capsule"]');assert.equal(drawer.hidden,true);assert.equal(MockStudio.instance.tool,'stamp');assert.equal(MockStudio.instance.primitiveType,'capsule');assert.equal(document.getElementById('brush-size-label').textContent,'Shape size');
  click('#size-button');assert.equal(document.getElementById('blend-setting').hidden,false);const blend=document.getElementById('primitive-blend');blend.value='40';blend.dispatchEvent(new window.Event('input'));assert.equal(MockStudio.instance.primitiveBlend,.4,'blend changes immediately for the active stamp');click('#size-button');
  click('#color-button');click('.swatch[data-color="#89a275"]');assert.equal(MockStudio.instance.tool,'stamp');assert.equal(MockStudio.instance.color,'#89a275');
  click('#color-button');click('#color-button');assert.equal(drawer.hidden,true,'the folder button toggles its pullout');
  click('#cut-tools');const escape=new window.Event('keydown',{bubbles:true});escape.key='Escape';document.getElementById('cut-tools').dispatchEvent(escape);assert.equal(drawer.hidden,true);assert.equal(document.getElementById('cut-tools').getAttribute('aria-expanded'),'false');
  click('#shape-tools');document.getElementById('viewport').dispatchEvent(new window.Event('pointerdown',{bubbles:true}));assert.equal(drawer.hidden,true,'canvas contact dismisses the pullout without a modal');
  const title=document.getElementById('project-name');title.value='My blue clay';title.dispatchEvent(new window.Event('change'));
  click('#new-clay');assert.equal(drawer.hidden,false);assert.equal(modal.open,false);assert.equal(document.querySelectorAll('[data-starter]').length,2);click('[data-starter="head"]');assert.equal(title.value,'A little somebody');assert.equal(MockStudio.instance.state.surface,'solid-clay-v1');
  click('#undo');assert.equal(title.value,'My blue clay');
  click('#new-clay');click('[data-starter="ball"]');assert.equal(modal.open,false);assert.equal(title.value,'A ball of possibility');
  click('#undo');assert.equal(title.value,'My blue clay');
  click('#redo');assert.equal(title.value,'A ball of possibility');
  click('#keep');assert.ok(document.getElementById('export-project'));click('#save-shelf');await settle();assert.equal(modal.open,false);
  click('#open-shelf');await settle();assert.equal(document.querySelectorAll('[data-open]').length,2);assert.match(document.querySelector('.shelf-info').textContent,/A ball of possibility/);
  click('[data-open="0"]');assert.equal(modal.open,false);
  click('#help');assert.match(document.getElementById('modal-content').textContent,/two fingers to pan/);assert.match(document.getElementById('modal-content').textContent,/Reset in New clay softly/);assert.match(document.getElementById('modal-content').textContent,/cut a tunnel through both sides/);click('#close-modal');
  await settle();const saved=await storage.readCreation('current');assert.equal(saved.snapshot.name,'A ball of possibility');
  for(const timer of timers)clearTimeout(timer);
});

test('all local page assets and used SVG symbols exist',async()=>{
  const root=new URL('../dist/',import.meta.url);const html=await fs.readFile(new URL('index.html',root),'utf8');
  const icons=await fs.readFile(new URL('icons.svg',root),'utf8');const app=await fs.readFile(new URL('app.js',root),'utf8');
  for(const [,asset] of html.matchAll(/(?:href|src)="\.\/([^"#]+)(?:#[^"]*)?"/g)){await fs.access(new URL(asset,root));}
  for(const [,name] of (html+app).matchAll(/icons\.svg#([a-z-]+)/g))assert.ok(icons.includes(`id="${name}"`),name);
  const {document}=parseHTML(html);const buttons=document.querySelectorAll('button');
  for(const button of buttons)assert.ok(button.getAttribute('aria-label')||button.textContent.trim(),`Button ${button.id} has an accessible name`);
  assert.ok(!html.includes('https://'),'No remote assets needed at runtime');
});
