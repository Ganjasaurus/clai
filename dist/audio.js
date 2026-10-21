// Quiet, original synth music and clay sounds. No downloads, autoplay, or
// continuously running audio graph when both switches are off.
export class ClayAudio {
  constructor({onChange=()=>{}}={}){
    this.music=false;this.effects=false;this.context=null;this.timer=null;this.voices=new Set();this.lastSound=-Infinity;this.note=0;this.onChange=onChange;
    this.hidden=typeof document!=='undefined'&&document.hidden;
    globalThis.document?.addEventListener('visibilitychange',()=>{this.hidden=document.hidden;if(this.hidden)this.pause();else this.resume();});
    globalThis.window?.addEventListener('pagehide',()=>this.pause());
  }
  async unlock(){
    if(!this.music&&!this.effects)return true;
    const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
    if(!Audio)return false;
    try{
      if(!this.context){this.context=new Audio();this.master=this.context.createGain();this.master.gain.value=.65;this.master.connect(this.context.destination);}
      if(this.context.state==='suspended'&&!this.hidden)await this.context.resume();
      return this.context.state!=='closed';
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
      const time=this.context.currentTime;voice.gain.gain.cancelScheduledValues(time);voice.gain.gain.setTargetAtTime(.0001,time,.025);try{voice.oscillator.stop(time+.12);}catch{}
    }
  }
  stopMusic(){if(this.timer)clearInterval(this.timer);this.timer=null;this.stopVoices('music');}
  pause(){this.stopMusic();this.stopVoices();if(this.context?.state==='running')this.context.suspend().catch(()=>{});}
  async resume(){if(this.hidden||(!this.music&&!this.effects))return;if(await this.unlock())this.startMusic();}
  sound(tool='tap'){
    if(!this.effects||this.hidden||this.context?.state!=='running')return;
    const now=this.context.currentTime;if(now-this.lastSound<.12)return;this.lastSound=now;
    const tones={paint:[420,.09,.025,320],push:[140,.12,.065,75],pull:[135,.16,.05,185],grow:[160,.15,.055,220],smooth:[240,.12,.028,200],carve:[190,.13,.045,100],hole:[330,.2,.05,165],stamp:[195,.2,.065,95],reset:[392,.35,.04,261.63],tap:[330,.09,.025,280]};
    const [pitch,duration,gain,end]=tones[tool]||tones.tap;this.tone(pitch,duration,gain,now,'effect',end);
  }
  dispose(){this.pause();this.context?.close().catch(()=>{});this.context=null;}
}
