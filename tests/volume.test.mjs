import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {createVolume,restoreVolume,cloneVolume,meshVolume,editVolume,sampleVolume,volumeFromRadial,VOLUME,encodeVolume,decodeVolume,ensureVolumeRoom,volumeStep} from '../dist/volume.js';
import {createPreset,Studio} from '../dist/studio.js';
import {encodeProject,decodeProject,History,attachClaySafety} from '../dist/sculpt.js';

function topology(mesh){
  const p=mesh.positions,indices=mesh.indices,edges=new Map();let volume=0;
  assert.ok(p.every(Number.isFinite));assert.ok(mesh.colors.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
  assert.ok(p.length/3<=VOLUME.maxVertices);assert.ok(indices.length/3<=VOLUME.maxTriangles);
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i],b=indices[i+1],c=indices[i+2];assert.ok(a!==b&&a!==c&&b!==c);
    const ab=[p[b*3]-p[a*3],p[b*3+1]-p[a*3+1],p[b*3+2]-p[a*3+2]],ac=[p[c*3]-p[a*3],p[c*3+1]-p[a*3+1],p[c*3+2]-p[a*3+2]],n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    assert.ok(Math.hypot(...n)>0,'nonzero face area');volume+=(p[a*3]*n[0]+p[a*3+1]*n[1]+p[a*3+2]*n[2])/6;
    for(const [u,v] of [[a,b],[b,c],[c,a]]){const key=u<v?`${u},${v}`:`${v},${u}`;const e=edges.get(key)||[0,0];e[0]++;e[1]+=u<v?1:-1;edges.set(key,e);}
  }
  for(const [count,direction] of edges.values()){assert.equal(count,2,'every edge is shared by two faces');assert.equal(direction,0,'neighboring faces agree on orientation');}
  assert.ok(volume>0,'positive enclosed solid volume');
  return {euler:p.length/3-edges.size+indices.length/3,volume};
}
function renderMesh(data){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(data.positions,3));g.setIndex(new THREE.BufferAttribute(data.indices,1));g.computeVertexNormals();g.computeBoundingSphere();return new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));}
function ray(mesh,origin,direction){mesh.updateMatrixWorld(true);return new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...direction).normalize()).intersectObject(mesh);}
function snapshot(field,name='Clay'){return {name,surface:'solid-clay-v1',volume:cloneVolume(field),meshes:[meshVolume(field)]};}

test('fresh clay is one closed head with ears, nose and painted facial details',()=>{
  const s=createPreset();assert.equal(s.surface,'solid-clay-v1');assert.equal(s.name,'A little somebody');assert.equal(s.meshes.length,1);assert.equal(topology(s.meshes[0]).euler,2);
  const f=restoreVolume(s.volume);assert.ok(sampleVolume(f,0,0,1.13)<0,'nose projects forward');assert.ok(sampleVolume(f,1.13,.12,0)<0,'ear is part of the same clay');assert.ok(s.meshes[0].colors.some(v=>v<.07),'face has paint');
});

test('Hole makes a real watertight tunnel, with no center sphere in either direction',()=>{
  const f=createVolume('ball'),before=topology(meshVolume(f));
  assert.equal(before.euler,2);assert.ok(editVolume(f,{tool:'hole',point:[0,0,1.28],direction:[0,0,-1],radius:.4})>0);
  for(let z=-1.5;z<1.5;z+=.1)assert.ok(sampleVolume(f,0,0,z)>0,'center line is empty');
  const mesh=meshVolume(f),after=topology(mesh);assert.equal(after.euler,0,'one tunnel changes genus');assert.ok(after.volume<before.volume);
  const rendered=renderMesh(mesh);assert.equal(ray(rendered,[0,0,4],[0,0,-1]).length,0);assert.equal(ray(rendered,[0,0,-4],[0,0,1]).length,0);assert.ok(ray(rendered,[0,0,0],[1,0,0]).length>=2,'the tunnel has an inner wall and outer wall');
});

