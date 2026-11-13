import { createHmac, createHash } from 'node:crypto';
const hmac=(k,v)=>createHmac('sha256',k).update(v).digest();
const hash=(s)=>createHash('sha256').update(s).digest('hex');
const enc=(v)=>encodeURIComponent(v).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
/**
 * Presign an HTTPS GET for S3-compatible PRIVATE bucket using AWS Signature V4.
 * Never place access keys in a client-side context. Keep this code server-side.
 */
export function signBookDownload({endpoint,region='auto',bucket,key,accessKeyId,secretAccessKey,seconds=120,now=new Date()}){
  if(!endpoint||!bucket||!key||!accessKeyId||!secretAccessKey)throw Error('S3 private storage not configured');
  if(!Number.isInteger(seconds)||seconds<1||seconds>900)throw Error('Invalid expiry');
  if(!/^[a-z0-9][a-z0-9._-]+$/i.test(bucket)||!key.startsWith('books/')||key.includes('..')||key.includes('\\'))throw Error('Invalid storage key');
  const base=new URL(endpoint);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('HTTPS endpoint required');
  const host=base.host.toLowerCase();
  const uri='/'+[bucket,...key.split('/')].map(enc).join('/');
  const date=now.toISOString().replace(/[-:]|\.\d{3}/g,'');
  const day=date.slice(0,8);
  const scope=`${day}/${region}/s3/aws4_request`;
  const kv=[
    ['X-Amz-Algorithm','AWS4-HMAC-SHA256'],
    ['X-Amz-Credential',`${accessKeyId}/${scope}`],
    ['X-Amz-Date',date],
    ['X-Amz-Expires',String(seconds)],
    ['X-Amz-SignedHeaders','host']
  ];
  const query=kv.map(([k,v])=>enc(k)+'='+enc(v)).sort().join('&');
  const canonical=['GET',uri,query,`host:${host}\n`,'host','UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign=['AWS4-HMAC-SHA256',date,scope,hash(canonical)].join('\n');
  const kDate=hmac('AWS4'+secretAccessKey,day);
  const kRegion=hmac(kDate,region);
  const kService=hmac(kRegion,'s3');
  const kSigning=hmac(kService,'aws4_request');
  const signature=createHmac('sha256',kSigning).update(stringToSign).digest('hex');
  return base.origin+uri+'?'+query+'&X-Amz-Signature='+signature;
}
