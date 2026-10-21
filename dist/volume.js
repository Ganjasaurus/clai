// Editable solid clay. A bounded scalar lattice replaces the old solid radial
// core. Matching tetrahedra share every crossing edge, including tunnel walls.
// Edits touch local samples; meshing skips cached empty/interior chunks.
import {primitiveDistance,primitiveBasis,smoothUnion,PRIMITIVES} from './primitives.js';

export const VOLUME=Object.freeze({cells:64,size:65,step:.1125,extent:3.6,floor:-1.29,maxVertices:64000,maxTriangles:128000});
const N=VOLUME.size,NN=N*N,COUNT=N*N*N,H=VOLUME.step,E=VOLUME.extent;
const coord=i=>i*H-E,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const safe=v=>Math.abs(v)<.00001?(v<0?-.00001:.00001):clamp(v,-8,8);
const finite3=v=>v&&v.length===3&&Array.from(v).every(Number.isFinite);
const offsets=[0,1,N,N+1,NN,NN+1,NN+N,NN+N+1];
const corners=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
const tets=[[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]];
const edgeKinds=new Map([1,N,N+1,NN,NN+1,NN+N,NN+N+1].map((v,i)=>[v,i]));
const cases=Array.from({length:256},(_,mask)=>{
  const triangles=[];
  for(const tet of tets){
    const inside=tet.filter(i=>mask&(1<<i)),outside=tet.filter(i=>!(mask&(1<<i)));
    if(!inside.length||!outside.length)continue;
    let faces;
    if(inside.length===1)faces=[outside.map(b=>[inside[0],b])];
    else if(outside.length===1)faces=[inside.map(a=>[a,outside[0]])];
    else{const [a,b]=inside,[c,d]=outside;faces=[[[a,c],[a,d],[b,d]],[[a,c],[b,d],[b,c]]];}
    for(const face of faces){
      const p=face.map(([a,b])=>corners[a].map((v,k)=>(v+corners[b][k])*.5)),u=p[1].map((v,k)=>v-p[0][k]),v=p[2].map((v,k)=>v-p[0][k]);
      const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],out=corners[outside[0]].map((v,k)=>v-corners[inside[0]][k]);
      if(normal.reduce((s,v,k)=>s+v*out[k],0)<0)[face[1],face[2]]=[face[2],face[1]];
      triangles.push(...face.map(([a,b])=>a<b?[a,b]:[b,a]));
    }
  }
  return triangles;
});

function runtime(field){
  field.dirty=new Uint8Array(512).fill(1);field.active=new Uint8Array(512);
  field.edgeIndex=new Int32Array(COUNT*7);field.meshDirty=true;field.geometryDirty=true;return field;
}
export function cloneVolume(field){return {values:field.values.slice(),pigment:field.pigment.slice()};}
export function restoreVolume(saved){
  if(!saved||saved.values?.length!==COUNT||saved.pigment?.length!==COUNT*3||!Array.from(saved.values).every(v=>Number.isFinite(v)&&Math.abs(v)<=8)||!Array.from(saved.pigment).every(v=>Number.isInteger(v)&&v>=0&&v<=255))throw new Error('This clay has incomplete solid data.');
  const field=runtime({values:Float32Array.from(saved.values),pigment:Uint8Array.from(saved.pigment)});enclose(field);return field;
}
function enclose(field){
  const f=field.values;
  for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const i=x+y*N+z*NN;
    f[i]=safe(Math.max(f[i],VOLUME.floor-coord(y),Math.abs(coord(x))-E+H,Math.abs(coord(z))-E+H,coord(y)-E+H));
  }
}
export function createVolume(type='head',color=[.847,.246,.095]){
  const field=runtime({values:new Float32Array(COUNT),pigment:new Uint8Array(COUNT*3)}),c=color.map(v=>Math.round(clamp(v,0,1)*255));
  for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const px=coord(x),py=coord(y),pz=coord(z),i=x+y*N+z*NN;
    let d=Math.hypot(px,py,pz)-1.28;
    if(type==='head'){
      const taper=1-.16*clamp(-py,0,1.4),a=1.03*taper;
      d=(Math.hypot(px/a,(py-.14)/1.42,pz/.96)-1)*.9;
      d=smoothUnion(d,Math.hypot(px,(py-.08)*1.1,(pz-.99)*1.05)-.27,.16);
      for(const side of [-1,1])d=smoothUnion(d,(Math.hypot((px-side*1.02)/.24,(py-.12)/.37,pz/.3)-1)*.24,.17);
    }
    field.values[i]=safe(d);
    let tint=c;
    if(type==='head'&&pz>.7){
      const eye=Math.min(Math.hypot((px-.36)/.075,(py-.39)/.1),Math.hypot((px+.36)/.075,(py-.39)/.1));
      const smile=Math.abs(py-(-.31+.7*px*px));
      if(eye<1.3||(Math.abs(px)<.23&&smile<.04))tint=[14,19,13];
    }
    field.pigment.set(tint,i*3);
  }
  enclose(field);return field;
}

