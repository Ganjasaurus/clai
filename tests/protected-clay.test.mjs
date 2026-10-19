import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {ballSurface,attachClaySafety,SpatialHash,applyBrush,CLAY_LIMITS,BALL_RADIUS,protectedClay,encodeProject,decodeProject,History} from '../dist/sculpt.js';
import {Studio,createPreset} from '../dist/studio.js';

function clay(snapshot=createPreset()){
  const m=protectedClay(snapshot).meshes[0];m.hash=new SpatialHash(m.positions);return attachClaySafety(m);
}
function brush(m,tool,i,radius=.42,strength=1.6,mirror=false,drag=[0,0,0]){
  return applyBrush(m,{tool,point:[...m.positions.slice(i*3,i*3+3)],normal:[...m.safety.directions.slice(i*3,i*3+3)],radius,strength,mirror,drag});
}
function checkLimits(m){
  const s=m.safety;
  for(let i=0;i<s.logRadius.length;i++){
    const j=i*3,r=Math.hypot(m.positions[j],m.positions[j+1],m.positions[j+2]);
    assert.ok(Number.isFinite(r)&&r>=CLAY_LIMITS.minRadius-1e-6&&r<=CLAY_LIMITS.maxRadius+1e-6,'protected radial thickness and growth bounds');
    assert.ok(m.positions[j+1]>=CLAY_LIMITS.floor-1e-6,'above the work surface');
    for(let k=0;k<3;k++)assert.ok(Math.abs(m.positions[j+k]-s.directions[j+k]*r)<1e-6,'unchanged spherical cone');
    for(let k=0;k<m.neighbors[i].length;k++)assert.ok(Math.abs(s.logRadius[i]-s.logRadius[m.neighbors[i][k]])<=s.bounds[i][k]+1e-9,'bounded angular slope');
  }
}
function checkTriangles(m){
  const p=m.positions;
  for(let i=0;i<m.indices.length;i+=3){
    const [a,b,c]=[...m.indices.slice(i,i+3)].map(v=>new THREE.Vector3(...p.slice(v*3,v*3+3))),ab=b.clone().sub(a),ac=c.clone().sub(a),cross=ab.clone().cross(ac);
    assert.ok(cross.dot(a)>1e-5,'positive outward face volume; no inverted or zero-area faces');
    const aspect=Math.max(ab.lengthSq(),ac.lengthSq(),b.distanceToSquared(c))/cross.length();
    assert.ok(aspect<4,'bounded triangle distortion');
  }
}
function frontVertex(m){let best=0;for(let i=1;i<m.positions.length/3;i++)if(m.positions[i*3+2]>m.positions[best*3+2])best=i;return best;}

