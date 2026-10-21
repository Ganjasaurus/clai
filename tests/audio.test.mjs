import test from 'node:test';
import assert from 'node:assert/strict';
import {ClayAudio} from '../dist/audio.js';

function fakeAudio(){
  const nodes=[],param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){},setTargetAtTime(){}});
  class Audio{
    constructor(){this.currentTime=1;this.state='suspended';this.destination={};Audio.instances.push(this);}
    async resume(){this.state='running';} async suspend(){this.state='suspended';} async close(){this.state='closed';}
    createGain(){return {gain:param(),connect(){},disconnect(){}};}
    createOscillator(){const oscillator={frequency:param(),connect(){},disconnect(){},start(){},stop(){},finish(){this.onended?.();}};nodes.push(oscillator);return oscillator;}
  }
  Audio.instances=[];return {Audio,nodes};
}

test('audio is silent by default, unlocks on request, and music and effects switch independently',async()=>{
  const previous=globalThis.AudioContext,{Audio,nodes}=fakeAudio();globalThis.AudioContext=Audio;let changes=0;
  const a=new ClayAudio({onChange:()=>changes++});
  try{
    assert.equal(a.music,false);assert.equal(a.effects,false);assert.equal(Audio.instances.length,0);a.sound('push');assert.equal(nodes.length,0);
    assert.equal(await a.set('effects',true),true);assert.equal(Audio.instances.length,1);a.sound('push');assert.equal(nodes.length,1);a.sound('grow');assert.equal(nodes.length,1,'rapid brush calls are throttled');
    a.context.currentTime+=.2;a.sound('carve');assert.equal(nodes.length,2);
    assert.equal(await a.set('music',true),true);assert.ok(a.timer);assert.equal(a.effects,true);assert.ok(nodes.length>2);
    await a.set('music',false);assert.equal(a.timer,null);assert.equal(a.effects,true);assert.equal(a.context.state,'running');
    await a.set('effects',false);assert.equal(a.context.state,'suspended');assert.equal(changes,4);
  }finally{a.dispose();globalThis.AudioContext=previous;}
});

test('audio pauses when hidden and caps simultaneous voices',async()=>{
  const previous=globalThis.AudioContext,{Audio,nodes}=fakeAudio();globalThis.AudioContext=Audio;const a=new ClayAudio();
  try{
    await a.set('effects',true);for(let i=0;i<40;i++){a.context.currentTime+=.2;a.sound('push');}assert.equal(nodes.length,12);
    nodes.forEach(n=>n.finish());assert.equal(a.voices.size,0);
    await a.set('music',true);a.hidden=true;a.pause();assert.equal(a.timer,null);assert.equal(a.context.state,'suspended');const count=nodes.length;a.sound('push');assert.equal(nodes.length,count);
    a.hidden=false;await a.resume();assert.equal(a.context.state,'running');assert.ok(a.timer);
  }finally{a.dispose();globalThis.AudioContext=previous;}
});

test('missing audio support fails quietly without enabling a sound toggle',async()=>{
  const old=globalThis.AudioContext,oldWebkit=globalThis.webkitAudioContext;globalThis.AudioContext=undefined;globalThis.webkitAudioContext=undefined;
  try{const a=new ClayAudio();assert.equal(await a.set('music',true),false);assert.equal(a.music,false);assert.equal(a.context,null);a.dispose();}finally{globalThis.AudioContext=old;globalThis.webkitAudioContext=oldWebkit;}
});

test('a first brush sound waits for unlock, and interrupted Safari audio can resume',async()=>{
  const previous=globalThis.AudioContext,{Audio,nodes}=fakeAudio();globalThis.AudioContext=Audio;const a=new ClayAudio();
  try{
    await a.set('effects',true);a.context.state='interrupted';let resumed=0;
    a.context.resume=async()=>{resumed++;await Promise.resolve();a.context.state='running';};
    a.sound('grow');a.sound('pull');await a.soundUnlock;
    assert.equal(resumed,1);assert.equal(nodes.length,1,'one queued tool sound survives the async unlock');
    a.pause();assert.equal(a.voices.size,0,'suspended voices cannot exhaust the voice budget');
    for(let i=0;i<20;i++){await a.resume();a.sound('push');a.pause();}
    assert.equal(a.voices.size,0);assert.equal(nodes.length,21);
    await a.resume();a.setVolume(.9);assert.equal(a.volume,.9);a.sound('paint');assert.equal(nodes.length,22);
  }finally{a.dispose();globalThis.AudioContext=previous;}
});

test('blocked resume reports failure and disposal cancels a queued sound',async()=>{
  const previous=globalThis.AudioContext,{Audio,nodes}=fakeAudio();globalThis.AudioContext=Audio;const a=new ClayAudio();
  try{
    const resume=Audio.prototype.resume;Audio.prototype.resume=async()=>{};
    assert.equal(await a.set('effects',true),false);assert.equal(a.effects,false);assert.equal(nodes.length,0);
    Audio.prototype.resume=resume;await a.set('effects',true);a.context.state='suspended';a.sound('push');a.dispose();await a.soundUnlock;assert.equal(nodes.length,0);
  }finally{a.dispose();globalThis.AudioContext=previous;}
});
