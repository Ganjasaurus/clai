// Browser-independent mesh operations. A welded indexed surface avoids brush seams.
export function ellipsoid({center=[0,0,0],scale=[1,1,1],rotation=0,segments=64,rings=42}={}) {
  const count=2+(rings-1)*segments;
  const positions=new Float32Array(count*3);
  const indices=new Uint32Array(segments*(rings-1)*6);
  let v=0,t=0;
  const put=(x,y,z)=>{
    const xx=x*scale[0], yy=y*scale[1];
    positions[v++]=xx*Math.cos(rotation)-yy*Math.sin(rotation)+center[0];
    positions[v++]=xx*Math.sin(rotation)+yy*Math.cos(rotation)+center[1];
    positions[v++]=z*scale[2]+center[2];
  };
  put(0,1,0);
  for(let r=1;r<rings;r++){
    const theta=Math.PI*r/rings;
    for(let s=0;s<segments;s++){
      const phi=2*Math.PI*s/segments;
      put(Math.sin(theta)*Math.cos(phi),Math.cos(theta),Math.sin(theta)*Math.sin(phi));
    }
  }
  put(0,-1,0);
  const tri=(a,b,c)=>{indices[t++]=a;indices[t++]=b;indices[t++]=c;};
  for(let s=0;s<segments;s++)tri(0,1+(s+1)%segments,1+s);
  for(let r=0;r<rings-2;r++)for(let s=0;s<segments;s++){
    const a=1+r*segments+s,an=1+r*segments+(s+1)%segments,b=a+segments,bn=an+segments;
    tri(a,an,b);tri(an,bn,b);
  }
  const last=1+(rings-2)*segments;
  for(let s=0;s<segments;s++)tri(last+s,last+(s+1)%segments,count-1);
  return {positions,indices};
}

export function adjacency(indices,count){
  const sets=Array.from({length:count},()=>new Set());
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i],b=indices[i+1],c=indices[i+2];
    sets[a].add(b).add(c);sets[b].add(a).add(c);sets[c].add(a).add(b);
  }
  return sets.map(s=>Uint32Array.from(s));
}

export const BALL_RADIUS=1.28;
export const CLAY_LIMITS=Object.freeze({minRadius:BALL_RADIUS*.72,maxRadius:BALL_RADIUS*2.5,maxSlope:1.15,floor:-1.29});
let ballTemplate;
export function ballSurface(){
  if(!ballTemplate){
    const t=(1+Math.sqrt(5))/2;
    const vertices=[[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(v=>{const r=Math.hypot(...v);return v.map(n=>n/r);});
    let faces=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
    for(let level=0;level<5;level++){
      const cache=new Map(),next=[];
      const midpoint=(a,b)=>{const key=a<b?`${a},${b}`:`${b},${a}`;if(cache.has(key))return cache.get(key);const v=vertices[a].map((n,k)=>(n+vertices[b][k])/2),r=Math.hypot(...v);const id=vertices.push(v.map(n=>n/r))-1;cache.set(key,id);return id;};
      for(const [a,b,c] of faces){const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);next.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]);}faces=next;
    }
    const directions=new Float64Array(vertices.flat()),indices=new Uint32Array(faces.flat()),neighbors=adjacency(indices,vertices.length);
    const bounds=neighbors.map((list,i)=>Float64Array.from(list,j=>Math.acos(Math.max(-1,Math.min(1,directions[i*3]*directions[j*3]+directions[i*3+1]*directions[j*3+1]+directions[i*3+2]*directions[j*3+2])))*CLAY_LIMITS.maxSlope));
    const maxLog=Float64Array.from(vertices,v=>Math.log(Math.min(CLAY_LIMITS.maxRadius,v[1]<0?CLAY_LIMITS.floor/v[1]:Infinity)/BALL_RADIUS));
    // A Lipschitz upper envelope keeps the underside above the work surface even
    // when a growth stroke spreads beyond its original brush footprint.
    const queue=vertices.map((_,i)=>i);
    for(let head=0;head<queue.length;head++){
      const i=queue[head];for(let k=0;k<neighbors[i].length;k++){const j=neighbors[i][k],limit=maxLog[i]+bounds[i][k];if(maxLog[j]>limit+1e-12){maxLog[j]=limit;queue.push(j);}}
    }
    ballTemplate={directions,indices,neighbors,bounds,maxLog};
  }
  return {positions:Float32Array.from(ballTemplate.directions,v=>v*BALL_RADIUS),indices:ballTemplate.indices};
}

