import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import * as THREE from '../dist/vendor/three.module.js';
import {createPreset,Studio} from '../dist/studio.js';
import {attachClaySafety,SpatialHash,CLAY_LIMITS,BALL_RADIUS,History,encodeProject,decodeProject,protectedClay} from '../dist/sculpt.js';
import {PRIMITIVES,primitiveDistance,primitiveBasis,smoothUnion,blendPrimitive} from '../dist/primitives.js';

function clay(snapshot=createPreset()){
  const m=protectedClay(snapshot).meshes[0];m.hash=new SpatialHash(m.positions);attachClaySafety(m);return m;
}
function assertSafe(m){
  const s=m.safety;
  for(let i=0;i<s.logRadius.length;i++){
    const r=Math.hypot(...m.positions.slice(i*3,i*3+3));assert.ok(r>=CLAY_LIMITS.minRadius-1e-6&&r<=CLAY_LIMITS.maxRadius+1e-6);assert.ok(m.positions[i*3+1]>=CLAY_LIMITS.floor-1e-6);
    for(let k=0;k<3;k++)assert.ok(Math.abs(m.positions[i*3+k]-s.directions[i*3+k]*r)<1e-6);
    for(let k=0;k<m.neighbors[i].length;k++)assert.ok(Math.abs(s.logRadius[i]-s.logRadius[m.neighbors[i][k]])<=s.bounds[i][k]+1e-9);
  }
  for(let i=0;i<m.indices.length;i+=3){
    const [a,b,c]=[...m.indices.slice(i,i+3)].map(j=>new THREE.Vector3(...m.positions.slice(j*3,j*3+3)));
    const ab=b.clone().sub(a),ac=c.clone().sub(a),n=ab.clone().cross(ac);
    assert.ok(n.dot(a)>1e-5,'outward, non-degenerate face');assert.ok(Math.max(ab.lengthSq(),ac.lengthSq(),b.distanceToSquared(c))/n.length()<4,'bounded triangle distortion');
  }
}
function snapshot(m){return {name:'Blended clay',surface:'protected-ball-v1',meshes:[{name:'Clay',positions:m.positions.slice(),colors:m.colors.slice(),indices:m.indices}]};}
const placement={point:[0,0,BALL_RADIUS],normal:[0,0,1],size:.72,blend:.22,color:[.2,.5,.7]};

test('the four primitive fields have the intended boundaries and blend smoothly',()=>{
  assert.equal(primitiveDistance('ball',1,0,0),0);assert.equal(primitiveDistance('egg',.72,0,0),0);assert.equal(primitiveDistance('capsule',0,1,0),0);assert.ok(Math.abs(primitiveDistance('cube',.84,0,0))<1e-10);
  assert.ok(smoothUnion(0,0,.2)<0);assert.equal(smoothUnion(-1,2,.2),-1);
  const basis=primitiveBasis([.3,.8,.5]);for(let i=0;i<3;i++)assert.ok(Math.abs(Math.hypot(...basis.slice(i*3,i*3+3))-1)<1e-10);
});

test('every primitive fuses into one protected surface with the same vertex budget',()=>{
  for(const type of Object.keys(PRIMITIVES)){
    const m=clay(),positions=m.positions,indices=m.indices,back=m.positions.findIndex((v,i)=>i%3===2&&v<-1.2),oldBack=m.positions[back];
    const changed=blendPrimitive(m,{...placement,type});assert.ok(changed>200,type);assert.equal(m.positions,positions);assert.equal(m.indices,indices);assert.equal(m.positions.length/3,10242);assert.equal(m.positions[back],oldBack);
    assert.ok(Math.max(...m.positions.filter((v,i)=>i%3===2))>1.8,type);assertSafe(m);
  }
});

test('a softer blend spreads the join and mixes the selected pigment',()=>{
  const snug=clay(),soft=clay();blendPrimitive(snug,{...placement,blend:.08});blendPrimitive(soft,{...placement,blend:.48});
  const volume=m=>m.safety.logRadius.reduce((sum,v)=>sum+Math.exp(v*3),0);
  assert.ok(volume(soft)>volume(snug));let tinted=0;
  for(let i=0;i<soft.colors.length;i+=3)if(soft.colors[i+2]>.15)tinted++;
  assert.ok(tinted>200);assert.ok(soft.colors.every(v=>Number.isFinite(v)&&v>=0&&v<=1));assertSafe(soft);
});

test('mirrored primitives stay symmetrical and do not double-stamp the seam',()=>{
  const m=clay();blendPrimitive(m,{...placement,type:'capsule',point:[.9,.1,.91],normal:[.7,.1,.7],mirror:true});
  const keys=new Map();for(let i=0;i<m.safety.logRadius.length;i++)keys.set([...m.safety.directions.slice(i*3,i*3+3)].map(v=>v.toFixed(7).replace('-0.0000000','0.0000000')).join(','),i);
  for(let i=0;i<m.safety.logRadius.length;i++){
    const d=[...m.safety.directions.slice(i*3,i*3+3)];d[0]*=-1;const j=keys.get(d.map(v=>v.toFixed(7).replace('-0.0000000','0.0000000')).join(','));assert.ok(j!==undefined);assert.ok(Math.abs(m.safety.logRadius[i]-m.safety.logRadius[j])<1e-8);
  }
  const single=clay(),double=clay();blendPrimitive(single,placement);blendPrimitive(double,{...placement,mirror:true});assert.deepEqual(single.positions,double.positions);assertSafe(m);
});

