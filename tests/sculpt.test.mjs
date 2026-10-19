import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {ellipsoid,adjacency,SpatialHash,applyBrush,History,encodeProject,decodeProject,exportOBJ} from '../dist/sculpt.js';
import {createPreset} from '../dist/studio.js';
import * as THREE from '../dist/vendor/three.module.js';

function mesh(){const m=ellipsoid({segments:48,rings:32});return {...m,colors:new Float32Array(m.positions.length).fill(.5),neighbors:adjacency(m.indices,m.positions.length/3),hash:new SpatialHash(m.positions)};}
const options={point:[0,0,1],normal:[0,0,1],radius:.4};
test('the sphere is welded, closed, and faces outward',()=>{
  const m=mesh(),edges=new Map();
  for(let i=0;i<m.indices.length;i+=3){
    const ids=[...m.indices.slice(i,i+3)],v=ids.map(j=>new THREE.Vector3(...m.positions.slice(j*3,j*3+3)));
    const normal=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]));
    assert.ok(normal.dot(v[0])>0,'outward triangle winding');
    for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;edges.set(key,(edges.get(key)||0)+1);}
  }
  assert.ok([...edges.values()].every(n=>n===2),'every edge shared by exactly two faces');
  assert.equal(m.positions.length/3-edges.size+m.indices.length/3,2,'Euler characteristic');
});
test('squish moves only nearby clay inward; stretch moves it outward',()=>{
  for(const [tool,sign] of [['push',-1],['pull',1]]){
    const m=mesh(),before=m.positions.slice();assert.ok(applyBrush(m,{...options,tool})>0);
    let changed=0;for(let i=0;i<before.length;i+=3){const dist=Math.hypot(before[i],before[i+1],before[i+2]-1);if(dist>=.4){assert.equal(m.positions[i+2],before[i+2]);}else if(m.positions[i+2]!==before[i+2]){changed++;assert.ok((m.positions[i+2]-before[i+2])*sign>0);}}
    assert.ok(changed>10);
  }
});
test('mirror applies equal strokes without doubling the center seam',()=>{
  const single=mesh(),mirrored=mesh();
  applyBrush(single,{...options,tool:'push'});applyBrush(mirrored,{...options,tool:'push',mirror:true});
  assert.deepEqual(single.positions,mirrored.positions);
  const m=mesh();applyBrush(m,{...options,point:[.7,0,.7],mirror:true,tool:'push'});
  for(let i=0;i<m.positions.length;i+=3){if(Math.abs(m.positions[i])>.1&&Math.abs(m.positions[i+1])<.01){let closest=Infinity;for(let j=0;j<m.positions.length;j+=3)closest=Math.min(closest,Math.hypot(m.positions[j]+m.positions[i],m.positions[j+1]-m.positions[i+1],m.positions[j+2]-m.positions[i+2]));assert.ok(closest<1e-5);}}
});
test('smooth reduces a local peak and paint leaves the surface untouched',()=>{
  const m=mesh();let peak=0;for(let i=0;i<m.positions.length;i+=3)if(m.positions[i+2]>m.positions[peak+2])peak=i;
  m.positions[peak+2]+=.2;m.hash.rebuild();const raised=m.positions[peak+2];
  applyBrush(m,{...options,point:[0,0,1.1],tool:'smooth'});assert.ok(m.positions[peak+2]<raised);
  const shape=m.positions.slice();applyBrush(m,{...options,tool:'paint',color:[1,0,0]});assert.deepEqual(m.positions,shape);assert.ok(m.colors[peak]>.5);assert.ok(m.colors[peak+1]<.5);
});
test('spatial hash follows vertices across cell boundaries',()=>{
  const p=new Float32Array([0,0,0,2,2,2]),h=new SpatialHash(p);p[0]=1;p[1]=1;p[2]=1;h.update(0);assert.ok(h.query([1,1,1],.1).includes(0));assert.ok(!h.query([0,0,0],.1).includes(0));
});
test('all starter meshes and colors survive a clay-file round trip',()=>{
  for(const type of ['bunny','blob','mushroom','ball','pebble','snowman']){
    const original=createPreset(type),decoded=decodeProject(JSON.parse(JSON.stringify(encodeProject(original))));assert.equal(decoded.name,original.name);assert.equal(decoded.meshes.length,original.meshes.length);
    original.meshes.forEach((m,i)=>{assert.deepEqual(decoded.meshes[i].indices,m.indices);assert.ok(m.positions.every((v,k)=>Math.abs(v-decoded.meshes[i].positions[k])<.000006));});
  }
});
test('invalid files are rejected before allocating a scene',()=>{
  const data=encodeProject(createPreset('ball'));
  assert.throws(()=>decodeProject({format:'other'}));
  for(const bad of [NaN,Infinity,'4',7]){const b=structuredClone(data);b.meshes[0].positions[0]=bad;assert.throws(()=>decodeProject(b));}
  const b=structuredClone(data);b.meshes[0].indices[0]=999999;assert.throws(()=>decodeProject(b));
});
test('undo, redo and branching preserve independent snapshots',()=>{
  const h=new History(3),a=createPreset('ball'),b=createPreset('blob'),c=createPreset('pebble');h.push(a);h.push(b);assert.equal(h.undo(),a);assert.equal(h.redo(),b);h.undo();h.push(c);assert.equal(h.canRedo,false);assert.equal(h.undo(),a);h.redo();h.push(b);h.push(a);assert.equal(h.states.length,3);
});
test('OBJ exports every face with valid global vertex indices',()=>{
  const s=createPreset('blob'),obj=exportOBJ(s),lines=obj.split('\n');const vertices=lines.filter(l=>l.startsWith('v '));const faces=lines.filter(l=>l.startsWith('f '));assert.equal(vertices.length,s.meshes.reduce((n,m)=>n+m.positions.length/3,0));assert.equal(faces.length,s.meshes.reduce((n,m)=>n+m.indices.length/3,0));for(const f of faces)for(const index of f.split(' ').slice(1))assert.ok(+index>=1&&+index<=vertices.length);
});
test('repeated sculpting stays finite and within the work envelope',()=>{
  const m=mesh();for(let i=0;i<250;i++)applyBrush(m,{...options,point:[0,0,1+i*.004],tool:'pull',mirror:true});assert.ok(m.positions.every(v=>Number.isFinite(v)&&Math.abs(v)<=5));
});
test('representative brush cost is recorded without assuming a device frame rate',()=>{
  const s=createPreset('bunny'),part=s.meshes[0],m={...part,neighbors:adjacency(part.indices,part.positions.length/3),hash:new SpatialHash(part.positions)};
  const start=performance.now();for(let i=0;i<100;i++)applyBrush(m,{point:[0,-.2,.73],normal:[0,0,1],radius:.42,tool:'push',mirror:true});
  console.log(`100 mirrored brush dabs on the bunny body: ${(performance.now()-start).toFixed(1)} ms (CPU only)`);
});
