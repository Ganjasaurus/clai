import * as THREE from './vendor/three.module.js';
import {ellipsoid,adjacency,SpatialHash,applyBrush,ballSurface,attachClaySafety,syncClaySurface,protectedClay} from './sculpt.js';
import {PRIMITIVES,primitiveBasis,blendPrimitive} from './primitives.js';
import {createVolume,restoreVolume,cloneVolume,volumeFromRadial,meshVolume,editVolume} from './volume.js';

const CLAY='#ed8857',CREAM='#f8dbad',INK='#343b32';
export function createPreset(type='head',color=CLAY){
  if(type==='head'){
    const volume=createVolume('head',new THREE.Color(color).toArray());
    return {name:'A little somebody',surface:'solid-clay-v1',volume:cloneVolume(volume),meshes:[meshVolume(volume)]};
  }
  const parts=[];
  const add=(name,center,scale,tint=color,rotation=0,detail=1)=>{
    const g=ellipsoid({center,scale,rotation,segments:detail===2?80:detail===1?48:24,rings:detail===2?56:detail===1?34:18});
    const c=new THREE.Color(tint),colors=new Float32Array(g.positions.length);
    for(let i=0;i<colors.length;i+=3){colors[i]=c.r;colors[i+1]=c.g;colors[i+2]=c.b;}
    parts.push({name,...g,colors});
  };
  const eyes=(y,z,spacing=.29)=>{
    for(const sign of [-1,1]){add('Eye',[spacing*sign,y,z],[.087,.105,.055],INK,0,0);add('Twinkle',[spacing*sign-.022,y+.034,z+.045],[.021,.025,.012],'#fff9e7',0,0);}
    add('Little smile',[0,y-.22,z+.015],[.07,.038,.028],INK,0,0);
  };
  if(type==='bunny'){
    add('Body',[0,-.17,0],[.91,1.04,.73],color,0,2);
    add('Left ear',[-.39,1.74,-.07],[.26,.79,.27],color,.14);
    add('Right ear',[.39,1.74,-.07],[.26,.79,.27],color,-.14);
    add('Left ear center',[-.42,1.82,.14],[.115,.48,.09],CREAM,.14);
    add('Right ear center',[.42,1.82,.14],[.115,.48,.09],CREAM,-.14);
    add('Head',[0,.76,.09],[.81,.73,.68],color,0,2);
    add('Tummy',[0,-.3,.57],[.54,.56,.19],CREAM);
    add('Left foot',[-.47,-1.06,.28],[.42,.23,.5]);
    add('Right foot',[.47,-1.06,.28],[.42,.23,.5]);
    add('Left paw',[-.83,-.13,.13],[.24,.48,.28],color,-.4);
    add('Right paw',[.83,-.13,.13],[.24,.48,.28],color,.4);
    eyes(.88,.73);
    add('Nose',[0,.72,.773],[.065,.045,.027],'#bb5c42',0,0);
  }else if(type==='blob'){
    add('Blob',[0,.05,0],[1.1,1.35,.93],color,0,2);eyes(.48,.89,.32);
    add('Left foot',[-.58,-1.06,.4],[.47,.23,.5]);add('Right foot',[.58,-1.06,.4],[.47,.23,.5]);
  }else if(type==='mushroom'){
    add('Stem',[0,-.43,0],[.48,.87,.48],CREAM,0,2);
    add('Cap',[0,.56,0],[1.35,.7,1.18],color,0,2);
    for(const [x,y,z,s] of [[-.55,.94,.5,.2],[.55,.91,.5,.22],[0,1.21,0,.21],[-.85,.63,.72,.15],[.2,.69,1.06,.18]])add('Little spot',[x,y,z],[s,s*.48,s],CREAM,0,0);
    eyes(-.3,.46,.18);
  }else if(type==='ball'){
    const geometry=ballSurface(),tint=new THREE.Color(color),colors=new Float32Array(geometry.positions.length);
    for(let i=0;i<colors.length;i+=3){colors[i]=tint.r;colors[i+1]=tint.g;colors[i+2]=tint.b;}
    parts.push({name:'Clay',...geometry,colors});
  }else if(type==='pebble'){
    add('Pebble',[0,-.22,0],[1.35,1.05,1.1],color,0,2);
    const p=parts[0].positions;for(let i=0;i<p.length;i+=3){const noise=1+.06*Math.sin(p[i]*4)*Math.cos(p[i+1]*3)*Math.sin(p[i+2]*3);p[i]*=noise;p[i+2]*=noise;}
  }else if(type==='snowman'){
    add('Bottom',[0,-.43,0],[.89,.86,.83],color,0,2);
    add('Middle',[0,.71,0],[.69,.67,.65],color);
    add('Top',[0,1.63,0],[.49,.47,.46],color);
    eyes(1.7,.43,.17);
    for(const y of [.9,.55,.2])add('Button',[0,y,.63],[.065,.065,.035],INK,0,0);
  }else throw new Error('Unknown clay starter.');
  const names={bunny:'Little daydream',blob:'A little somebody',mushroom:'Tiny forest',ball:'A ball of possibility',pebble:'My little pebble',snowman:'Three scoops of happy'};
  return {name:names[type],surface:type==='ball'?'protected-ball-v1':undefined,meshes:parts};
}

