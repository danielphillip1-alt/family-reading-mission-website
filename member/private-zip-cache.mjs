import {createHash} from 'node:crypto';
import {createWriteStream,createReadStream} from 'node:fs';
import {mkdtemp,rename,stat,unlink,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {finished,pipeline} from 'node:stream/promises';

// Archives remain on the server's PRIVATE ephemeral disk, never in its
// public static directory. A hash of edition identities invalidates stale ZIPs.
// The instance's temporary storage is limited, so the cache is capped (least
// recently used archives are removed first) and only one archive is built at
// a time; anything not cached streams byte-identically from the database.
export const CACHE_LIMIT=Number(process.env.AOM_ZIP_CACHE_BYTES)||400*1024*1024;
const PREFIX='aom-private-books-';
const directory=(async()=>{
 for(const name of await readdir(tmpdir()).catch(()=>[]))
  if(name.startsWith(PREFIX))await rm(join(tmpdir(),name),{recursive:true,force:true}).catch(()=>{});
 return mkdtemp(join(tmpdir(),PREFIX));
})();
const pending=new Map();
const files=new Map(); // key -> {size,used}
let queue=Promise.resolve();
const used=()=>[...files.values()].reduce((sum,f)=>sum+f.size,0);
async function makeRoom(dir,size){
 const victims=[...files.entries()].sort((a,b)=>a[1].used-b[1].used);
 while(used()+size>CACHE_LIMIT&&victims.length){
  const [key]=victims.shift();files.delete(key);
  await unlink(join(dir,key)).catch(()=>{});
 }
 return used()+size<=CACHE_LIMIT;
}
export async function privateZipFile(signature,expectedSize,writeArchive){
 if(!Number.isSafeInteger(expectedSize)||expectedSize<22)throw Error('Invalid archive length');
 const key=createHash('sha256').update(signature).digest('hex')+'.zip';
 if(pending.has(key))return pending.get(key);
 const promise=(queue=queue.catch(()=>{}).then(async()=>{
  const dir=await directory;
  const filename=join(dir,key),temp=join(dir,key+'.part');
  const old=await stat(filename).catch(()=>null);
  if(old?.size===expectedSize){files.set(key,{size:old.size,used:Date.now()});return filename;}
  if(!await makeRoom(dir,expectedSize))return null;
  try{
   await unlink(temp).catch(()=>{});
   const stream=createWriteStream(temp,{flags:'wx',mode:0o600});
   try{await writeArchive(stream);await finished(stream);}
   catch(error){stream.destroy();throw error;}
   const actual=await stat(temp);
   if(actual.size!==expectedSize)throw Error('Incomplete prepared book archive');
   await rename(temp,filename);
   files.set(key,{size:actual.size,used:Date.now()});
   return filename;
  }catch(error){await unlink(temp).catch(()=>{});throw error;}
 }));
 pending.set(key,promise);
 try{return await promise;}
 finally{pending.delete(key);}
}

// Non-blocking lookup: returns the prepared archive path only when it is complete.
export async function cachedZipFile(signature,expectedSize){
 const key=createHash('sha256').update(signature).digest('hex')+'.zip';
 if(pending.has(key))return null;
 const entry=files.get(key);
 if(!entry||entry.size!==expectedSize)return null;
 const filename=join(await directory,key);
 const found=await stat(filename).catch(()=>null);
 if(found?.size!==expectedSize){files.delete(key);return null;}
 entry.used=Date.now();
 return filename;
}

export const streamCachedZip=async(filename,response)=>pipeline(createReadStream(filename),response);