test('diagonal and mirrored tunnels remain closed, and repeated cuts are idempotent',()=>{
  const f=createVolume('ball'),args={tool:'hole',point:[.55,.1,1],direction:[.1,.2,-1],radius:.28,mirror:true};
  editVolume(f,args);topology(meshVolume(f));const before=f.values.slice();editVolume(f,args);assert.deepEqual(f.values,before);
  const n=VOLUME.size;for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++)assert.ok(Math.abs(f.values[x+y*n+z*n*n]-f.values[n-1-x+y*n+z*n*n])<1e-6,'mirror acts symmetrically');
});

test('overlapping mirrored brushes and stamps stay symmetric without doubling the center seam',()=>{
  const n=VOLUME.size;
  for(const tool of ['push','grow','smooth','paint','stamp']){
    const f=createVolume('ball');editVolume(f,{tool,point:[.12,0,1.2],normal:[0,0,1],radius:.6,size:.55,mirror:true,color:[0,0,1]});
    for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const i=x+y*n+z*n*n,j=n-1-x+y*n+z*n*n;assert.ok(Math.abs(f.values[i]-f.values[j])<1e-6,tool);
      if(tool==='paint')for(let k=0;k<3;k++)assert.equal(f.pigment[i*3+k],f.pigment[j*3+k]);
    }
  }
});

test('scooping and squishing can cross the original solid center',()=>{
  for(const tool of ['carve','push']){
    const f=createVolume('ball');
    for(let stroke=0;stroke<500;stroke++){
      let z=1.4;while(z>-1.4&&sampleVolume(f,0,0,z)>=0)z-=.025;
      if(z<-1.4)break;
      editVolume(f,{tool,point:[0,0,z],radius:.55,strength:1.5});
    }
    assert.ok(sampleVolume(f,0,0,0)>0,`${tool} removes the center`);topology(meshVolume(f));
  }
});

test('all primitives, brushes and paint work after carving; paint does not remesh geometry',()=>{
  const f=createVolume('ball');editVolume(f,{tool:'hole',point:[0,0,1.28],direction:[0,0,1],radius:.3});
  for(const type of ['ball','egg','capsule','cube'])assert.ok(editVolume(f,{tool:'stamp',type,point:[1.15,.2,0],normal:[1,0,0],size:.5,blend:.25,color:[.2,.5,.8]})>0);
  for(const tool of ['grow','pull','smooth','flatten'])editVolume(f,{tool,point:[.9,.8,.2],normal:[.7,.7,0],drag:[.02,.01,0],radius:.6,strength:1.1});
  const m=meshVolume(f),positions=m.positions,indices=m.indices,colors=m.colors.slice(),before=f.values.slice();
  assert.ok(editVolume(f,{tool:'paint',point:[1.3,.2,0],radius:.8,color:[0,0,1]})>0);const painted=meshVolume(f);
  assert.equal(painted.positions,positions);assert.equal(painted.indices,indices);assert.deepEqual(f.values,before);assert.notDeepEqual(painted.colors,colors);assert.ok(sampleVolume(f,0,0,0)>0);topology(painted);
});

test('solid files retain holes and exact scalar values, undo restores independent volumes',()=>{
  const f=createVolume('head'),history=new History();history.push(snapshot(f,'Head'));
  editVolume(f,{tool:'hole',point:[0,0,1.28],radius:.4,direction:[0,0,1]});history.push(snapshot(f,'Window'));
  const data=encodeProject(history.states[1]);assert.equal(data.version,3);assert.ok(JSON.stringify(data).length<3_000_000);
  const roundTrip=decodeProject(JSON.parse(JSON.stringify(data)));assert.deepEqual(roundTrip.volume,cloneVolume(f));assert.equal(topology(roundTrip.meshes[0]).euler,0);
  assert.equal(history.undo().name,'Head');assert.ok(sampleVolume(restoreVolume(history.states[0].volume),0,0,0)<0);assert.equal(history.redo().name,'Window');
  assert.ok(history.bytes>f.values.byteLength+f.pigment.byteLength);
});

