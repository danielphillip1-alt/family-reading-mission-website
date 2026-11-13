import tls from 'node:tls';
import {randomBytes} from 'node:crypto';
export function mailConfigured(){
 return Boolean((process.env.AOM_RESEND_API_KEY&&process.env.AOM_FROM_EMAIL)||process.env.AOM_GMAIL_APP_PASSWORD);
}
function safeEmail(x){
 const v=String(x||'').trim();
 if(!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(v))throw Error('Bad email address');
 return v;
}
function base64(value){
 const s=Buffer.isBuffer(value)?value.toString('base64'):String(value);
 return s.match(/.{1,76}/g)?.join('\r\n')||'';
}
async function gmailSend(message,id){
 const user=safeEmail(process.env.AOM_SMTP_USER||'brathatfashionhouse@gmail.com');
 const recipient=safeEmail(message.email), password=process.env.AOM_GMAIL_APP_PASSWORD;
 if(!password)throw Error('Gmail app password missing');
 const boundary='aom-'+randomBytes(12).toString('hex');
 const subject='=?UTF-8?B?'+Buffer.from(String(message.subject).replace(/[\r\n]/g,' ')).toString('base64')+'?=';
 const lines=[
  'From: Authors On A Mission <'+user+'>','To: <'+recipient+'>','Subject: '+subject,
  'MIME-Version: 1.0','Content-Type: multipart/mixed; boundary="'+boundary+'"','',
  '--'+boundary,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',
  base64(Buffer.from(message.html||''))];
 for(const attachment of message.attachments||[]){
  const name=String(attachment.filename||'book.pdf').replace(/[\r\n"\\]/g,'_');
  lines.push('--'+boundary,'Content-Type: application/pdf; name="'+name+'"',
   'Content-Transfer-Encoding: base64','Content-Disposition: attachment; filename="'+name+'"','',
   base64(attachment.content));
 }
 lines.push('--'+boundary+'--','');
 const mime=lines.join('\r\n').replace(/\r\n\./g,'\r\n..');
 if(Buffer.byteLength(mime)>24*1024*1024)throw Error('Gmail message too large');
 const socket=tls.connect({host:'smtp.gmail.com',port:465,servername:'smtp.gmail.com',rejectUnauthorized:true});
 socket.setEncoding('utf8');socket.setTimeout(30000,()=>socket.destroy(Error('Gmail timeout')));
 let buffer='',pending=[],received=[],closed=false;
 socket.on('data',chunk=>{
  buffer+=chunk;
  for(let index;(index=buffer.indexOf('\n'))!==-1;){
   const line=buffer.slice(0,index).replace(/\r$/,'');buffer=buffer.slice(index+1);
   if(!/^\d{3}[ -]/.test(line)||line[3]==='-')continue;
   const p=pending.shift();if(p)p.resolve(line);else received.push(line);
  }
 });
 socket.on('error',e=>{closed=true;for(const p of pending.splice(0))p.reject(e)});
 socket.on('close',()=>{closed=true;for(const p of pending.splice(0))p.reject(Error('Gmail connection closed'))});
 function next(){if(received.length)return Promise.resolve(received.shift());if(closed)return Promise.reject(Error('Gmail disconnected'));return new Promise((resolve,reject)=>pending.push({resolve,reject}));}
 async function cmd(input,expected){
  const result=next();socket.write(input+'\r\n');const reply=await result;
  if(!reply.startsWith(String(expected)))throw Error('Gmail SMTP '+reply.slice(0,3));
 }
 try {
  await new Promise((resolve,reject)=>{socket.once('secureConnect',resolve);socket.once('error',reject)});
  if(!(await next()).startsWith('220'))throw Error('Gmail greeting failed');
  await cmd('EHLO theauthorsmission.de',250);
  await cmd('AUTH LOGIN',334);
  await cmd(Buffer.from(user).toString('base64'),334);
  await cmd(Buffer.from(password.replace(/\s+/g,'')).toString('base64'),235);
  await cmd('MAIL FROM:<'+user+'>',250);
  await cmd('RCPT TO:<'+recipient+'>',250);
  await cmd('DATA',354);
  await cmd(mime+'\r\n.',250);
  await cmd('QUIT',221);
 } finally {socket.end();}
 return {id:'smtp-'+id};
}
export async function sendTransactionalMail(message,id){
 if(process.env.AOM_RESEND_API_KEY&&process.env.AOM_FROM_EMAIL){
  const resp=await fetch('https://api.resend.com/emails',{
   method:'POST',
   headers:{Authorization:'Bearer '+process.env.AOM_RESEND_API_KEY,
    'Content-Type':'application/json','Idempotency-Key':id},
   body:JSON.stringify({from:process.env.AOM_FROM_EMAIL,to:[safeEmail(message.email)],
    subject:message.subject,html:message.html,attachments:message.attachments})
  });
  if(!resp.ok)throw Error('Email provider '+resp.status);
  return resp.json();
 }
 return gmailSend(message,id);
}
