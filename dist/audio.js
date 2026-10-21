// Quiet, original synth music and clay sounds. No downloads, autoplay, or
// continuously running audio graph when both switches are off.
export class ClayAudio {
  constructor({onChange=()=>{}}={}){
    this.music=false;this.effects=false;this.volume=.75;this.disposed=false;this.pendingSound=null;this.context=null;this.timer=null;this.voices=new Set();this.lastSound=-Infinity;this.note=0;this.onChange=onChange;
    this.hidden=typeof document!=='undefined'&&document.hidden;
    globalThis.document?.addEventListener('visibilitychange',()=>{this.hidden=document.hidden;if(this.hidden)this.pause();else this.resume();});
    globalThis.window?.addEventListener('pagehide',()=>this.pause());
    globalThis.window?.addEventListener('pageshow',()=>this.resume());
  }
  async unlock(){
    if(this.disposed)return false;
    if(!this.music&&!this.effects)return true;
    const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
    if(!Audio)return false;
    try{
      if(!this.context||this.context.state==='closed'){this.context=new Audio();this.master=this.context.createGain();this.master.gain.value=this.volume;this.master.connect(this.context.destination);this.lastSound=-Infinity;}
      if(this.context.state!=='running'&&!this.hidden)await this.context.resume();
      return this.context.state==='running';
    }catch{return false;}
  }
  async set(kind,on){
    if(!['music','effects'].includes(kind))return false;
    this[kind]=!!on;
    if(on&&!await this.unlock()){this[kind]=false;this.onChange();return false;}
    if(kind==='music'){this.stopMusic();if(this.music&&!this.hidden)this.startMusic();}
    if(kind==='effects'&&!this.effects)this.stopVoices('effect');
    if(!this.music&&!this.effects)this.pause();
    this.onChange();return true;
  }
  setVolume(value){this.volume=Math.max(0,Math.min(1,Number(value)||0));if(this.master)this.master.gain.setTargetAtTime(this.volume,this.context.currentTime,.03);}
  tone(frequency,duration,volume,time=this.context?.currentTime||0,kind='effect',endFrequency=frequency){
    const ctx=this.context;if(!ctx||ctx.state!=='running'||this.hidden||this.voices.size>=12)return;
    const oscillator=ctx.createOscillator(),gain=ctx.createGain(),voice={oscillator,gain,kind};
    oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,time);oscillator.frequency.exponentialRampToValueAtTime(Math.max(20,endFrequency),time+duration*.8);
    gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(volume,time+Math.min(.12,duration*.18));gain.gain.exponentialRampToValueAtTime(.0001,time+duration);
    oscillator.connect(gain);gain.connect(this.master);this.voices.add(voice);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();this.voices.delete(voice);};oscillator.start(time);oscillator.stop(time+duration+.02);
  }
  startMusic(){
    if(this.timer||!this.context||this.hidden||!this.music)return;
    this.nextNote=this.context.currentTime+.06;
    const schedule=()=>{
      if(this.context.state!=='running')return;
      this.nextNote=Math.max(this.nextNote,this.context.currentTime);
      const notes=[261.63,329.63,392,440,392,329.63,293.66,329.63,261.63,392,440,523.25,440,392,329.63,293.66];
      while(this.nextNote<this.context.currentTime+.3){
        const frequency=notes[this.note%notes.length];this.tone(frequency,2.6,.035,this.nextNote,'music');
        if(this.note%4===0){this.tone(this.note%8===0?130.815:146.83,5,.026,this.nextNote,'music');this.tone(196,4.5,.017,this.nextNote,'music');}
        this.note++;this.nextNote+=1.35;
      }
    };
    schedule();this.timer=setInterval(schedule,250);
  }
  stopVoices(kind){
    if(!this.context)return;
    for(const voice of this.voices)if(!kind||voice.kind===kind){
      try{voice.oscillator.stop();}catch{}
      voice.oscillator.disconnect();voice.gain.disconnect();this.voices.delete(voice);
    }
  }
  stopMusic(){if(this.timer)clearInterval(this.timer);this.timer=null;this.stopVoices('music');}
  pause(){this.pendingSound=null;this.lastSound=-Infinity;this.stopMusic();this.stopVoices();if(this.context?.state==='running')this.context.suspend().catch(()=>{});}
  async resume(){if(this.hidden||(!this.music&&!this.effects))return;if(await this.unlock())this.startMusic();}
  sound(tool='tap'){
    if(!this.effects||this.hidden||this.disposed)return;
    if(this.context?.state!=='running'){
      // Keep just the latest sound while a browser unlock or interruption resumes.
      this.pendingSound=tool;
      if(!this.soundUnlock)this.soundUnlock=this.resume().then(()=>{const next=this.pendingSound;this.pendingSound=null;if(next&&this.context?.state==='running')this.sound(next);}).finally(()=>this.soundUnlock=null);
      return;
    }
    const now=this.context.currentTime;if(now-this.lastSound<.12)return;this.lastSound=now;
    const tones={clay:[170,.14,.09,230],engrave:[270,.11,.07,140],flatten:[180,.13,.07,135],polish:[290,.12,.05,240],fill:[520,.18,.07,390],paint:[420,.09,.06,320],push:[170,.12,.11,110],pull:[155,.16,.09,230],grow:[180,.15,.09,260],smooth:[240,.12,.028,200],carve:[190,.13,.045,100],hole:[330,.2,.05,165],stamp:[195,.2,.065,95],reset:[392,.35,.04,261.63],tap:[440,.1,.06,330]};
    const [pitch,duration,gain,end]=tones[tool]||tones.tap;this.tone(pitch,duration,gain,now,'effect',end);
  }
  dispose(){this.disposed=true;this.pause();this.context?.close().catch(()=>{});this.context=null;}
}