test('invalid solid input is bounded and rejected before a scene can be replaced',()=>{
  assert.throws(()=>decodeVolume({grid:1,values:'x',pigment:'x'}));
  const field=createVolume('ball'),before=field.values.slice();
  for(const args of [{point:[NaN,0,0]},{point:[0,0,0],radius:Infinity},{point:[0,0,0],tool:'unknown'},{point:[0,0,0],tool:'stamp',type:'unknown'}])assert.equal(editVolume(field,args),0);
  assert.deepEqual(before,field.values);const bad=cloneVolume(field);bad.values[2]=NaN;assert.throws(()=>restoreVolume(bad));
  const encoded=encodeVolume(field);assert.throws(()=>decodeVolume({...encoded,values:'!'.repeat(encoded.values.length)}));
});

test('legacy clay converts to editable solid without losing its painted outer silhouette',()=>{
  const m=createPreset('ball').meshes[0];attachClaySafety(m);const f=volumeFromRadial(m);assert.equal(topology(meshVolume(f)).euler,2);
  for(const p of [[1.2,0,0],[0,1.2,0],[0,0,-1.2]])assert.ok(sampleVolume(f,...p)<0);
  editVolume(f,{tool:'hole',point:[0,0,1.28],direction:[0,0,1],radius:.4});assert.ok(sampleVolume(f,0,0,0)>0);
});

test('stress edits keep finite closed surfaces within the work budget and record CPU cost',()=>{
  const f=createVolume('head');meshVolume(f);let seed=71;const times=[];
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<180;i++){
    const theta=random()*Math.PI*2,y=random()*1.6-.6,point=[Math.cos(theta),y,Math.sin(theta)],tool=['grow','pull','push','carve','smooth','flatten','stamp'][i%7];
    const start=performance.now();editVolume(f,{tool,point,radius:.3+random()*.4,normal:[Math.cos(theta),.2,Math.sin(theta)],type:['ball','egg','capsule','cube'][i%4],size:.35,blend:.18,mirror:i%3===0});meshVolume(f);times.push(performance.now()-start);
    if(i%45===0)topology(meshVolume(f));
  }
  topology(meshVolume(f));times.sort((a,b)=>a-b);console.log(`Solid edit + mesh CPU on this runner: median ${times[90].toFixed(2)} ms, p95 ${times[171].toFixed(2)} ms; ${meshVolume(f).positions.length/3} vertices after 180 edits.`);
});

function studioFixture(field=createVolume('ball')){
  const studio=Object.create(Studio.prototype),scene=new THREE.Scene(),group=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial());group.add(mesh);scene.add(group);
  Object.assign(studio,{volume:field,meshes:[mesh],scene,group,material:mesh.material,pointers:new Map(),container:{hasPointerCapture:()=>false,dataset:{}},renderer:{shadowMap:{},render(){}},brushRing:{visible:false},color:new THREE.Color('#ed8857'),target:new THREE.Vector3(0,.15,0),width:800,height:600,camera:new THREE.PerspectiveCamera(38,800/600,.1,70),theta:.24,phi:1.36,zoom:1,baseDistance:8.6,tool:'push',radius:.42,mirror:false,changed:false,onResetState(){},requestRender(){},onChange(){},onZoom(){},onFirstSculpt(){},onError(message){throw new Error(message);}});
  studio.updateCamera();studio.flushVolume(true);return studio;
}

