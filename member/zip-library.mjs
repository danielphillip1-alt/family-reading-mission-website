// Stream a ZIP of exactly the caller-authorized PDFs; no public file access.
// ZIP store method with data descriptors keeps memory bounded to one PDF chunk.
const bookNames={
 'zachary-my-unique-hat-2026-11':'01_Zachary_Book_1_My_Unique_Hat',
 'zachary-school-that-believed-in-him':'02_Zachary_Book_2_The_School_That_Believed',
 'zachary-school-that-made-room':'03_Zachary_Book_3_The_School_That_Made_Room',
 'zachary-biggest-lesson-yet':'04_Zachary_Book_4_The_Biggest_Lesson_Yet',
 'zachary-foundation-of-something-great':'05_Zachary_Book_5_The_Foundation_Of_Something_Great',
 'zachary-night-everyone-belonged':'06_Zachary_Book_6_The_Night_Everyone_Belonged',
 'emir-boy-who-never-smiles':'01_Emir_Book_1_The_Boy_Who_Never_Smiles',
 'emir-barbershop-boys-and-salon-girls':'02_Emir_Book_2_Barbershop_And_Salon',
 'emir-meets-zachary':'03_Emir_Book_3_Meets_Zachary'
};
export const bookZipOrder=slug=>{
 const match=bookNames[slug];
 return match?Number(match.slice(0,2))+(slug.startsWith('emir-')?100:0):900;
};
export const bookZipName=(slug,language)=>{
 const root=slug.startsWith('emir-')?'02_Emir_Series':'01_Zachary_Series';
 const name=bookNames[slug]||'99_'+slug;
 return root+'/'+name+'_'+language+'.pdf';
};
export function bookZipByteLength(books,language){
 return 22+books.reduce((sum,book)=>{
  const n=Buffer.byteLength(bookZipName(book.slug,language),'utf8');
  return sum+30+n+Number(book.size)+16+46+n;
 },0);
};
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
// Wait for the client to accept more bytes, but stop at once if the phone
// disconnects so an abandoned download never holds a database reader open.
async function push(res,bytes){
 if(res.destroyed)throw Error('Download was closed');
 if(res.write(bytes))return;
 await new Promise((resolve,reject)=>{
  const finish=error=>{res.off('drain',drained);res.off('close',closed);error?reject(error):resolve();};
  const drained=()=>finish();
  const closed=()=>finish(Error('Download was closed'));
  res.on('drain',drained);res.on('close',closed);
 });
}
export async function streamBookZip({res,language,books,readChunks}){
 if(!Array.isArray(books)||!books.length||books.length>200)throw Error('Invalid book list');
 const combined=books.reduce((sum,x)=>sum+Number(x.size),0);
 if(!Number.isSafeInteger(combined)||combined>=0xffffffff)throw Error('Archive is too large');
 let position=0;
 const directories=[];
 for(const book of books){
  const name=bookZipName(book.slug,language);
  if(!/^[a-z0-9_./-]+\.pdf$/i.test(name)||name.includes('..'))throw Error('Invalid archive entry');
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