export function sampleVolume(field,x,y,z){
  const f=field.values,gx=clamp((x+E)/H,0,N-1.000001),gy=clamp((y+E)/H,0,N-1.000001),gz=clamp((z+E)/H,0,N-1.000001),ix=Math.floor(gx),iy=Math.floor(gy),iz=Math.floor(gz),a=gx-ix,b=gy-iy,c=gz-iz,i=ix+iy*N+iz*NN;
  return (f[i]*(1-a)+f[i+1]*a)*(1-b)*(1-c)+(f[i+N]*(1-a)+f[i+N+1]*a)*b*(1-c)+(f[i+NN]*(1-a)+f[i+NN+1]*a)*(1-b)*c+(f[i+NN+N]*(1-a)+f[i+NN+N+1]*a)*b*c;
}

// Sample older, closed radial clay into the new solid. The caller supplies a
// direction lookup so old colors and silhouettes survive the upgrade.
export function volumeFromRadial(mesh){
  const field=createVolume('ball'),s=mesh.safety,dirs=s.directions;
  const longitude=192,latitude=96,lookup=new Int32Array(longitude*latitude).fill(-1);
  for(let i=0;i<dirs.length/3;i++){
    const u=Math.min(longitude-1,Math.floor((Math.atan2(dirs[i*3+2],dirs[i*3])+Math.PI)/(2*Math.PI)*longitude)),v=Math.min(latitude-1,Math.floor(Math.acos(clamp(dirs[i*3+1],-1,1))/Math.PI*latitude));lookup[u+v*longitude]=i;
  }
  for(let pass=0;pass<8&&lookup.some(v=>v<0);pass++){
    const before=lookup.slice();for(let v=0;v<latitude;v++)for(let u=0;u<longitude;u++)if(before[u+v*longitude]<0){for(const [a,b] of [[(u+1)%longitude,v],[(u+longitude-1)%longitude,v],[u,Math.max(0,v-1)],[u,Math.min(latitude-1,v+1)]])if(before[a+b*longitude]>=0){lookup[u+v*longitude]=before[a+b*longitude];break;}}
  }
  for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const px=coord(x),py=coord(y),pz=coord(z),r=Math.hypot(px,py,pz),i=x+y*N+z*NN;
    const u=Math.min(longitude-1,Math.floor((Math.atan2(pz,px)+Math.PI)/(2*Math.PI)*longitude)),v=Math.min(latitude-1,Math.floor(Math.acos(clamp(py/(r||1),-1,1))/Math.PI*latitude)),j=Math.max(0,lookup[u+v*longitude]);
    field.values[i]=safe(r-1.28*Math.exp(s.logRadius[j]));
    for(let k=0;k<3;k++)field.pigment[i*3+k]=Math.round(mesh.colors[j*3+k]*255);
  }
  enclose(field);return field;
}

function mark(field,x,y,z,geometry=true){
  field.meshDirty=true;if(!geometry)return;field.geometryDirty=true;
  // Neighboring cells share samples, and gradient normals use one extra sample.
  for(let a=Math.max(0,Math.floor((x-2)/8));a<=Math.min(7,Math.floor((x+1)/8));a++)for(let b=Math.max(0,Math.floor((y-2)/8));b<=Math.min(7,Math.floor((y+1)/8));b++)for(let c=Math.max(0,Math.floor((z-2)/8));c<=Math.min(7,Math.floor((z+1)/8));c++)field.dirty[a+b*8+c*64]=1;
  field.meshDirty=true;
}