test('actual Studio snapshots, loads and reset animation preserve tunneled clay and pigment',()=>{
  const studio=studioFixture(),history=new History(),phases=[];history.push(studio.snapshot('Ball'));
  studio.tool='hole';studio.dab({object:studio.meshes[0],point:new THREE.Vector3(0,0,1.28),face:{normal:new THREE.Vector3(0,0,1)}},{pointerType:'mouse'});studio.finishGesture();const carved=studio.snapshot('Hole');history.push(carved);
  assert.ok(sampleVolume(studio.volume,0,0,0)>0);studio.load(carved);assert.ok(sampleVolume(studio.volume,0,0,0)>0);topology(studio.snapshot().meshes[0]);
  const colors=studio.volume.pigment.slice(),previous=globalThis.window;globalThis.window={matchMedia:()=>({matches:false})};studio.onResetState=v=>phases.push(v);studio.onChange=()=>history.push(studio.snapshot('Reset'));
  try{assert.equal(studio.resetShape(),true);studio.animateReset(100);studio.animateReset(500);topology(studio.snapshot().meshes[0]);studio.animateReset(900);assert.deepEqual(studio.volume.pigment,colors);assert.deepEqual(phases,[true,false]);assert.equal(topology(studio.snapshot().meshes[0]).euler,2);assert.equal(history.states.length,3);studio.load(history.undo());assert.ok(sampleVolume(studio.volume,0,0,0)>0);}finally{globalThis.window=previous;}
});

test('moving the view never sculpts, recenter works, and paint skips shadow updates',()=>{
  const studio=studioFixture(),before=studio.volume.values.slice();studio.mode='move';studio.lastPointer={x:10,y:20};studio.pointers.set(1,{x:10,y:20});studio.handleMove({pointerId:1,clientX:100,clientY:45});
  assert.notEqual(studio.target.x,0);assert.deepEqual(studio.volume.values,before);studio.resetView();assert.deepEqual(studio.target.toArray(),[0,.15,0]);
  studio.tool='paint';studio.renderer.shadowMap.needsUpdate=false;studio.dab({object:studio.meshes[0],point:new THREE.Vector3(0,0,1.28),face:{normal:new THREE.Vector3(0,0,1)}},{pointerType:'mouse'});studio.flushVolume();assert.equal(studio.renderer.shadowMap.needsUpdate,false);
});

test('hole touch placement commits on release, cancels on pinch, and keeps the wheel on',()=>{
  const studio=studioFixture(),listeners=new Map(),previousWindow=globalThis.window,previousDocument=globalThis.document;
  globalThis.window={addEventListener(){}};globalThis.document={addEventListener(){}};
  studio.container={addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},focus(){},setPointerCapture(){},hasPointerCapture:()=>false};studio.renderer.domElement={addEventListener(){}};studio.showBrush=()=>{};studio.tool='hole';studio.spin=true;studio.hit=()=>({object:studio.meshes[0],point:new THREE.Vector3(0,0,1.28),face:{normal:new THREE.Vector3(0,0,1)}});let changes=0;studio.onChange=()=>changes++;
  try{
    studio.bindEvents();const emit=(type,id)=>{for(const fn of listeners.get(type)||[])fn({type,pointerId:id,button:0,clientX:100+id,clientY:100,pointerType:'touch',pressure:.5});};
    const before=studio.volume.values.slice();emit('pointerdown',1);emit('pointerdown',2);emit('pointerup',2);emit('pointerup',1);assert.deepEqual(studio.volume.values,before);assert.equal(changes,0);
    emit('pointerdown',3);emit('pointercancel',3);assert.deepEqual(studio.volume.values,before);
    emit('pointerdown',4);assert.deepEqual(studio.volume.values,before);emit('pointerup',4);assert.notDeepEqual(studio.volume.values,before);assert.equal(changes,1);assert.equal(studio.spin,true);topology(studio.snapshot().meshes[0]);
  }finally{globalThis.window=previousWindow;globalThis.document=previousDocument;}
});