// A positive radial distance on an unchanged spherical triangulation cannot fold
// across itself: each face remains inside its original, disjoint spherical cone.
// The core and angular slope limits also bound thickness and triangle distortion.
export function attachClaySafety(mesh){
  ballSurface();
  if(!mesh.positions.every(Number.isFinite)||!mesh.colors.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw new Error('This clay contains invalid surface data.');
  if(mesh.positions.length!==ballTemplate.directions.length||mesh.indices.length!==ballTemplate.indices.length||!mesh.indices.every((v,i)=>v===ballTemplate.indices[i]))throw new Error('This creation needs to be opened as fresh, protected clay.');
  const {directions,neighbors,bounds,maxLog}=ballTemplate,count=directions.length/3,logRadius=new Float64Array(count),minLog=Math.log(CLAY_LIMITS.minRadius/BALL_RADIUS);
  for(let i=0;i<count;i++){
    const j=i*3,r=Math.hypot(mesh.positions[j],mesh.positions[j+1],mesh.positions[j+2]);
    logRadius[i]=Math.max(minLog,Math.min(maxLog[i],Math.log(Math.max(.001,r)/BALL_RADIUS)));
  }
  let shrink=1;
  for(let i=0;i<count;i++)for(let k=0;k<neighbors[i].length;k++){const j=neighbors[i][k];shrink=Math.min(shrink,bounds[i][k]/Math.max(bounds[i][k],Math.abs(logRadius[i]-logRadius[j])));}
  if(shrink<1)for(let i=0;i<count;i++)logRadius[i]*=shrink*(1-1e-6);
  mesh.neighbors=neighbors;mesh.safety={directions,logRadius,maxLog,minLog,bounds,proposal:logRadius.slice(),marks:new Uint32Array(count),stamp:0};
  syncClaySurface(mesh);return mesh;
}

export function syncClaySurface(mesh){
  const {directions,logRadius}=mesh.safety,p=mesh.positions;
  for(let i=0;i<logRadius.length;i++){const r=BALL_RADIUS*Math.exp(logRadius[i]),j=i*3;p[j]=directions[j]*r;p[j+1]=directions[j+1]*r;p[j+2]=directions[j+2]*r;}
  mesh.hash?.rebuild();
}

function applyProtectedBrush(mesh,influences,{tool,strength,normals,drags}){
  const s=mesh.safety,{logRadius:old,proposal,directions,maxLog,minLog,bounds,marks}=s;
  if(++s.stamp===4294967295){marks.fill(0);s.stamp=1;}
  const stamp=s.stamp,changed=[];
  for(const [i,{weight,m}] of influences){
    const j=i*3,w=Math.max(0,Math.min(2,strength))*weight,r=BALL_RADIUS*Math.exp(old[i]);
    let next=old[i];
    if(tool==='smooth'){
      let sum=0;for(const neighbor of mesh.neighbors[i])sum+=old[neighbor];next+=(sum/mesh.neighbors[i].length-old[i])*Math.min(.5,w*.42);
    }else{
      const n=normals[m],d=drags[m],normalDot=directions[j]*n[0]+directions[j+1]*n[1]+directions[j+2]*n[2];
      const moving=tool==='pull'&&Math.hypot(...d)>.00001,dragDot=directions[j]*d[0]+directions[j+1]*d[1]+directions[j+2]*d[2];
      const amount=tool==='grow'?.035:tool==='push'?-normalDot*.033:moving?dragDot*.8+normalDot*.008:normalDot*.04;
      const remaining=amount<0?r-CLAY_LIMITS.minRadius:BALL_RADIUS*Math.exp(maxLog[i])-r;
      const softness=Math.min(1,Math.max(0,remaining)/.16);
      next=Math.log(Math.max(.001,r+amount*w*softness)/BALL_RADIUS);
    }
    proposal[i]=Math.max(minLog,Math.min(maxLog[i],next));marks[i]=stamp;changed.push(i);
  }
  return commitProtectedProposal(mesh,changed,stamp,tool);
}

export function commitProtectedProposal(mesh,changed,stamp,tool='grow'){
  const {logRadius:old,proposal,directions,maxLog,minLog,bounds,marks}=mesh.safety;
  // Grow adds a rounded envelope; squish removes one. When a stroke reaches the
  // slope limit it spreads quietly into neighboring clay instead of making a
  // spike, stopping abruptly, or opening a thin crease.
  if(tool==='grow'||tool==='push'){
    const queue=changed.slice();let head=0;
    while(head<queue.length&&head<old.length*12){
      const i=queue[head++];
      for(let k=0;k<mesh.neighbors[i].length;k++){
        const j=mesh.neighbors[i][k],value=marks[j]===stamp?proposal[j]:old[j],bound=bounds[i][k];
        const next=tool==='grow'?Math.max(value,proposal[i]-bound):Math.min(value,proposal[i]+bound);
        const safe=Math.max(minLog,Math.min(maxLog[j],next));
        if(Math.abs(safe-value)>1e-12){if(marks[j]!==stamp){marks[j]=stamp;changed.push(j);}proposal[j]=safe;queue.push(j);}
      }
    }
  }
  // Pick one safe step along the proposed stroke. Log-space interpolation keeps
  // every edge inside its angular slope bound, including mirrored brush borders.
  let step=1;
  for(const i of changed)for(let k=0;k<mesh.neighbors[i].length;k++){
    const j=mesh.neighbors[i][k],before=old[i]-old[j],after=proposal[i]-(marks[j]===stamp?proposal[j]:old[j]),bound=bounds[i][k];
    if(Math.abs(after)>bound+1e-12){const limit=(Math.sign(after)*bound-before)/(after-before);step=Math.min(step,Math.max(0,limit*.96));}
  }
  let count=0;
  for(const i of changed){
    const value=old[i]+(proposal[i]-old[i])*step;if(Math.abs(value-old[i])<1e-12)continue;old[i]=value;
    const j=i*3,r=BALL_RADIUS*Math.exp(value);mesh.positions[j]=directions[j]*r;mesh.positions[j+1]=directions[j+1]*r;mesh.positions[j+2]=directions[j+2]*r;mesh.hash.update(i);count++;
  }
  return count;
}

export function protectedClay(snapshot){
  const template=ballSurface(),source=snapshot.meshes;
  if(!source?.length)throw new Error('This creation has no clay to open.');
  const canonical=source.length===1&&source[0].positions.length===template.positions.length&&source[0].indices.length===template.indices.length&&source[0].indices.every((v,i)=>v===template.indices[i]);
  let positions,colors;
  if(canonical){positions=source[0].positions.slice();colors=source[0].colors.slice();}
  else{
    // Earlier clay files are sampled into the same closed representation. Files
    // never get to replace the protected topology with arbitrary triangles.
    const count=source.reduce((n,m)=>n+m.positions.length/3,0),directions=new Float32Array(count*3),radii=new Float32Array(count),pigments=new Float32Array(count*3);let offset=0;
    for(const m of source)for(let j=0;j<m.positions.length;j+=3){const r=Math.max(.001,Math.hypot(m.positions[j],m.positions[j+1],m.positions[j+2])),i=offset++;
      for(let k=0;k<3;k++){directions[i*3+k]=m.positions[j+k]/r;pigments[i*3+k]=m.colors[j+k];}radii[i]=r;}
    const hash=new SpatialHash(directions,.14);positions=template.positions;colors=new Float32Array(positions.length);
    for(let i=0;i<positions.length;i+=3){
      const dir=[positions[i]/BALL_RADIUS,positions[i+1]/BALL_RADIUS,positions[i+2]/BALL_RADIUS];let candidates=hash.query(dir,.13);
      if(!candidates.length)candidates=hash.query(dir,.3);
      let total=0,radius=0;const tint=[0,0,0];
      for(const j of candidates){const d2=(directions[j*3]-dir[0])**2+(directions[j*3+1]-dir[1])**2+(directions[j*3+2]-dir[2])**2;if(d2>.09)continue;const w=1/(.0008+d2)**2;total+=w;radius+=radii[j]*w;for(let k=0;k<3;k++)tint[k]+=pigments[j*3+k]*w;}
      const r=total?radius/total:BALL_RADIUS;
      for(let k=0;k<3;k++){positions[i+k]=dir[k]*r;colors[i+k]=total?tint[k]/total:[.8469,.2462,.0953][k];}
    }
  }
  return {name:snapshot.name,surface:'protected-ball-v1',meshes:[{name:'Clay',positions,colors,indices:template.indices}]};
}

export class SpatialHash {
  constructor(positions,cellSize=.25){this.cellSize=cellSize;this.positions=positions;this.buckets=new Map();this.keys=[];this.rebuild();}
  key(x,y,z){return `${Math.floor(x/this.cellSize)},${Math.floor(y/this.cellSize)},${Math.floor(z/this.cellSize)}`;}
  rebuild(){this.buckets.clear();for(let i=0;i<this.positions.length/3;i++)this.insert(i);}
  insert(i){const p=this.positions,k=this.key(p[i*3],p[i*3+1],p[i*3+2]);this.keys[i]=k;if(!this.buckets.has(k))this.buckets.set(k,new Set());this.buckets.get(k).add(i);}
  update(i){const p=this.positions,k=this.key(p[i*3],p[i*3+1],p[i*3+2]);if(this.keys[i]===k)return;const old=this.buckets.get(this.keys[i]);old?.delete(i);if(old?.size===0)this.buckets.delete(this.keys[i]);this.insert(i);}
  query(center,radius){
    const result=[],s=this.cellSize;
    const lo=center.map(c=>Math.floor((c-radius)/s)),hi=center.map(c=>Math.floor((c+radius)/s));
    for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++){
      const bucket=this.buckets.get(`${x},${y},${z}`);if(bucket)for(const i of bucket)result.push(i);
    }
    return result;
  }
}