export function editVolume(field,{tool='push',point,normal=[0,0,1],radius=.42,strength=1,drag=[0,0,0],color=[.847,.246,.095],mirror=false,type='ball',blend=.22,size=.7,direction=normal}={}){
  if(!finite3(point)||!finite3(normal)||!finite3(color)||!finite3(drag)||!finite3(direction)||!Number.isFinite(radius)||!Number.isFinite(strength)||!['push','pull','grow','smooth','paint','carve','hole','stamp','flatten'].includes(tool))return 0;
  if(tool==='stamp'&&!PRIMITIVES[type])return 0;
  radius=clamp(radius,tool==='hole'?.27:tool==='paint'?.12:.22,.95);strength=clamp(strength,0,2);size=clamp(Number(size)||.7,.3,1.15);blend=clamp(Number(blend)||.22,.06,.5);
  const centers=[point],normals=[normal],directions=[direction],drags=[drag];
  if(mirror&&Math.abs(point[0])>.025){centers.push([-point[0],point[1],point[2]]);normals.push([-normal[0],normal[1],normal[2]]);directions.push([-direction[0],direction[1],direction[2]]);drags.push([-drag[0],drag[1],drag[2]]);}
  const source=tool==='smooth'||tool==='pull'||(mirror&&tool==='stamp')?field.values.slice():null;
  let changed=0;
  for(let part=0;part<centers.length;part++){
    const p=centers[part],normal=normals[part],basis=primitiveBasis(normal),length=Math.hypot(...directions[part])||1,axis=directions[part].map(v=>v/length);
    const center=tool==='stamp'?p.map((v,k)=>v+basis[3+k]*size*.08):p;
    const reach=tool==='hole'?E*2:tool==='stamp'?size*PRIMITIVES[type].bound+blend:radius+H;
    const low=center.map(v=>clamp(Math.floor((v-reach+E)/H),1,N-2)),high=center.map(v=>clamp(Math.ceil((v+reach+E)/H),1,N-2));
    for(let z=low[2];z<=high[2];z++)for(let y=low[1];y<=high[1];y++)for(let x=low[0];x<=high[0];x++){
      const i=x+y*N+z*NN,px=coord(x),py=coord(y),pz=coord(z),dx=px-center[0],dy=py-center[1],dz=pz-center[2],d2=dx*dx+dy*dy+dz*dz;
      if(tool!=='hole'&&tool!=='stamp'&&d2>radius*radius)continue;
      if(centers.length>1&&tool!=='hole'&&tool!=='stamp'&&tool!=='carve'){
        const other=centers[1-part],otherDistance=(px-other[0])**2+(py-other[1])**2+(pz-other[2])**2;
        if(otherDistance<d2||(otherDistance===d2&&part===1))continue;
      }
      const before=field.values[i],w=Math.max(0,1-d2/(radius*radius))**2;
      let value=before;
      if(tool==='hole'){
        const along=dx*axis[0]+dy*axis[1]+dz*axis[2],distance=Math.sqrt(Math.max(0,d2-along*along));
        if(distance>radius+H)continue;value=Math.max(before,radius-distance);
      }else if(tool==='stamp'){
        const distance=primitiveDistance(type,dx*basis[0]+dy*basis[1]+dz*basis[2],dx*basis[3]+dy*basis[4]+dz*basis[5],dx*basis[6]+dy*basis[7]+dz*basis[8],size);
        if(distance>blend+H)continue;value=Math.min(before,smoothUnion(source?source[i]:before,distance,blend));
      }else if(tool==='carve')value=Math.max(before,(radius*.8-Math.sqrt(d2))*.55);
      else if(tool==='smooth')value=before+((source[i-1]+source[i+1]+source[i-N]+source[i+N]+source[i-NN]+source[i+NN])/6-before)*w*Math.min(.55,strength*.32);
      else if(tool==='pull'){
        const d=drags[part],moving=Math.hypot(...d)>.00001,v=moving?d:normal.map(v=>v*.025),f={values:source};
        value=sampleVolume(f,px-v[0]*w*strength,py-v[1]*w*strength,pz-v[2]*w*strength);
      }else if(tool==='flatten'){
        const distance=dx*normal[0]+dy*normal[1]+dz*normal[2];value=before+(distance-before)*w*Math.min(.6,strength*.3);
      }else if(tool!=='paint')value=before+(tool==='push'?1:-1)*.04*strength*w;
      value=safe(Math.max(value,VOLUME.floor-py,Math.abs(px)-E+H,Math.abs(pz)-E+H,py-E+H));
      if(tool==='paint'){
        if(Math.abs(before)>radius)continue;
        let painted=false;for(let k=0;k<3;k++){const c=i*3+k,next=Math.round(field.pigment[c]+(clamp(color[k],0,1)*255-field.pigment[c])*Math.min(1,w*strength*.65));painted||=next!==field.pigment[c];field.pigment[c]=next;}
        if(painted){mark(field,x,y,z,false);changed++;}
      }else if(Math.abs(value-before)>.000001){
        field.values[i]=value;mark(field,x,y,z);changed++;
        if(tool==='stamp'&&value<before)for(let k=0;k<3;k++){const c=i*3+k,t=clamp((before-value)/.15,0,1);field.pigment[c]=Math.round(field.pigment[c]+(clamp(color[k],0,1)*255-field.pigment[c])*t);}
      }
    }
  }
  return changed;
}