test('an invalid dense imported solid cannot replace current clay, and complexity rejection rolls back a stroke',()=>{
  const studio=studioFixture(),before=studio.snapshot('Before'),dense=cloneVolume(studio.volume),n=VOLUME.size;
  for(let z=20;z<60;z++)for(let y=22;y<60;y++)for(let x=4;x<60;x++)dense.values[x+y*n+z*n*n]=(x+y+z)%2?-.1:.1;
  assert.throws(()=>studio.load({surface:'solid-clay-v1',volume:dense}),/keep this clay light/);assert.deepEqual(studio.snapshot('Before').volume,before.volume);
  studio.strokeBackup=cloneVolume(studio.volume);studio.volume=restoreVolume(dense);let rejected=false;studio.onError=()=>{rejected=true;};studio.flushVolume();assert.equal(rejected,true);assert.equal(studio.editBlocked,true);assert.deepEqual(studio.snapshot('Before').volume,before.volume);
});

test('snapshots own their changing topology, and empty clay can still save and reset',()=>{
  const studio=studioFixture(),saved=studio.snapshot(),index=saved.meshes[0].indices[0];studio.meshes[0].geometry.index.array[0]=99;assert.equal(saved.meshes[0].indices[0],index,'render buffer updates cannot mutate undo topology');
  const empty=cloneVolume(studio.volume);empty.values.fill(1);studio.load({surface:'solid-clay-v1',volume:empty});assert.equal(studio.snapshot().meshes[0].indices.length,0);
  const reopened=decodeProject(encodeProject(studio.snapshot()));assert.equal(reopened.meshes[0].indices.length,0);studio.load(reopened);
  const previous=globalThis.window;globalThis.window={matchMedia:()=>({matches:true})};
  try{assert.equal(studio.resetShape(),true);studio.animateReset(100);assert.equal(topology(studio.snapshot().meshes[0]).euler,2);}finally{globalThis.window=previous;}
});

test('Grow passes the old workspace wall with fixed spacing and bounded samples',()=>{
  const f=createVolume('ball'),step=volumeStep(f);let tip=1.28;
  for(let i=0;i<100;i++){
    let z=tip+.8;while(z>tip-.8&&sampleVolume(f,0,0,z)>=0)z-=.015;tip=z;
    editVolume(f,{tool:'grow',point:[0,0,tip],normal:[0,0,1],radius:.55,strength:1});
  }
  assert.ok(tip>4.5,`Growth reaches ${tip}`);assert.ok(f.size.some(n=>n>VOLUME.size));assert.equal(volumeStep(f),step);assert.ok(f.values.length<=VOLUME.maxSamples);
  assert.ok(sampleVolume(f,0,0,0)<0,'the original clay still exists');topology(meshVolume(f));
});

test('long stretches keep a rounded connection instead of thinning out and stalling',()=>{
  const f=createVolume('ball');
  for(let i=0;i<160;i++)editVolume(f,{tool:'pull',point:[0,0,1.28+i*.025],normal:[0,0,1],radius:.55,drag:[0,0,.025]});
  assert.ok(f.size.some(n=>n>VOLUME.size));assert.ok(sampleVolume(f,0,0,5)<0,'the stretched tip follows the hand');
  for(let z=1;z<=5;z+=.1)assert.ok(sampleVolume(f,0,0,z)<0,'the stretched clay remains connected');
  topology(meshVolume(f));
});

test('expanded workspace survives files, history, loading and reset, with legacy grid support',()=>{
  const f=createVolume('ball');editVolume(f,{tool:'clay',point:[3.5,.5,0],radius:.9});
  const encoded=encodeVolume(f);assert.equal(encoded.grid,3);assert.ok(encoded.size.some(n=>n>65));assert.deepEqual(decodeVolume(encoded),cloneVolume(f));
  for(const extent of [NaN,Infinity,-1,1000])assert.throws(()=>decodeVolume({...encoded,extent}));
  const old=encodeVolume(createVolume('ball'));old.grid=1;delete old.extent;assert.equal(decodeVolume(old).extent,3.6);
  const studio=studioFixture(f),history=new History();history.push(studio.snapshot('Expanded'));studio.load(decodeProject(encodeProject(studio.snapshot())));assert.deepEqual(studio.volume.size,f.size);
  const previous=globalThis.window;globalThis.window={matchMedia:()=>({matches:true})};studio.onChange=()=>history.push(studio.snapshot('Reset'));
  try{assert.ok(studio.resetShape());studio.animateReset(100);assert.deepEqual(studio.volume.size,[65,65,65]);assert.ok(sampleVolume(studio.volume,0,0,0)<0);assert.equal(topology(studio.snapshot().meshes[0]).euler,2);studio.load(history.undo());assert.deepEqual(studio.volume.size,f.size);}finally{globalThis.window=previous;}
});