test('the default is one closed, evenly triangulated ball',()=>{
  const preset=createPreset();assert.equal(preset.meshes.length,1);assert.equal(preset.surface,'protected-ball-v1');
  const m=clay(),edges=new Map();
  for(let i=0;i<m.indices.length;i+=3)for(let k=0;k<3;k++){const a=m.indices[i+k],b=m.indices[i+(k+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;edges.set(key,(edges.get(key)||0)+1);}
  assert.ok([...edges.values()].every(n=>n===2));assert.equal(m.positions.length/3-edges.size+m.indices.length/3,2);checkLimits(m);checkTriangles(m);
});

test('sustained growth spreads into neighboring clay without spikes',()=>{
  const m=clay(),tip=frontVertex(m),before=m.positions.slice(),originalFaces=m.indices.slice();
  for(let i=0;i<700;i++)brush(m,'grow',tip,.12);
  assert.ok(m.positions[tip*3+2]>BALL_RADIUS*1.5,'adds substantial volume');
  let changed=0;for(let i=0;i<m.positions.length;i+=3)if(Math.hypot(m.positions[i]-before[i],m.positions[i+1]-before[i+1],m.positions[i+2]-before[i+2])>.001)changed++;
  assert.ok(changed>50,'growth spreads beyond a needle-sized tip');assert.deepEqual(m.indices,originalFaces);checkLimits(m);checkTriangles(m);
});

test('opposite deep dents and extreme stretching cannot crush or fold the core',()=>{
  const m=clay(),tip=frontVertex(m);let back=0;
  for(let i=0;i<m.positions.length/3;i++)if(m.positions[i*3+2]<m.positions[back*3+2])back=i;
  for(let i=0;i<650;i++){brush(m,'push',tip,.65);brush(m,'push',back,.65);}
  for(let i=0;i<250;i++)brush(m,'pull',tip,.12,2,true,[3,-4,5]);
  checkLimits(m);checkTriangles(m);
});

test('thousands of mixed and mirrored strokes preserve the geometric invariants',()=>{
  const m=clay();let seed=31;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let n=0;n<2200;n++){
    const i=Math.floor(random()*m.safety.logRadius.length),normal=[...m.safety.directions.slice(i*3,i*3+3)];
    brush(m,['grow','push','pull','smooth'][n%4],i,.12+random()*.68,.4+random()*1.2,n%3===0,normal.map(v=>v*(random()-.4)*.1));
    if(n%400===0)checkLimits(m);
  }
  checkLimits(m);checkTriangles(m);
});

test('files cannot introduce arbitrary topology or bypass the protected surface',()=>{
  const legacy=createPreset('bunny'),m=clay(decodeProject(encodeProject(legacy)));assert.equal(m.positions.length,ballSurface().positions.length);checkLimits(m);checkTriangles(m);
  const malicious=createPreset('ball');malicious.meshes[0].positions.fill(.01);const rebuilt=clay(malicious);checkLimits(rebuilt);checkTriangles(rebuilt);
  const repeated=clay(decodeProject(encodeProject({name:'Round trip',surface:'protected-ball-v1',meshes:[rebuilt]})));checkLimits(repeated);
});

test('paint leaves the protected geometry unchanged',()=>{
  const m=clay(),before=m.positions.slice(),logs=m.safety.logRadius.slice(),tip=frontVertex(m);
  applyBrush(m,{point:[...m.positions.slice(tip*3,tip*3+3)],normal:[0,0,1],tool:'paint',radius:.42,color:[0,0,1],mirror:true});
  assert.deepEqual(m.positions,before);assert.deepEqual(m.safety.logRadius,logs);assert.ok(m.colors[tip*3+2]>.1);
});

test('the wheel samples a held brush continuously for every tool',()=>{
  for(const tool of ['push','pull','grow','smooth','paint']){
    const wheel=Object.create(Studio.prototype),samples=[];
    Object.assign(wheel,{raf:0,spin:true,theta:0,lastTime:100,pending:null,resetAnimation:null,touchStart:null,mode:'sculpt',pointers:new Map([[1,{}]]),activeBrushEvent:{clientX:10,clientY:20,pointerType:'mouse'},meshes:[],tool,renderer:{render(){}},scene:{},camera:{},brushRing:{visible:false},updateCamera(){},requestRender(){},showBrush(){},dab(hit){samples.push(hit.point);},hit(){return {point:this.theta};}});
    wheel.frame(116);wheel.frame(132);assert.ok(wheel.theta>0,tool);assert.equal(samples.length,2,tool);assert.ok(samples[1]>samples[0],tool);assert.equal(wheel.spin,true);
  }
});

test('reset animates through valid shapes, keeps paint, and creates one undo step',()=>{
  const m=clay(),tip=frontVertex(m);for(let i=0;i<40;i++)brush(m,'grow',tip,.6);
  const h=new History(),states=[],phases=[],studio=Object.create(Studio.prototype),pigment=m.colors.slice();
  Object.assign(studio,{meshes:[{name:'Clay',userData:m}],pointers:new Map(),resetAnimation:null,changed:false,brushRing:{visible:false},renderer:{shadowMap:{}},onResetState:v=>phases.push(v),requestRender(){},onChange(){states.push(studio.snapshot('My clay'));h.push(states.at(-1));}});
  h.push(studio.snapshot('My clay'));const deformed=m.positions.slice();
  const previous=globalThis.window;globalThis.window={matchMedia:()=>({matches:false})};
  try{
    assert.equal(studio.resetShape(),true);
    studio.animateReset(100);studio.animateReset(500);checkLimits(m);assert.notDeepEqual(m.positions,deformed);assert.ok(m.safety.logRadius.some(v=>v!==0));
    studio.animateReset(900);checkLimits(m);checkTriangles(m);assert.ok(m.safety.logRadius.every(v=>v===0));assert.deepEqual(m.colors,pigment);assert.deepEqual(phases,[true,false]);assert.equal(states.length,1);assert.deepEqual(h.undo().meshes[0].positions,deformed);assert.equal(studio.resetShape(),false);
  }finally{globalThis.window=previous;}
});