export function meshVolume(field){
  if(!field.meshDirty&&field.mesh)return field.mesh;
  if(!field.geometryDirty&&field.mesh&&field.paintCache){
    const {a,b,t}=field.paintCache,c=field.mesh.colors,p=field.pigment;
    for(let i=0;i<a.length;i++)for(let k=0;k<3;k++)c[i*3+k]=(p[a[i]*3+k]+(p[b[i]*3+k]-p[a[i]*3+k])*t[i])/255;
    field.meshDirty=false;return field.mesh;
  }
  const f=field.values,pigment=field.pigment,edges=field.edgeIndex;edges.fill(-1);
  const positions=[],colors=[],indices=[],normals=[],sampleA=[],sampleB=[],sampleT=[];
  const vertex=(base,a,b)=>{
    const ia=base+offsets[a],ib=base+offsets[b],key=ia*7+edgeKinds.get(ib-ia);let index=edges[key];if(index>=0)return index;
    const t=clamp(f[ia]/(f[ia]-f[ib]),.00001,.99999),az=Math.floor(ia/NN),ay=Math.floor((ia-az*NN)/N),ax=ia%N,bz=Math.floor(ib/NN),by=Math.floor((ib-bz*NN)/N),bx=ib%N;
    index=positions.length/3;edges[key]=index;positions.push(coord(ax+(bx-ax)*t),coord(ay+(by-ay)*t),coord(az+(bz-az)*t));sampleA.push(ia);sampleB.push(ib);sampleT.push(t);
    for(let k=0;k<3;k++)colors.push((pigment[ia*3+k]+(pigment[ib*3+k]-pigment[ia*3+k])*t)/255);
    const gx=(f[ia+1]-f[ia-1])*(1-t)+(f[ib+1]-f[ib-1])*t,gy=(f[ia+N]-f[ia-N])*(1-t)+(f[ib+N]-f[ib-N])*t,gz=(f[ia+NN]-f[ia-NN])*(1-t)+(f[ib+NN]-f[ib-NN])*t,length=Math.hypot(gx,gy,gz)||1;
    normals.push(gx/length,gy/length,gz/length);return index;
  };
  for(let cz=0;cz<8;cz++)for(let cy=0;cy<8;cy++)for(let cx=0;cx<8;cx++){
    const chunk=cx+cy*8+cz*64;
    if(field.dirty[chunk]){
      let negative=false,positive=false;
      for(let z=cz*8;z<=cz*8+8&&!(negative&&positive);z++)for(let y=cy*8;y<=cy*8+8&&!(negative&&positive);y++)for(let x=cx*8;x<=cx*8+8;x++){
        const value=f[x+y*N+z*NN];negative||=value<0;positive||=value>=0;if(negative&&positive)break;
      }
      field.active[chunk]=Number(negative&&positive);field.dirty[chunk]=0;
    }
    if(!field.active[chunk])continue;
    for(let z=cz*8;z<cz*8+8;z++)for(let y=cy*8;y<cy*8+8;y++)for(let x=cx*8;x<cx*8+8;x++){
      const base=x+y*N+z*NN;let mask=0;for(let k=0;k<8;k++)if(f[base+offsets[k]]<0)mask|=1<<k;
      if(mask===0||mask===255)continue;
      for(const [a,b] of cases[mask])indices.push(vertex(base,a,b));
      if(positions.length/3>VOLUME.maxVertices||indices.length/3>VOLUME.maxTriangles)throw new Error('Let’s keep this clay light. Undo a little detail, then keep creating.');
    }
  }
  if(positions.length/3>VOLUME.maxVertices||indices.length/3>VOLUME.maxTriangles)throw new Error('Let’s keep this clay light. Undo a little detail, then keep creating.');
  field.meshDirty=false;field.geometryDirty=false;field.paintCache={a:new Uint32Array(sampleA),b:new Uint32Array(sampleB),t:new Float32Array(sampleT)};
  return field.mesh={name:'Clay',positions:new Float32Array(positions),colors:new Float32Array(colors),normals:new Float32Array(normals),indices:new Uint16Array(indices)};
}

export function encodeVolume(field){
  // Exact float bytes preserve tiny sign changes around a hole across saves.
  const bytes=new Uint8Array(field.values.buffer,field.values.byteOffset,field.values.byteLength);
  const base64=data=>{let s='';for(let i=0;i<data.length;i+=8192)s+=String.fromCharCode(...data.subarray(i,i+8192));return btoa(s);};
  return {grid:1,values:base64(bytes),pigment:base64(field.pigment)};
}
export function decodeVolume(data){
  if(data?.grid!==1||typeof data.values!=='string'||typeof data.pigment!=='string'||data.values.length!==Math.ceil(COUNT*4/3)*4||data.pigment.length!==Math.ceil(COUNT*3/3)*4)throw new Error('This clay has incomplete solid data.');
  const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));let values,pigment;
  try{values=new Float32Array(bytes(data.values).buffer);pigment=bytes(data.pigment);}catch{throw new Error('This clay file could not be read.');}
  return cloneVolume(restoreVolume({values,pigment}));
}
