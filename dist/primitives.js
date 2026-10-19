import {BALL_RADIUS,CLAY_LIMITS,commitProtectedProposal} from './sculpt.js';

export const PRIMITIVES=Object.freeze({
  ball:{label:'Ball',bound:1},
  egg:{label:'Egg',bound:1},
  capsule:{label:'Pill',bound:1},
  cube:{label:'Soft cube',bound:1.46}
});

export function primitiveBasis(normal=[0,1,0]){
  if(Math.hypot(...normal)<1e-8)return [1,0,0,0,1,0,0,0,1];
  const length=Math.hypot(...normal)||1,v=normal.map(n=>n/length);
  const ref=Math.abs(v[1])<.95?[0,1,0]:[1,0,0];
  let u=[ref[1]*v[2]-ref[2]*v[1],ref[2]*v[0]-ref[0]*v[2],ref[0]*v[1]-ref[1]*v[0]];
  const r=Math.hypot(...u);u=u.map(n=>n/r);
  const w=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  return [...u,...v,...w];
}

export function primitiveDistance(type,x,y,z,size=1){
  if(type==='ball')return Math.hypot(x,y,z)-size;
  if(type==='egg'){
    const a=size*.72,b=size,k0=Math.hypot(x/a,y/b,z/a),k1=Math.hypot(x/(a*a),y/(b*b),z/(a*a));
    return k1?k0*(k0-1)/k1:-a;
  }
  if(type==='capsule')return Math.hypot(x,Math.max(0,Math.abs(y)-size*.45),z)-size*.55;
  const qx=Math.abs(x)-size*.68,qy=Math.abs(y)-size*.68,qz=Math.abs(z)-size*.68;
  return Math.hypot(Math.max(0,qx),Math.max(0,qy),Math.max(0,qz))+Math.min(0,Math.max(qx,qy,qz))-size*.16;
}

function sphereExit(ox,oy,oz,dx,dy,dz,r){
  const b=ox*dx+oy*dy+oz*dz,c=ox*ox+oy*oy+oz*oz-r*r,disc=b*b-c;
  if(disc<0)return -Infinity;const t=-b+Math.sqrt(disc);return t>0?t:-Infinity;
}
function primitiveExit(type,ox,oy,oz,dx,dy,dz,size,boundExit){
  if(type==='ball')return sphereExit(ox,oy,oz,dx,dy,dz,size);
  if(type==='egg'){
    const ax=size*.72,ay=size,a=(dx*dx+dz*dz)/(ax*ax)+dy*dy/(ay*ay),b=(ox*dx+oz*dz)/(ax*ax)+oy*dy/(ay*ay),c=(ox*ox+oz*oz)/(ax*ax)+oy*oy/(ay*ay)-1,disc=b*b-a*c;
    return disc<0?-Infinity:(-b+Math.sqrt(disc))/a;
  }
  if(type==='capsule'){
    const h=size*.45,r=size*.55;
    let exit=Math.max(sphereExit(ox,oy-h,oz,dx,dy,dz,r),sphereExit(ox,oy+h,oz,dx,dy,dz,r));
    const a=dx*dx+dz*dz,b=ox*dx+oz*dz,c=ox*ox+oz*oz-r*r,disc=b*b-a*c;
    if(a>1e-12&&disc>=0)for(const t of [(-b-Math.sqrt(disc))/a,(-b+Math.sqrt(disc))/a])if(t>0&&Math.abs(oy+dy*t)<=h)exit=Math.max(exit,t);
    return exit;
  }
  // Rounded-box distance tracing starts at a conservative bounding-sphere exit.
  // Most rays miss it cheaply; only the local primitive footprint needs tracing.
  let t=boundExit;
  for(let step=0;step<24&&t>0;step++){
    const d=primitiveDistance(type,ox+dx*t,oy+dy*t,oz+dz*t,size);
    if(d<size*.00005)return t;
    t-=Math.max(d,size*.00003);
  }
  return -Infinity;
}
export function smoothUnion(a,b,k){
  const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25;
}