test('clay pen, engraving and finishing tools change the surface, while pen styles only color it',()=>{
  for(const tool of ['clay','engrave','smooth','flatten','polish']){
    const f=createVolume('ball'),before=f.values.slice();editVolume(f,{tool,point:[0,0,1.28],normal:[0,0,1],radius:.6});assert.notDeepEqual(f.values,before,tool);topology(meshVolume(f));
  }
  const amounts=[];
  for(const paintStyle of ['pen','brush','spray']){
    const f=createVolume('ball',[0,0,0]),mesh=meshVolume(f),before=f.values.slice();editVolume(f,{tool:'paint',point:[0,0,1.28],radius:.6,paintStyle,color:[1,0,0]});amounts.push(f.pigment.reduce((sum,v)=>sum+v,0));const after=meshVolume(f);assert.deepEqual(f.values,before);assert.equal(after.positions,mesh.positions);assert.equal(after.indices,mesh.indices);
  }
  assert.ok(amounts[0]>amounts[1]&&amounts[1]>amounts[2],'pen, brush and spray have distinct ink deposits');
  const f=createVolume('ball',[0,0,0]),mesh=meshVolume(f);editVolume(f,{tool:'fill',point:[0,0,1.28],color:[1,0,0],opacity:.5});assert.equal(f.pigment[0],128);assert.equal(meshVolume(f).positions,mesh.positions);
});

test('actual pointer strokes continue beyond the silhouette for Stretch and Clay pen, even while turning',()=>{
  for(const tool of ['pull','clay','grow']){
    const studio=studioFixture();Object.assign(studio,{tool,radius:.6,theta:0,phi:Math.PI/2,zoom:.65,spin:true,raycaster:new THREE.Raycaster(),ndc:new THREE.Vector2(),strokePlane:new THREE.Plane(),previousWorld:new THREE.Vector3(0,0,1.28)});
    studio.container.getBoundingClientRect=()=>({left:0,top:0,width:800,height:600});studio.showBrush=()=>{};studio.target.set(0,0,0);studio.updateCamera();studio.meshes[0].updateMatrixWorld(true);
    const screen=point=>{const p=new THREE.Vector3(...point).project(studio.camera);return {x:(p.x+1)*400,y:(1-p.y)*300};};
    const begin=screen([0,0,1.28]),end=screen([4.2,.2,1.28]);studio.strokeHit=studio.hit(begin.x,begin.y);assert.ok(studio.strokeHit);
    studio.strokePlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0,0,1),studio.strokeHit.point);studio.previousWorld.copy(studio.strokeHit.point);studio.mode='sculpt';studio.lastPointer=begin;studio.pointers.set(1,begin);
    for(let i=1;i<=12;i++){studio.handleMove({pointerId:1,clientX:begin.x+(end.x-begin.x)*i/12,clientY:begin.y+(end.y-begin.y)*i/12,pointerType:'mouse',pressure:.5});studio.flushVolume();}
    assert.equal(studio.mode,'sculpt');assert.equal(studio.spin,true);assert.ok(studio.strokeHit.point.x>4);assert.ok(sampleVolume(studio.volume,...(tool==='grow'?studio.strokeHit.point.toArray():[4.15,.2,1.28]))<.18,`${tool} reaches beyond the silhouette`);topology(studio.snapshot().meshes[0]);
  }
});