export function applyBrush(mesh,{point,normal,tool='push',radius=.42,strength=1,color=[1,0,0],drag=[0,0,0],mirror=false}){
  if(tool==='orbit'||radius<=0)return 0;
  const p=mesh.positions,c=mesh.colors,r2=radius*radius;
  const centers=[point];const normals=[normal];const drags=[drag];
  if(mirror){centers.push([-point[0],point[1],point[2]]);normals.push([-normal[0],normal[1],normal[2]]);drags.push([-drag[0],drag[1],drag[2]]);}
  const influences=new Map();
  for(let m=0;m<centers.length;m++)for(const i of mesh.hash.query(centers[m],radius)){
    const j=i*3,dx=p[j]-centers[m][0],dy=p[j+1]-centers[m][1],dz=p[j+2]-centers[m][2],d2=dx*dx+dy*dy+dz*dz;
    if(d2>=r2)continue;
    const weight=(1-d2/r2)**2;
    if(!influences.has(i)||weight>influences.get(i).weight)influences.set(i,{weight,m});
  }
  if(mesh.safety&&tool!=='paint')return applyProtectedBrush(mesh,influences,{tool,strength,normals,drags});
  const source=tool==='smooth'?p.slice():p;
  for(const [i,{weight,m}] of influences){
    const j=i*3,w=weight*strength,n=normals[m],d=drags[m];
    if(tool==='paint'){
      for(let k=0;k<3;k++)c[j+k]+=(color[k]-c[j+k])*Math.min(1,w*.55);
    }else if(tool==='smooth'){
      const neighbors=mesh.neighbors[i];
      for(let k=0;k<3;k++){let sum=0;for(const ni of neighbors)sum+=source[ni*3+k];p[j+k]+=(sum/neighbors.length-source[j+k])*Math.min(.55,w*.42);}
    }else{
      const moving=tool==='pull'&&Math.hypot(...d)>.00001;
      for(let k=0;k<3;k++)p[j+k]+=w*(tool==='push'?-n[k]*.033:moving?d[k]*.8+n[k]*.008:n[k]*.04);
    }
    // Finite work envelope also keeps extreme repeated strokes easy to recover from.
    if(tool!=='paint'){for(let k=0;k<3;k++)p[j+k]=Math.max(-5,Math.min(5,p[j+k]));mesh.hash.update(i);}
  }
  return influences.size;
}