export function blendPrimitive(mesh,{type='ball',point,normal=[0,1,0],size=.72,blend=.22,color=[.85,.25,.1],mirror=false}){
  if(!PRIMITIVES[type]||!mesh.safety||!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite)||normal.length!==3||!normal.every(Number.isFinite)||color.length!==3||!color.every(v=>Number.isFinite(v)&&v>=0&&v<=1))return 0;
  if(Math.hypot(...point)>CLAY_LIMITS.maxRadius+.1)return 0;
  size=Math.max(.3,Math.min(1.15,Number(size)||.72));blend=Math.max(.06,Math.min(.5,Number(blend)||.22));
  const basis=primitiveBasis(normal),center=point.map((n,k)=>n+basis[3+k]*size*.08);
  const centers=[center],bases=[basis];
  if(mirror&&Math.abs(center[0])>.015){centers.push([-center[0],center[1],center[2]]);bases.push(primitiveBasis([-normal[0],normal[1],normal[2]]));}
  const s=mesh.safety,{directions,logRadius:old,proposal,marks,maxLog}=s;
  if(++s.stamp===4294967295){marks.fill(0);s.stamp=1;}
  const stamp=s.stamp,before=old.slice(),changed=[];
  const bound=size*PRIMITIVES[type].bound+blend;
  for(let part=0;part<centers.length;part++){
    const c=centers[part],b=bases[part],cx=c[0],cy=c[1],cz=c[2],distance2=cx*cx+cy*cy+cz*cz;
    const ox=-(b[0]*cx+b[1]*cy+b[2]*cz),oy=-(b[3]*cx+b[4]*cy+b[5]*cz),oz=-(b[6]*cx+b[7]*cy+b[8]*cz);
    for(let i=0;i<old.length;i++){
      const j=i*3,wx=directions[j],wy=directions[j+1],wz=directions[j+2],projection=wx*cx+wy*cy+wz*cz,disc=projection*projection-distance2+bound*bound;
      if(disc<0)continue;
      const far=projection+Math.sqrt(disc),current=BALL_RADIUS*Math.exp(old[i]);if(far<=current)continue;
      const dx=b[0]*wx+b[1]*wy+b[2]*wz,dy=b[3]*wx+b[4]*wy+b[5]*wz,dz=b[6]*wx+b[7]*wy+b[8]*wz;
      const exit=primitiveExit(type,ox,oy,oz,dx,dy,dz,size,far);
      let low=Math.max(current,exit),high=Math.min(CLAY_LIMITS.maxRadius,Math.max(current,far));
      const d=primitiveDistance(type,ox+dx*low,oy+dy*low,oz+dz*low,size);
      if(smoothUnion(low-current,d,blend)<0){
        for(let iteration=0;iteration<11;iteration++){
          const mid=(low+high)*.5,sd=primitiveDistance(type,ox+dx*mid,oy+dy*mid,oz+dz*mid,size);
          if(smoothUnion(mid-current,sd,blend)<=0)low=mid;else high=mid;
        }
        low=(low+high)*.5;
      }
      const next=Math.min(maxLog[i],Math.log(Math.max(current,low)/BALL_RADIUS));
      if(next<=old[i]+1e-8)continue;
      if(marks[i]!==stamp){marks[i]=stamp;proposal[i]=next;changed.push(i);}else proposal[i]=Math.max(proposal[i],next);
    }
  }
  const count=commitProtectedProposal(mesh,changed,stamp,'grow');
  if(count)for(const i of changed){
    const tint=1-Math.exp(-Math.max(0,old[i]-before[i])*9),j=i*3;
    for(let k=0;k<3;k++)mesh.colors[j+k]+=(color[k]-mesh.colors[j+k])*tint;
  }
  return count;
}