export class Studio {
  constructor(container,{onChange=()=>{},onZoom=()=>{},onFirstSculpt=()=>{},onError=()=>{},onResetState=()=>{},onSound=()=>{}}={}){
    this.container=container;this.onChange=onChange;this.onZoom=onZoom;this.onFirstSculpt=onFirstSculpt;this.onError=onError;this.onResetState=onResetState;this.onSound=onSound;
    this.volume=null;this.strokeBackup=null;
    this.tool='push';this.radius=.42;this.color=new THREE.Color(CLAY);this.mirror=false;
    this.primitiveType='ball';this.primitiveBlend=.22;this.previewPointer=null;this.primitivePreview=null;this.primitiveGeometries={};
    this.theta=.24;this.phi=1.36;this.distance=8.6;this.zoom=1;this.baseDistance=8.6;
    this.target=new THREE.Vector3(0,.15,0);this.pointers=new Map();this.meshes=[];this.raf=0;this.pending=null;this.spin=false;this.dirty=false;this.changed=false;this.lastTime=0;this.visible=true;this.resetAnimation=null;
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(38,1,.1,70);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));
    this.renderer.setClearColor(0x000000,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.18;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-hidden','true');
    this.material=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.79,metalness:0});
    this.group=new THREE.Group();this.scene.add(this.group);
    this.scene.add(new THREE.HemisphereLight(0xfffaee,0xa5b49a,2.2));
    const key=new THREE.DirectionalLight(0xfff4e3,3.2);key.position.set(-3,6,5);key.castShadow=true;
    key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.5,far:20});key.shadow.normalBias=.035;key.shadow.bias=-.0003;this.scene.add(key);
    const fill=new THREE.DirectionalLight(0xf1f8ff,.9);fill.position.set(4,2,0);this.scene.add(fill);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.ShadowMaterial({opacity:.13}));floor.rotation.x=-Math.PI/2;floor.position.y=-1.32;floor.receiveShadow=true;this.scene.add(floor);
    const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;
    const ctx=shadowCanvas.getContext('2d'),gradient=ctx.createRadialGradient(64,64,3,64,64,64);gradient.addColorStop(0,'rgba(67,76,45,0.18)');gradient.addColorStop(.5,'rgba(67,76,45,0.07)');gradient.addColorStop(1,'rgba(67,76,45,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
    const shadow=new THREE.Mesh(new THREE.PlaneGeometry(4.3,3.3),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-1.315;this.scene.add(shadow);
    const ringPoints=[];for(let i=0;i<=100;i++){const a=i/100*Math.PI*2;ringPoints.push(new THREE.Vector3(Math.cos(a)*1.85,-1.31,Math.sin(a)*1.85));}
    const stageRing=new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPoints),new THREE.LineDashedMaterial({color:0xc8ceba,dashSize:.045,gapSize:.06,transparent:true,opacity:.6}));stageRing.computeLineDistances();this.scene.add(stageRing);
    this.brushRing=new THREE.Mesh(new THREE.RingGeometry(.975,1,64),new THREE.MeshBasicMaterial({color:0xfffdf0,side:THREE.DoubleSide,depthTest:false,transparent:true,opacity:.9}));this.brushRing.renderOrder=10;this.brushRing.visible=false;this.scene.add(this.brushRing);
    this.raycaster=new THREE.Raycaster();this.ndc=new THREE.Vector2();this.surfaceNormal=new THREE.Vector3(0,0,1);this.strokePlane=new THREE.Plane();this.previousWorld=new THREE.Vector3();
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);
    this.bindEvents();this.resize();
  }
  resize(){
    if(this.pointers.size)this.finishGesture();
    this.previewPointer=null;if(this.primitivePreview)this.primitivePreview.visible=false;
    const {width,height}=this.container.getBoundingClientRect();if(!width||!height)return;
    this.width=width;this.height=height;this.camera.aspect=width/height;
    const portrait=width<=height,mobile=portrait&&width<640;
    const halfFov=Math.tan(19*Math.PI/180);
    this.baseDistance=portrait?Math.max(8.8,2.9/(2*halfFov*this.camera.aspect)*1.25):8.6;
    if(mobile)this.baseDistance=Math.max(this.baseDistance,height*4.2/(2*halfFov*Math.max(120,height-250)));
    this.camera.setViewOffset(width,height,width*(width>1000?-.04:0),height*(mobile?.03:.015),width,height);
    this.camera.updateProjectionMatrix();this.renderer.setSize(width,height);this.updateCamera();this.requestRender();
  }
  updateCamera(){
    const distance=this.baseDistance/this.zoom;
    this.camera.position.set(this.target.x+distance*Math.sin(this.phi)*Math.sin(this.theta),this.target.y+distance*Math.cos(this.phi),this.target.z+distance*Math.sin(this.phi)*Math.cos(this.theta));
    this.camera.lookAt(this.target);this.camera.updateMatrixWorld();
  }
  meshFromData(data){
    const positions=data.positions.slice(),colors=data.colors.slice(),indices=data.indices;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('color',new THREE.BufferAttribute(colors,3).setUsage(THREE.DynamicDrawUsage));geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.computeBoundingBox();
    const mesh=new THREE.Mesh(geometry,this.material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.name=data.name;mesh.userData={positions,colors,indices,hash:new SpatialHash(positions)};
    attachClaySafety(mesh.userData);geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.computeBoundingBox();return mesh;
  }
  load(snapshot){
    this.finishGesture();this.cancelReset();
    let volume;
    if(snapshot.surface==='solid-clay-v1'&&snapshot.volume)volume=restoreVolume(snapshot.volume);
    else{
      const data=protectedClay(snapshot).meshes[0];attachClaySafety(data);volume=volumeFromRadial(data);
    }
    // Validate and finish meshing before replacing the current creation.
    meshVolume(volume);this.volume=volume;
    for(const m of this.meshes){this.group.remove(m);m.geometry.dispose();}
    const mesh=new THREE.Mesh(new THREE.BufferGeometry(),this.material);mesh.name='Clay';mesh.castShadow=true;mesh.receiveShadow=true;
    this.meshes=[mesh];this.group.add(mesh);this.flushVolume(true);this.strokeBackup=null;
    this.group.updateMatrixWorld(true);this.brushRing.visible=false;if(this.primitivePreview)this.primitivePreview.visible=false;this.renderer.shadowMap.needsUpdate=true;this.requestRender();
  }
  snapshot(name='My little creation'){
    if(this.volume)this.flushVolume();
    return {name,surface:this.volume?'solid-clay-v1':'protected-ball-v1',...(this.volume?{volume:cloneVolume(this.volume)}:{}),meshes:this.meshes.map(m=>({name:m.name,positions:m.userData.positions.slice(),colors:m.userData.colors.slice(),indices:m.userData.indices.slice()}))};
  }
  flushVolume(force=false){
    if(!this.volume||(!this.volume.meshDirty&&!force))return;
    const geometryChanged=this.volume.geometryDirty||force;
    let data;
    try{data=meshVolume(this.volume);}catch(error){
      if(this.strokeBackup){this.volume=restoreVolume(this.strokeBackup);this.strokeBackup=null;this.changed=false;this.editBlocked=true;this.cancelReset();data=meshVolume(this.volume);this.onError(error.message);}
      else throw error;
    }
    const mesh=this.meshes[0],geometry=mesh.geometry;
    if(!geometryChanged){geometry.attributes.color.array.set(data.colors);geometry.attributes.color.needsUpdate=true;return;}
    if(geometry.getAttribute('position')?.array.length!==data.positions.length||geometry.getIndex()?.array.length!==data.indices.length)geometry.dispose();
    for(const [name,array] of [['position',data.positions],['color',data.colors],['normal',data.normals]]){
      const attr=geometry.getAttribute(name);
      if(attr&&attr.array.length===array.length){attr.array.set(array);attr.needsUpdate=true;}
      else geometry.setAttribute(name,new THREE.BufferAttribute(array,3).setUsage(THREE.DynamicDrawUsage));
    }
    const index=geometry.getIndex();if(index&&index.array.length===data.indices.length){index.array.set(data.indices);index.needsUpdate=true;}else geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
    mesh.userData={positions:geometry.attributes.position.array,colors:geometry.attributes.color.array,indices:geometry.index.array};
    geometry.computeBoundingSphere();geometry.computeBoundingBox();this.renderer.shadowMap.needsUpdate=true;
  }
  setTool(tool){this.tool=tool;this.container.dataset.tool=tool;this.brushRing.visible=false;this.previewPointer=null;if(this.primitivePreview)this.primitivePreview.visible=false;this.requestRender();}
  setColor(hex){this.color.set(hex);this.primitivePreview?.material.color.copy(this.color);}
  setPrimitive(type,blend=.22){
    if(!PRIMITIVES[type])return;
    this.primitiveType=type;this.primitiveBlend=blend;
    if(!this.primitiveGeometries[type]){
      let geometry;
      if(type==='capsule')geometry=new THREE.CapsuleGeometry(.55,.9,5,20);
      else if(type==='cube'){
        geometry=new THREE.BoxGeometry(1.68,1.68,1.68,6,6,6);const p=geometry.attributes.position;
        for(let i=0;i<p.count;i++){
          const point=new THREE.Vector3().fromBufferAttribute(p,i),core=point.clone().clampScalar(-.68,.68),offset=point.clone().sub(core).normalize().multiplyScalar(.16);point.copy(core).add(offset);p.setXYZ(i,point.x,point.y,point.z);
        }
        geometry.computeVertexNormals();
      }else{geometry=new THREE.SphereGeometry(1,24,18);if(type==='egg')geometry.scale(.72,1,.72);}
      this.primitiveGeometries[type]=geometry;
    }
    if(!this.primitivePreview){this.primitivePreview=new THREE.Mesh(this.primitiveGeometries[type],new THREE.MeshStandardMaterial({color:this.color,transparent:true,opacity:.37,roughness:.8,depthWrite:false}));this.primitivePreview.visible=false;this.scene.add(this.primitivePreview);}
    this.primitivePreview.geometry=this.primitiveGeometries[type];this.setTool('stamp');
  }
  primitiveSize(){return .28+this.radius;}
  showPrimitive(hit){
    if(!this.primitivePreview)return;
    this.previewHit=hit;
    this.primitivePreview.visible=!!hit;if(!hit)return;
    const normal=hit.face.normal.clone().normalize(),size=this.primitiveSize(),basis=primitiveBasis(normal.toArray());
    this.primitivePreview.position.copy(hit.point).addScaledVector(normal,size*.08);this.primitivePreview.scale.setScalar(size);
    this.primitivePreview.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...basis.slice(0,3)),new THREE.Vector3(...basis.slice(3,6)),new THREE.Vector3(...basis.slice(6,9))));
  }
  stamp(hit){
    if(!hit||this.editBlocked)return false;
    if(this.volume){
      const changed=editVolume(this.volume,{tool:'stamp',type:this.primitiveType,point:hit.point.toArray(),normal:hit.face.normal.toArray(),size:this.primitiveSize(),blend:this.primitiveBlend,color:this.color.toArray(),mirror:this.mirror});
      if(changed){this.changed=true;this.flushVolume();this.onFirstSculpt();this.onSound?.('stamp');this.fitAfterAddition(hit.object);}
      return changed>0;
    }
    const changed=blendPrimitive(hit.object.userData,{type:this.primitiveType,point:hit.point.toArray(),normal:hit.face.normal.toArray(),size:this.primitiveSize(),blend:this.primitiveBlend,color:this.color.toArray(),mirror:this.mirror});
    if(changed){hit.object.userData.dirty=true;hit.object.geometry.attributes.color.needsUpdate=true;this.renderer.shadowMap.needsUpdate=true;this.changed=true;this.onFirstSculpt();this.fitAfterAddition(hit.object);}
    return changed>0;
  }
  fitAfterAddition(mesh){
    const p=mesh.userData.positions,v=new THREE.Vector3(),mobile=this.width<=this.height&&this.width<640;
    let factor=1;
    for(let j=0;j<p.length;j+=3){v.fromArray(p,j).project(this.camera);factor=Math.max(factor,Math.abs(v.x)/.78,v.y/(mobile?.68:.82),-v.y/(mobile?.48:.66));}
    if(factor>1.07&&this.zoom>.55)this.zoomBy(1/(factor*1.03));
  }
  zoomBy(factor){this.zoom=THREE.MathUtils.clamp(this.zoom*factor,.55,2.2);this.updateCamera();this.onZoom(Math.round(this.zoom*100));this.requestRender();}
  resetView(){this.theta=.24;this.phi=1.36;this.zoom=1;this.target.set(0,.15,0);this.updateCamera();this.onZoom(100);this.requestRender();}
  toggleSpin(){this.spin=!this.spin;this.lastTime=0;this.brushRing.visible=false;this.requestRender();return this.spin;}
  resetShape(){
    if(this.resetAnimation)return false;this.finishGesture();
    if(this.volume){
      const target=createVolume('ball');
      if(this.volume.values.every((v,i)=>Math.abs(v-target.values[i])<.0001))return false;
      const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      this.strokeBackup=cloneVolume(this.volume);this.resetAnimation={start:null,duration:reduced?0:800,source:this.volume.values.slice(),target:target.values,last:0};
      this.onResetState(true);this.onSound?.('reset');this.requestRender();return true;
    }
    if(!this.meshes.some(m=>m.userData.safety.logRadius.some(v=>Math.abs(v)>.00001)))return false;
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.resetAnimation={start:null,duration:reduced?0:800,source:this.meshes.map(m=>m.userData.safety.logRadius.slice())};
    this.onResetState(true);this.requestRender();return true;
  }
  cancelReset(){if(!this.resetAnimation)return;this.resetAnimation=null;this.onResetState(false);}
  animateReset(time){
    const animation=this.resetAnimation;if(!animation)return;
    if(animation.start===null)animation.start=time;
    const progress=animation.duration?Math.min(1,(time-animation.start)/animation.duration):1;
    const eased=progress*progress*progress*(progress*(progress*6-15)+10);
    if(this.volume){
      if(time-animation.last<32&&progress<1)return;animation.last=time;
      for(let i=0;i<this.volume.values.length;i++){const v=animation.source[i]*(1-eased)+animation.target[i]*eased;this.volume.values[i]=Math.abs(v)<.00001?(v<0?-.00001:.00001):v;}
      this.volume.dirty.fill(1);this.volume.meshDirty=true;this.volume.geometryDirty=true;
      if(progress===1){this.resetAnimation=null;this.onResetState(false);this.changed=true;this.finishGesture();}
      return;
    }
    for(let j=0;j<this.meshes.length;j++){
      const m=this.meshes[j],logs=m.userData.safety.logRadius;
      for(let i=0;i<logs.length;i++)logs[i]=animation.source[j][i]*(1-eased);
      syncClaySurface(m.userData);m.userData.dirty=true;
    }
    this.renderer.shadowMap.needsUpdate=true;
    if(progress===1){this.resetAnimation=null;this.onResetState(false);this.changed=true;this.finishGesture();}
  }
  hit(x,y){const rect=this.container.getBoundingClientRect();this.ndc.set((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1);this.raycaster.setFromCamera(this.ndc,this.camera);return this.raycaster.intersectObjects(this.meshes,false)[0];}
  requestRender(){if(!this.raf&&this.visible)this.raf=requestAnimationFrame(t=>this.frame(t));}
  frame(time){
    this.raf=0;
    const dt=this.lastTime?Math.max(0,Math.min(40,time-this.lastTime)):1000/60;
    if(this.spin){this.theta+=dt*.00022;this.updateCamera();}
    this.animateReset(time);
    if(this.pending){const e=this.pending;this.pending=null;this.handleMove(e);}
    if(this.tool==='stamp'&&this.previewPointer&&!this.resetAnimation&&this.mode!=='gesture'&&this.mode!=='orbit')this.showPrimitive(this.spin?this.hit(this.previewPointer.x,this.previewPointer.y):this.previewHit);
    if(this.tool==='hole'&&this.previewPointer&&this.spin&&this.mode==='hole')this.showBrush(this.hit(this.previewPointer.x,this.previewPointer.y));
    const heldTool=this.tool==='grow'||this.tool==='carve';
    if(this.touchStart&&(this.spin||heldTool)&&time-this.touchStart.time>100)this.touchStart=null;
    const continuous=(this.spin||heldTool)&&this.mode==='sculpt'&&this.pointers.size===1&&!this.touchStart&&!this.resetAnimation;
    if(continuous){
      const e=this.activeBrushEvent,hit=e&&this.hit(e.clientX,e.clientY);
      if(hit){this.dab(hit,e,[0,0,0],dt/(1000/60));if(e.pointerType!=='touch')this.showBrush(hit);}else this.brushRing.visible=false;
    }
    this.flushVolume();
    this.lastTime=time;
    for(const m of this.meshes)if(m.userData.dirty){m.geometry.attributes.position.needsUpdate=true;m.geometry.computeVertexNormals();m.geometry.computeBoundingSphere();m.geometry.computeBoundingBox();m.userData.dirty=false;}
    const waitingForTouch=heldTool&&this.mode==='sculpt'&&this.touchStart;
    this.renderer.render(this.scene,this.camera);if(this.spin||this.resetAnimation||continuous||waitingForTouch)this.requestRender();
  }
  showBrush(hit){
    if(this.tool==='stamp'){this.brushRing.visible=false;this.showPrimitive(hit);return;}
    if(!hit||this.tool==='orbit'||this.tool==='move'){this.brushRing.visible=false;return;}
    const normal=this.tool==='hole'?this.camera.getWorldDirection(new THREE.Vector3()).negate():hit.face.normal.clone().normalize();this.brushRing.position.copy(hit.point).addScaledVector(normal,.012);this.brushRing.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);this.brushRing.scale.setScalar(Math.max(this.tool==='hole'?.27:this.tool==='paint'?.12:.22,this.radius));this.brushRing.material.color.set(this.tool==='hole'||this.tool==='carve'?'#688fb6':'#fffdf0');this.brushRing.visible=true;
  }
  dab(hit,event,drag=[0,0,0],rate=1){
    if(!hit||this.editBlocked)return;
    const point=hit.point.toArray(),normal=hit.face.normal.toArray();
    const strength=(event.pointerType==='pen'?THREE.MathUtils.clamp(event.pressure*1.7,.25,1.6):.9)*rate;
    if(this.volume){
      const affected=editVolume(this.volume,{point,normal,tool:this.tool,radius:this.radius,strength,color:this.color.toArray(),drag,mirror:this.mirror,direction:this.camera.getWorldDirection(new THREE.Vector3()).toArray()});
      if(affected){this.changed=true;this.onFirstSculpt();this.onSound?.(this.tool);}
      return;
    }
    let affected=0;
    const targets=this.mirror?this.meshes:[hit.object];
    for(const mesh of targets){
      const count=applyBrush(mesh.userData,{point,normal,tool:this.tool,radius:this.radius,strength,color:this.color.toArray(),drag,mirror:this.mirror});
      if(count){affected+=count;if(this.tool==='paint')mesh.geometry.attributes.color.needsUpdate=true;else mesh.userData.dirty=true;}
    }
    if(affected){this.changed=true;this.onFirstSculpt();if(this.tool!=='paint')this.renderer.shadowMap.needsUpdate=true;}
  }
  bindEvents(){
    const el=this.container;
    el.addEventListener('contextmenu',e=>e.preventDefault());
    el.addEventListener('pointerdown',e=>{
      if(this.resetAnimation||(e.button!==0&&e.button!==2))return;
      el.focus({preventScroll:true});el.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      this.pending=null;this.brushRing.visible=false;
      if(this.pointers.size>=2){this.mode='gesture';this.touchStart=null;this.setGestureBaseline();return;}
      const hit=this.hit(e.clientX,e.clientY);
      this.mode=(e.button===2||e.altKey||this.spaceHeld)?'orbit':this.tool==='move'?'move':(this.tool==='orbit'||!hit)?'orbit':this.tool==='stamp'?'stamp':this.tool==='hole'?'hole':'sculpt';
      this.lastPointer={x:e.clientX,y:e.clientY};this.changed=false;this.editBlocked=false;this.activeBrushEvent={clientX:e.clientX,clientY:e.clientY,pointerType:e.pointerType,pressure:e.pressure};
      if(this.volume&&['sculpt','stamp','hole'].includes(this.mode))this.strokeBackup=cloneVolume(this.volume);
      if(this.mode==='sculpt'){
        this.surfaceNormal.copy(this.camera.getWorldDirection(new THREE.Vector3()));this.strokePlane.setFromNormalAndCoplanarPoint(this.surfaceNormal,hit.point);this.previousWorld.copy(hit.point);
        if(e.pointerType==='touch')this.touchStart={hit,event:e,x:e.clientX,y:e.clientY,time:performance.now()};
        else{this.dab(hit,e);this.showBrush(hit);}
      }
      if(this.mode==='stamp'){this.previewPointer={x:e.clientX,y:e.clientY};this.showPrimitive(hit);}
      if(this.mode==='hole'){this.previewPointer={x:e.clientX,y:e.clientY};this.showBrush(hit);}
      this.requestRender();
    });
    el.addEventListener('pointermove',e=>{
      // Preserve both fingers even when the browser delivers their events in one frame.
      if(this.pointers.size>=2&&this.pointers.has(e.pointerId))this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      this.pending={pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY,pointerType:e.pointerType,pressure:e.pressure};this.requestRender();
    });
    const up=e=>{
      if(this.pending?.pointerId===e.pointerId){const pending=this.pending;this.pending=null;this.handleMove(pending);}
      if(!this.pointers.has(e.pointerId))return;
      if(this.mode==='stamp'&&this.pointers.size===1&&e.type==='pointerup'){
        const point=this.previewPointer;this.stamp(point&&this.hit(point.x,point.y));
      }
      if(this.mode==='hole'&&this.pointers.size===1&&e.type==='pointerup'){const point=this.previewPointer;this.dab(point&&this.hit(point.x,point.y),e);}
      if(this.touchStart&&this.pointers.size===1&&e.type==='pointerup')this.dab(this.touchStart.hit,this.touchStart.event);
      this.touchStart=null;this.pointers.delete(e.pointerId);if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);
      this.brushRing.visible=false;
      if(this.pointers.size){this.mode='orbit';const p=this.pointers.values().next().value;this.lastPointer={...p};}
      else this.finishGesture();this.requestRender();
    };
    el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);el.addEventListener('lostpointercapture',e=>{if(this.pointers.has(e.pointerId))up(e);});
    el.addEventListener('pointerleave',()=>{if(!this.pointers.size){this.brushRing.visible=false;this.pending=null;this.previewPointer=null;if(this.primitivePreview)this.primitivePreview.visible=false;this.requestRender();}});
    el.addEventListener('wheel',e=>{e.preventDefault();this.zoomBy(Math.exp(-Math.max(-100,Math.min(100,e.deltaY))*.0015));},{passive:false});
    window.addEventListener('keydown',e=>{if(e.code==='Space'&&e.target===el){e.preventDefault();this.spaceHeld=true;}});
    window.addEventListener('keyup',e=>{if(e.code==='Space')this.spaceHeld=false;});
    window.addEventListener('blur',()=>{this.spaceHeld=false;this.finishGesture();});
    document.addEventListener('visibilitychange',()=>{this.visible=!document.hidden;if(!this.visible){this.finishGesture();if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;}else{this.lastTime=0;this.requestRender();}});
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.finishGesture();this.visible=false;if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;this.onError('The canvas paused. Your clay is safe; try reloading to keep playing.');});
    this.renderer.domElement.addEventListener('webglcontextrestored',()=>{this.visible=true;this.renderer.shadowMap.needsUpdate=true;this.requestRender();this.onError('Your canvas is ready again.');});
  }
  setGestureBaseline(){const [a,b]=Array.from(this.pointers.values());if(!b)return;this.gesture={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
  handleMove(e){
    if(!this.pointers.has(e.pointerId)){if(!this.pointers.size&&e.pointerType!=='touch'){this.previewPointer={x:e.clientX,y:e.clientY};this.showBrush(this.hit(e.clientX,e.clientY));}return;}
    this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.pointers.size>=2){
      const [a,b]=Array.from(this.pointers.values()),distance=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),x=(a.x+b.x)/2,y=(a.y+b.y)/2;
      if(this.gesture){this.zoomBy(distance/this.gesture.distance);this.theta-=(x-this.gesture.x)*.007;this.phi=THREE.MathUtils.clamp(this.phi-(y-this.gesture.y)*.006,.28,2.65);this.updateCamera();}
      this.gesture={distance,x,y};this.brushRing.visible=false;return;
    }
    if(this.touchStart){
      if(Math.hypot(e.clientX-this.touchStart.x,e.clientY-this.touchStart.y)<4)return;
      this.touchStart=null;
    }
    const dx=e.clientX-this.lastPointer.x,dy=e.clientY-this.lastPointer.y;
    if(this.mode==='orbit'){this.theta-=dx*.007;this.phi=THREE.MathUtils.clamp(this.phi-dy*.006,.28,2.65);this.updateCamera();}
    else if(this.mode==='move'){
      const scale=2*(this.baseDistance/this.zoom)*Math.tan(19*Math.PI/180)/this.height,right=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,1);
      this.target.addScaledVector(right,-dx*scale).addScaledVector(up,dy*scale);this.target.clamp(new THREE.Vector3(-2,-1.8,-2),new THREE.Vector3(2,2.3,2));this.updateCamera();this.onFirstSculpt();
    }
    else if(this.mode==='stamp'){this.previewPointer={x:e.clientX,y:e.clientY};this.showPrimitive(this.hit(e.clientX,e.clientY));}
    else if(this.mode==='hole'){this.previewPointer={x:e.clientX,y:e.clientY};this.showBrush(this.hit(e.clientX,e.clientY));}
    else if(this.mode==='sculpt'){
      this.activeBrushEvent=e;
      if(this.spin||this.tool==='grow'||this.tool==='carve'){this.lastPointer={x:e.clientX,y:e.clientY};return;}
      const steps=Math.max(1,Math.min(6,Math.ceil(Math.hypot(dx,dy)/8)));
      for(let s=1;s<=steps;s++){
        const hit=this.hit(this.lastPointer.x+dx*s/steps,this.lastPointer.y+dy*s/steps);
        if(hit){
          const world=new THREE.Vector3();this.raycaster.ray.intersectPlane(this.strokePlane,world);
          const delta=world.clone().sub(this.previousWorld).clampLength(0,.12);this.previousWorld.copy(world);
          this.dab(hit,e,delta.toArray());this.showBrush(hit);
        }else this.brushRing.visible=false;
      }
    }
    this.lastPointer={x:e.clientX,y:e.clientY};
  }
  finishGesture(){
    this.flushVolume();
    this.pending=null;this.mode=null;this.gesture=null;this.touchStart=null;this.activeBrushEvent=null;
    const ids=[...this.pointers.keys()];this.pointers.clear();for(const id of ids)if(this.container.hasPointerCapture(id))this.container.releasePointerCapture(id);
    this.brushRing.visible=false;this.previewPointer=null;if(this.primitivePreview)this.primitivePreview.visible=false;if(this.changed){this.changed=false;this.onChange();}this.strokeBackup=null;this.editBlocked=false;
  }
  capture(maxWidth=1600){
    this.flushVolume();
    const visible=this.brushRing.visible,previewVisible=this.primitivePreview?.visible;this.brushRing.visible=false;if(this.primitivePreview)this.primitivePreview.visible=false;
    this.renderer.render(this.scene,this.camera);
    const canvas=document.createElement('canvas'),ratio=Math.min(1,maxWidth/this.renderer.domElement.width);
    canvas.width=Math.round(this.renderer.domElement.width*ratio);canvas.height=Math.round(this.renderer.domElement.height*ratio);
    const context=canvas.getContext('2d');context.fillStyle='#eeeee6';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(this.renderer.domElement,0,0,canvas.width,canvas.height);
    this.brushRing.visible=visible;if(this.primitivePreview)this.primitivePreview.visible=previewVisible;this.requestRender();return canvas.toDataURL('image/png');
  }
}