test('many blended shapes retain constant memory geometry and survive undo and files',()=>{
  const m=clay(),h=new History(),initial=snapshot(m);h.push(initial);let seed=17;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const timings=[];
  for(let n=0;n<100;n++){
    const i=Math.floor(random()*m.safety.logRadius.length),t=performance.now();
    blendPrimitive(m,{type:Object.keys(PRIMITIVES)[n%4],point:[...m.positions.slice(i*3,i*3+3)],normal:[...m.safety.directions.slice(i*3,i*3+3)],size:.3+random()*.75,blend:.08+random()*.4,mirror:n%3===0});timings.push(performance.now()-t);
  }
  h.push(snapshot(m));assert.deepEqual(h.undo(),initial);assert.ok(h.redo());assertSafe(m);
  const reopened=clay(decodeProject(encodeProject(snapshot(m))));assertSafe(reopened);let maxDelta=0;for(let i=0;i<m.positions.length;i++)maxDelta=Math.max(maxDelta,Math.abs(m.positions[i]-reopened.positions[i]));assert.ok(maxDelta<.003,'save/reopen preserves the blended shape');
  timings.sort((a,b)=>a-b);console.log(`Primitive CPU time on this runner: median ${timings[50].toFixed(2)} ms, p95 ${timings[95].toFixed(2)} ms; 10,242 vertices after 100 additions.`);
});

test('unknown primitives and invalid placements leave clay untouched',()=>{
  const m=clay(),before=m.positions.slice();assert.equal(blendPrimitive(m,{...placement,type:'unknown'}),0);assert.equal(blendPrimitive(m,{...placement,point:[NaN,0,0]}),0);assert.equal(blendPrimitive(m,{...placement,point:[100,0,0]}),0);assert.equal(blendPrimitive(m,{...placement,color:[NaN,0,0]}),0);assert.deepEqual(m.positions,before);
});

test('touch placement commits once on release, and two fingers cancel placement',()=>{
  const listeners=new Map(),container={addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},focus(){},setPointerCapture(){},hasPointerCapture:()=>false};
  const previousWindow=globalThis.window,previousDocument=globalThis.document;
  globalThis.window={addEventListener(){}};globalThis.document={addEventListener(){}};
  const studio=Object.create(Studio.prototype);let stamps=0,changes=0;
  Object.assign(studio,{container,renderer:{domElement:{addEventListener(){}}},pointers:new Map(),tool:'stamp',resetAnimation:null,brushRing:{visible:false},pending:null,changed:false,primitivePreview:null,hit:()=>({}),showPrimitive(){},requestRender(){},stamp(){stamps++;this.changed=true;},onChange(){changes++;}});
  try{
    studio.bindEvents();const emit=(type,id,x=20)=>{const e={type,pointerId:id,button:0,clientX:x,clientY:30,pointerType:'touch',pressure:.5};for(const fn of listeners.get(type)||[])fn(e);};
    emit('pointerdown',1);assert.equal(stamps,0);emit('pointerup',1);assert.equal(stamps,1);assert.equal(changes,1);
    emit('pointerdown',2);emit('pointerdown',3,40);emit('pointerup',3,40);emit('pointerup',2);assert.equal(stamps,1);assert.equal(changes,1);
  }finally{globalThis.window=previousWindow;globalThis.document=previousDocument;}
});

test('the studio caches previews and commits a fused primitive as one renderable undo step',()=>{
  const data=clay(),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));geometry.setAttribute('color',new THREE.BufferAttribute(data.colors,3));geometry.setIndex(new THREE.BufferAttribute(data.indices,1));geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());mesh.userData=data;mesh.name='Clay';
  const h=new History(),studio=Object.create(Studio.prototype);let changes=0;
  Object.assign(studio,{container:{dataset:{}},scene:new THREE.Scene(),color:new THREE.Color('#89a275'),primitiveGeometries:{},primitivePreview:null,radius:.42,primitiveBlend:.22,mirror:false,brushRing:{visible:false},meshes:[mesh],pointers:new Map(),changed:false,tool:'push',renderer:{shadowMap:{},render(){}},width:373,height:720,camera:new THREE.PerspectiveCamera(38,373/720,.1,70),target:new THREE.Vector3(0,.15,0),theta:.24,phi:1.36,zoom:1,baseDistance:10.2,onZoom(){},requestRender(){},onFirstSculpt(){},onChange(){changes++;h.push(studio.snapshot('Added clay'));}});
  studio.updateCamera();h.push(studio.snapshot('Original clay'));
  const hit={object:mesh,point:new THREE.Vector3(0,0,BALL_RADIUS),face:{normal:new THREE.Vector3(0,0,1)}};
  for(const type of Object.keys(PRIMITIVES)){
    studio.setPrimitive(type,.3);const cached=studio.primitivePreview.geometry;studio.setPrimitive(type,.3);assert.equal(studio.primitivePreview.geometry,cached);studio.showPrimitive(hit);assert.equal(studio.primitivePreview.visible,true);assert.ok(studio.primitivePreview.position.z>BALL_RADIUS);
  }
  assert.equal(studio.stamp(hit),true);assert.equal(data.dirty,true);assert.ok(geometry.attributes.color.version>0);assert.equal(studio.renderer.shadowMap.needsUpdate,true);
  studio.finishGesture();assert.equal(changes,1);assert.equal(studio.primitivePreview.visible,false);assert.equal(h.states.length,2);assert.equal(h.states[1].meshes.length,1);
  studio.frame(100);assert.equal(data.dirty,false);assert.ok(geometry.boundingSphere);assertSafe(data);
});