test('zoom and moving offer a much larger canvas without changing the saved clay',()=>{
  const studio=studioFixture(),before=cloneVolume(studio.volume);studio.zoomBy(.01);assert.equal(studio.zoom,.08);assert.ok(studio.camera.far>studio.camera.position.length());
  studio.zoomBy(1000);assert.equal(studio.zoom,4);studio.zoomBy(.1);studio.mode='move';studio.lastPointer={x:0,y:0};studio.pointers.set(1,studio.lastPointer);studio.handleMove({pointerId:1,clientX:400,clientY:0});assert.ok(Math.abs(studio.target.x)>2);assert.deepEqual(cloneVolume(studio.volume),before);studio.resetView();assert.equal(studio.zoom,1);
});

test('sparse fast pointer samples create a continuous clay line instead of detached beads',()=>{
  for(const tool of ['clay','pull']){
    const f=createVolume('ball');
    editVolume(f,{tool,point:tool==='pull'?[2.8,0,1.28]:[5.6,0,1.28],drag:[5.6,0,0],radius:.5,normal:[0,0,1]});
    for(let x=0;x<5.6;x+=.1)assert.ok(sampleVolume(f,x,0,1.28)<0,`${tool} stays connected at ${x}`);
    topology(meshVolume(f));
  }
});

test('adding distant clay preserves every existing scalar and pigment sample at the original spacing',()=>{
  const f=createVolume('head');
  editVolume(f,{tool:'hole',point:[0,.05,1],radius:.27,direction:[0,0,1]});
  editVolume(f,{tool:'paint',point:[-.5,.5,.8],radius:.3,color:[0,0,1]});
  editVolume(f,{tool:'stamp',type:'ball',point:[0,2.2,0],size:.3,blend:.08,color:[.2,.8,.1]});
  const before=cloneVolume(f),smallBefore=sampleVolume(f,0,2.2,0),h=volumeStep(f);
  assert.ok(smallBefore<0,'a small clay piece is present before growth');
  ensureVolumeRoom(f,[6.7,2,0],.9,true);
  editVolume(f,{tool:'stamp',point:[6.7,2,0],normal:[1,0,0],size:.55,blend:.2,color:[1,0,0],mirror:true});
  assert.equal(volumeStep(f),h);assert.ok(f.size[0]>before.size[0]);
  const offset=before.origin.map((v,k)=>Math.round((v-f.origin[k])/h)),[nx,ny]=f.size,[ox,oy,oz]=before.size;
  for(let z=0;z<oz;z++)for(let y=0;y<oy;y++)for(let x=0;x<ox;x++){
    const a=x+y*ox+z*ox*oy,b=x+offset[0]+(y+offset[1])*nx+(z+offset[2])*nx*ny;
    assert.equal(f.values[b],before.values[a],'old clay samples are never resampled');
    for(let k=0;k<3;k++)assert.equal(f.pigment[b*3+k],before.pigment[a*3+k],'old paint is copied exactly');
  }
  assert.ok(Math.abs(sampleVolume(f,0,2.2,0)-smallBefore)<1e-6);assert.ok(sampleVolume(f,0,.05,0)>0,'the small tunnel remains open');topology(meshVolume(f));
  const studio=studioFixture(f),values=f.values.slice(),pigment=f.pigment.slice();
  for(const zoom of [.08,4,.35,1])studio.zoomBy(zoom/studio.zoom);
  assert.deepEqual(studio.volume.values,values);assert.deepEqual(studio.volume.pigment,pigment);assert.ok(sampleVolume(studio.volume,0,2.2,0)<0,'zoom cannot remove the small piece');
});