export class History {
  constructor(limit=24,maxBytes=48*1024*1024){this.limit=limit;this.maxBytes=maxBytes;this.states=[];this.index=-1;}
  push(state){this.states.splice(this.index+1);this.states.push(state);this.index=this.states.length-1;while(this.states.length>2&&(this.states.length>this.limit||this.bytes>this.maxBytes)){this.states.shift();this.index--;}}
  get bytes(){return this.states.reduce((sum,s)=>sum+s.meshes.reduce((n,m)=>n+m.positions.byteLength+m.colors.byteLength+(m.indices?.byteLength??0),0),0);}
  get canUndo(){return this.index>0;}
  get canRedo(){return this.index<this.states.length-1;}
  undo(){return this.canUndo?this.states[--this.index]:null;}
  redo(){return this.canRedo?this.states[++this.index]:null;}
}

export function encodeProject(snapshot){return {format:'clai',version:2,name:snapshot.name,surface:snapshot.surface,meshes:snapshot.meshes.map(m=>({name:m.name,positions:Array.from(m.positions,v=>Math.round(v*100000)/100000),colors:Array.from(m.colors,v=>Math.round(v*10000)/10000),indices:Array.from(m.indices)}))};}

export function decodeProject(data){
  if(!data||data.format!=='clai'||![1,2].includes(data.version)||!Array.isArray(data.meshes)||data.meshes.length<1||data.meshes.length>32)throw new Error('This file is not a clai creation.');
  let vertices=0;
  const meshes=data.meshes.map((m,i)=>{
    if(!m||!Array.isArray(m.positions)||!Array.isArray(m.colors)||!Array.isArray(m.indices)||m.positions.length<12||m.positions.length%3||m.positions.length!==m.colors.length||m.indices.length%3||m.indices.length<3)throw new Error('This creation has an incomplete clay surface.');
    const count=m.positions.length/3;vertices+=count;
    if(vertices>65000||m.indices.length>390000)throw new Error('This creation is too big for the little studio.');
    if(!m.positions.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=6)||!m.colors.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1)||!m.indices.every(v=>Number.isInteger(v)&&v>=0&&v<count))throw new Error('This creation contains invalid clay data.');
    return {name:String(m.name??`Clay ${i+1}`).slice(0,40),positions:new Float32Array(m.positions),colors:new Float32Array(m.colors),indices:new Uint32Array(m.indices)};
  });
  return {name:String(data.name??'My little creation').slice(0,40),surface:data.surface==='protected-ball-v1'?data.surface:undefined,meshes};
}

export function exportOBJ(snapshot){
  const lines=['# Made with clai — your little clay playground'];let offset=1;
  for(const m of snapshot.meshes){
    lines.push(`o ${m.name.replace(/[^a-zA-Z0-9_-]/g,'_')}`);
    for(let i=0;i<m.positions.length;i+=3)lines.push(`v ${m.positions[i]} ${m.positions[i+1]} ${m.positions[i+2]}`);
    for(let i=0;i<m.indices.length;i+=3)lines.push(`f ${m.indices[i]+offset} ${m.indices[i+1]+offset} ${m.indices[i+2]+offset}`);
    offset+=m.positions.length/3;
  }
  return lines.join('\n');
}
