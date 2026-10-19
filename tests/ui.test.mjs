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

test('UI flows connect the ball, Grow, reset, wheel, undo, saving and the shelf',async()=>{
  const earlier=createPreset('bunny');await storage.writeCreation({id:'current',snapshot:earlier,updated:1});
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
  const source=(await fs.readFile(new URL('../dist/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
  const timers=new Set();
  const context=vm.createContext({window,document,Studio:MockStudio,createPreset,PRIMITIVES,...sculpt,...storage,console,Blob,URL,structuredClone,crypto:globalThis.crypto,
    setTimeout(fn,ms){const timer=setTimeout(()=>{timers.delete(timer);fn();},ms>=3000?1:Math.min(ms,20));timers.add(timer);return timer;},clearTimeout(timer){clearTimeout(timer);timers.delete(timer);}});
  vm.runInContext(source,context);
  const settle=async()=>{await new Promise(r=>setTimeout(r,40));};await settle();
  const click=selector=>{const element=document.querySelector(selector);assert.ok(element,selector);element.dispatchEvent(new window.Event('click',{bubbles:true}));};
  assert.equal(document.querySelectorAll('.swatch').length,7);
  click('[data-tool="pull"]');assert.equal(MockStudio.instance.tool,'pull');assert.equal(document.getElementById('tool-title').textContent,'A little stretch');
  click('.swatch[data-color="#688fb6"]');assert.equal(MockStudio.instance.tool,'paint');assert.equal(MockStudio.instance.color,'#688fb6');
  click('#mirror');assert.equal(MockStudio.instance.mirror,true);
  assert.equal(MockStudio.instance.state.meshes.length,1);assert.equal(MockStudio.instance.state.surface,'protected-ball-v1');
  assert.deepEqual((await storage.readCreation('earlier-clay-1')).snapshot,earlier,'the earlier autosave is preserved before starting with a ball');
  click('[data-tool="grow"]');assert.equal(MockStudio.instance.tool,'grow');assert.match(document.getElementById('tool-subtitle').textContent,/build rounded volume/);
  click('#spin');assert.equal(MockStudio.instance.spin,true);
  click('#reset-shape');assert.equal(MockStudio.instance.resetCalled,true);assert.equal(MockStudio.instance.tool,'grow');assert.equal(MockStudio.instance.spin,true);
  click('#add-shape');assert.equal(modal.open,true);assert.equal(document.querySelectorAll('[data-primitive]').length,4);
  const blend=document.getElementById('primitive-blend');blend.value='40';blend.dispatchEvent(new window.Event('input'));
  click('[data-primitive="capsule"]');assert.equal(modal.open,false);assert.equal(MockStudio.instance.tool,'stamp');assert.equal(MockStudio.instance.primitiveType,'capsule');assert.equal(MockStudio.instance.primitiveBlend,.4);assert.equal(document.getElementById('brush-size-label').textContent,'Shape size');
  click('.swatch[data-color="#89a275"]');assert.equal(MockStudio.instance.tool,'stamp');assert.equal(MockStudio.instance.color,'#89a275');
  const title=document.getElementById('project-name');title.value='My blue clay';title.dispatchEvent(new window.Event('change'));
  click('#new-clay');assert.equal(modal.open,false);assert.equal(title.value,'A ball of possibility');
  click('#undo');assert.equal(title.value,'My blue clay');
  click('#redo');assert.equal(title.value,'A ball of possibility');
  click('#keep');assert.ok(document.getElementById('export-project'));click('#save-shelf');await settle();assert.equal(modal.open,false);
  click('#open-shelf');await settle();assert.equal(document.querySelectorAll('[data-open]').length,2);assert.match(document.querySelector('.shelf-info').textContent,/A ball of possibility/);
  click('[data-open="0"]');assert.equal(modal.open,false);
  click('#help');assert.match(document.getElementById('modal-content').textContent,/two fingers/);assert.match(document.getElementById('modal-content').textContent,/Reset softly/);click('#close-modal');
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