test('a full workspace rejects more room atomically and keeps the current creation and undo safe',()=>{
  const f=createVolume('head'),before=cloneVolume(f);
  assert.throws(()=>ensureVolumeRoom(f,[40,40,40],2),/workspace/);assert.deepEqual(cloneVolume(f),before);
  const studio=studioFixture(f),messages=[];studio.tool='grow';studio.strokeBackup=cloneVolume(f);studio.onError=message=>messages.push(message);
  studio.dab({object:studio.meshes[0],point:new THREE.Vector3(40,40,40),face:{normal:new THREE.Vector3(0,0,1)}},{pointerType:'mouse'});studio.flushVolume();
  assert.equal(studio.editBlocked,true);assert.equal(studio.changed,false);assert.equal(messages.length,1);assert.deepEqual(cloneVolume(studio.volume),before);topology(studio.snapshot().meshes[0]);
});

test('older expanded files retain their spacing and shape through growth and a new save',()=>{
  const f=createVolume('head',[.8,.2,.1],5.4),before=cloneVolume(f),old=encodeVolume(f);old.grid=2;delete old.size;delete old.origin;delete old.step;
  const restored=restoreVolume(decodeVolume(old));assert.equal(volumeStep(restored),5.4/32);assert.deepEqual(restored.values,before.values);assert.deepEqual(restored.pigment,before.pigment);
  ensureVolumeRoom(restored,[7,0,0],.6);assert.equal(volumeStep(restored),5.4/32);assert.deepEqual(decodeVolume(encodeVolume(restored)),cloneVolume(restored));
});

test('two-finger dragging pans, pinch zooms, and lifting one finger never starts an orbit or sculpt',()=>{
  const studio=studioFixture(),listeners=new Map(),previousWindow=globalThis.window,previousDocument=globalThis.document;
  globalThis.window={addEventListener(){}};globalThis.document={addEventListener(){}};
  Object.assign(studio,{theta:0,phi:Math.PI/2,surfaceNormal:new THREE.Vector3(),strokePlane:new THREE.Plane(),previousWorld:new THREE.Vector3()});studio.target.set(0,0,0);studio.updateCamera();
  studio.container={addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},focus(){},setPointerCapture(){},hasPointerCapture:()=>false};studio.renderer.domElement={addEventListener(){}};studio.showBrush=()=>{};
  studio.hit=()=>({object:studio.meshes[0],point:new THREE.Vector3(0,0,1.28),face:{normal:new THREE.Vector3(0,0,1)}});
  const before=cloneVolume(studio.volume),theta=studio.theta,phi=studio.phi,project=()=>new THREE.Vector3().project(studio.camera),start=project();let changes=0;studio.onChange=()=>changes++;
  try{
    studio.bindEvents();const emit=(type,id,x,y)=>{for(const fn of listeners.get(type)||[])fn({type,pointerId:id,button:0,clientX:x,clientY:y,pointerType:'touch',pressure:.5});};
    emit('pointerdown',1,100,120);emit('pointerdown',2,200,120);
    emit('pointermove',1,140,145);emit('pointermove',2,240,145);studio.handleMove(studio.pending);studio.pending=null;
    const after=project();assert.ok(Math.abs((after.x-start.x)*400-40)<1e-6);assert.ok(Math.abs(-(after.y-start.y)*300-25)<1e-6);assert.equal(studio.zoom,1);assert.equal(studio.theta,theta);assert.equal(studio.phi,phi);
    emit('pointermove',1,120,145);emit('pointermove',2,260,145);studio.handleMove(studio.pending);studio.pending=null;assert.equal(studio.zoom,1.4);assert.equal(studio.theta,theta);
    emit('pointerup',1,120,145);assert.equal(studio.mode,'gesture-end');const target=studio.target.toArray();emit('pointermove',2,300,180);studio.handleMove(studio.pending);studio.pending=null;assert.deepEqual(studio.target.toArray(),target);assert.equal(studio.theta,theta);emit('pointerup',2,300,180);
    assert.equal(changes,0);assert.deepEqual(cloneVolume(studio.volume),before);
  }finally{globalThis.window=previousWindow;globalThis.document=previousDocument;}
});
