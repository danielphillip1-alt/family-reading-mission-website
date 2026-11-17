import {createHash} from 'node:crypto';
import {createWriteStream,createReadStream} from 'node:fs';
import {mkdtemp,rename,stat,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {finished,pipeline} from 'node:stream/promises';

// Archives remain on the server's PRIVATE ephemeral disk, never in its
// public static directory. A hash of edition identities invalidates stale ZIPs.
const directory=mkdtemp(join(tmpdir(),'aom-private-books-'));
const pending=new Map();

export async function privateZipFile(signature,expectedSize,writeArchive){
 if(!Number.isSafeInteger(expectedSize)||expectedSize<22)throw Error('Invalid archive length');
 const id=createHash('sha256').update(signature).digest('hex');
 const key=id+'.zip';
 if(pending.has(key))return pending.get(key);
 const promise=(async()=>{
  const dir=await directory;
  const filename=join(dir,key),temp=join(dir,key+'.part');
  try{
   const old=await stat(filename).catch(()=>null);
   if(old?.size===expectedSize)return filename;
   await unlink(temp).catch(()=>{});
   const stream=createWriteStream(temp,{flags:'wx',mode:0o600});
   try{await writeArchive(stream);await finished(stream);}
   catch(error){stream.destroy();throw error;}
   const actual=await stat(temp);
   if(actual.size!==expectedSize)throw Error('Incomplete prepared book archive');
   await rename(temp,filename);
   return filename;
  }catch(error){await unlink(temp).catch(()=>{});throw error;}
 })();
 pending.set(key,promise);
 try{return await promise;}
 finally{pending.delete(key);}
}

// Non-blocking lookup: returns the prepared archive path only when it is complete.
export async function cachedZipFile(signature,expectedSize){
 const key=createHash('sha256').update(signature).digest('hex')+'.zip';
 if(pending.has(key))return null;
 const filename=join(await directory,key);
 const found=await stat(filename).catch(()=>null);
 return found?.size===expectedSize?filename:null;
}

export const streamCachedZip=async(filename,response)=>pipeline(createReadStream(filename),response);
