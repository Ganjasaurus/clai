let connection;
function database(){
  if(connection)return connection;
  connection=new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(new Error('Device storage is unavailable.'));return;}
    const request=indexedDB.open('clai-studio',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('creations',{keyPath:'id'});
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();connection=null;};resolve(db);};
    request.onerror=()=>{connection=null;reject(request.error);};
    request.onblocked=()=>{connection=null;reject(new Error('Close other clai tabs to open your shelf.'));};
  });
  return connection;
}
async function run(mode,action){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('creations',mode),request=action(tx.objectStore('creations'));let result;request.onsuccess=()=>result=request.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Saving was interrupted.'));});}
export const readCreation=id=>run('readonly',s=>s.get(id));
export const writeCreation=record=>run('readwrite',s=>s.put(record));
export const deleteCreation=id=>run('readwrite',s=>s.delete(id));
export const listCreations=async()=>((await run('readonly',s=>s.getAll()))||[]).filter(s=>s.id!=='current').sort((a,b)=>b.updated-a.updated);
