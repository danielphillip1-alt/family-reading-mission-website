import {once} from 'node:events';
// Stream a ZIP of exactly the caller-authorized PDFs; no public file access.
// ZIP store method with data descriptors keeps memory bounded to one PDF chunk.
const encode=name=>Buffer.from(name,'utf8');
const table=Uint32Array.from({length:256},(_,i)=>{
 let c=i;
 for(let b=0;b<8;b++)c=c&1?0xedb88320^(c>>>1):c>>>1;
 return c>>>0;
});
function checksum(state,bytes){
 let crc=state;
 for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);
 return crc>>>0;
}
async function push(res,bytes){
 if(res.destroyed)throw Error('Download was closed');
 if(!res.write(bytes))await once(res,'drain');
}
export async function streamBookZip({res,language,books,readChunks}){
 if(!Array.isArray(books)||!books.length||books.length>200)throw Error('Invalid book list');
 const combined=books.reduce((sum,x)=>sum+Number(x.size),0);
 if(!Number.isSafeInteger(combined)||combined>=0xffffffff)throw Error('Archive is too large');
 let position=0;
 const directories=[];
 for(const book of books){
  const name=book.slug+'-'+language+'.pdf';
  if(!/^[a-z0-9-]+\.pdf$/.test(name))throw Error('Invalid archive entry');
  const nameBytes=encode(name);
  const offset=position;
  const header=Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50,0);
  header.writeUInt16LE(20,4);
  header.writeUInt16LE(0x0008,6);
  header.writeUInt16LE(0,8);
  header.writeUInt16LE(nameBytes.length,26);
  await push(res,header);await push(res,nameBytes);
  position+=header.length+nameBytes.length;
  let crc=0xffffffff,size=0;
  for await(const chunk of readChunks(book)){
   if(!Buffer.isBuffer(chunk)||!chunk.length)throw Error('Missing archive bytes');
   crc=checksum(crc,chunk);
   size+=chunk.length;
   if(size>book.size)throw Error('Archive entry is oversized');
   await push(res,chunk);position+=chunk.length;
  }
  if(size!==book.size)throw Error('Archive PDF incomplete');
  crc=(crc^0xffffffff)>>>0;
  const descriptor=Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50,0);
  descriptor.writeUInt32LE(crc,4);
  descriptor.writeUInt32LE(size,8);
  descriptor.writeUInt32LE(size,12);
  await push(res,descriptor);position+=16;
  directories.push({nameBytes,crc,size,offset});
 }
 const centralOffset=position;
 for(const entry of directories){
  const record=Buffer.alloc(46);
  record.writeUInt32LE(0x02014b50,0);
  record.writeUInt16LE(20,4);
  record.writeUInt16LE(20,6);
  record.writeUInt16LE(0x0008,8);
  record.writeUInt32LE(entry.crc,16);
  record.writeUInt32LE(entry.size,20);
  record.writeUInt32LE(entry.size,24);
  record.writeUInt16LE(entry.nameBytes.length,28);
  record.writeUInt32LE(entry.offset,42);
  await push(res,record);await push(res,entry.nameBytes);
  position+=record.length+entry.nameBytes.length;
 }
 const centralSize=position-centralOffset;
 const end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);
 end.writeUInt16LE(directories.length,8);
 end.writeUInt16LE(directories.length,10);
 end.writeUInt32LE(centralSize,12);
 end.writeUInt32LE(centralOffset,16);
 await push(res,end);
 res.end();
}
