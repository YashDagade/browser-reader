import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createReaderServer} from '../server/server.mjs';
const headers={'X-Reader-Client':'browser-reader-v1','Content-Type':'application/json','Connection':'close'};
async function fixture(t,options={}){
 const server=createReaderServer({...options,port:43129});await new Promise(r=>server.listen(43129,'127.0.0.1',r));
 t.after(()=>new Promise(r=>server.close(r)));return (route,opts={})=>fetch('http://127.0.0.1:43129'+route,{...opts,headers:{...headers,...opts.headers}});
}
test('health reveals only configuration, refuses website origins and DNS-rebound hosts',async t=>{
 const request=await fixture(t,{key:'test-key'});
 const health=await (await request('/health')).json();assert.equal(health.configured,true);assert.ok(!JSON.stringify(health).includes('test-key'));
 assert.equal((await request('/health',{headers:{Origin:'https://example.com'}})).status,403);
 const reboundStatus=await new Promise((resolve,reject)=>{const req=http.get('http://127.0.0.1:43129/health',{headers:{...headers,Host:'attacker.test:43129'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
 assert.equal(reboundStatus,403);
 assert.equal((await request('/health',{headers:{'X-Reader-Client':''}})).status,403);
});
test('missing credential gives actionable error without contacting upstream',async t=>{
 const request=await fixture(t,{key:'',fetchImpl:()=>{throw Error('must not call')}});
 const result=await request('/v1/speech',{method:'POST',body:JSON.stringify({text:'Test.'})});assert.equal(result.status,503);assert.match((await result.json()).error,/On-device/);
});
test('speech validates input and reuses audio while speed is applied locally',async t=>{
 let count=0,payload;
 const request=await fixture(t,{key:'test-key',fetchImpl:async(url,options)=>{count++;payload=JSON.parse(options.body);assert.equal(url,'https://api.openai.com/v1/audio/speech');return new Response(Buffer.from('RIFF-test-audio'),{status:200});}});
 const speak=body=>request('/v1/speech',{method:'POST',body:JSON.stringify(body)});
 assert.equal((await speak({text:'x',model:'tts-1',voice:'marin'})).status,400);
 assert.equal((await speak({text:'x'.repeat(4097)})).status,400);
 const response=await speak({text:'Polygenic prediction and Mendelian risk.',model:'gpt-4o-mini-tts',voice:'coral'});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/wav');await response.arrayBuffer();
 const cached=await speak({text:'Polygenic prediction and Mendelian risk.',model:'gpt-4o-mini-tts',voice:'coral',speed:4});await cached.arrayBuffer();assert.equal(cached.headers.get('x-reader-cache'),'hit');assert.equal(count,1);assert.equal(payload.speed,1);assert.match(payload.instructions,/jargon/);
});
test('upstream errors are sanitized',async t=>{
 const request=await fixture(t,{key:'test-secret',fetchImpl:async()=>new Response(JSON.stringify({error:'test-secret upstream'}),{status:401})});
 const response=await request('/v1/speech',{method:'POST',body:JSON.stringify({text:'Hello.'})});assert.equal(response.status,401);assert.doesNotMatch(await response.text(),/test-secret/);
});
test('custom guidance affects expressive speech and its cache, and is bounded',async t=>{
 const payloads=[];
 const request=await fixture(t,{key:'test-key',fetchImpl:async(url,options)=>{payloads.push(JSON.parse(options.body));return new Response('RIFF-audio');}});
 const speak=body=>request('/v1/speech',{method:'POST',body:JSON.stringify(body)});
 const first=await speak({text:'A quantum field.',instructions:'This is physics.'});await first.arrayBuffer();
 const same=await speak({text:'A quantum field.',instructions:'This is physics.'});await same.arrayBuffer();assert.equal(same.headers.get('x-reader-cache'),'hit');
 const changed=await speak({text:'A quantum field.',instructions:'Emphasize Greek letters.'});await changed.arrayBuffer();
 assert.equal(payloads.length,2);assert.match(payloads[0].instructions,/verbatim/);assert.match(payloads[0].instructions,/This is physics/);
 assert.equal((await speak({text:'A quantum field.',instructions:'x'.repeat(1001)})).status,400);
 await (await speak({text:'Legacy.',model:'tts-1',instructions:'First.'})).arrayBuffer();
 await (await speak({text:'Legacy.',model:'tts-1',instructions:'Second.'})).arrayBuffer();
 assert.equal(payloads.length,3);assert.equal(payloads[2].instructions,undefined);
});
test('alignment uses cached audio without generating speech twice and caches safe word timestamps',async t=>{
 let speechCalls=0,alignCalls=0;
 const request=await fixture(t,{key:'test-key',fetchImpl:async(url,options)=>{
  if(url.endsWith('/speech')){speechCalls++;return new Response('RIFF-original');}
  alignCalls++;assert.equal(options.body.get('model'),'whisper-1');assert.equal(options.body.get('timestamp_granularities[]'),'word');
  assert.equal(await options.body.get('file').text(),'RIFF-original');
  assert.equal(options.headers['Content-Type'],undefined);
  return Response.json({words:[{word:'Quantum',start:0,end:.5,private:'discarded'},{word:'bad',start:-1,end:0},{word:'fields',start:.6,end:1.1}]});
 }});
 const body=JSON.stringify({text:'Quantum fields',instructions:'Physics.'});
 const align=()=>request('/v1/align',{method:'POST',body});
 assert.equal((await align()).status,404);assert.equal(speechCalls,0);
 await (await request('/v1/speech',{method:'POST',body})).arrayBuffer();
 assert.deepEqual(await (await align()).json(),{words:[{word:'Quantum',start:0,end:.5},{word:'fields',start:.6,end:1.1}]});
 await (await align()).json();assert.equal(speechCalls,1);assert.equal(alignCalls,1);
 assert.equal((await request('/v1/align',{method:'POST',body,headers:{Origin:'https://evil.example'}})).status,403);
});
test('audio cache expires after ten minutes and does not fetch speech for expired alignment',async t=>{
 let clock=0,calls=0;
 const request=await fixture(t,{key:'test-key',now:()=>clock,fetchImpl:async()=>{calls++;return new Response('RIFF-audio');}});
 const body=JSON.stringify({text:'Short passage.'});
 await (await request('/v1/speech',{method:'POST',body})).arrayBuffer();clock=600001;
 assert.equal((await request('/v1/align',{method:'POST',body})).status,404);assert.equal(calls,1);
 await (await request('/v1/speech',{method:'POST',body})).arrayBuffer();assert.equal(calls,2);
});
test('large upstream responses and alignment errors are bounded and sanitized',async t=>{
 let mode='oversized';
 const request=await fixture(t,{key:'hidden-test-key',fetchImpl:async url=>{
  if(mode==='oversized')return new Response('small',{headers:{'content-length':String(17*1024*1024)}});
  if(url.endsWith('/speech'))return new Response('RIFF-audio');
  return Response.json({error:'hidden-test-key'},{status:401});
 }});
 const body=JSON.stringify({text:'Bounded passage.'});
 const large=await request('/v1/speech',{method:'POST',body});assert.equal(large.status,502);assert.doesNotMatch(await large.text(),/hidden-test-key/);
 mode='align-error';await(await request('/v1/speech',{method:'POST',body})).arrayBuffer();
 const alignment=await request('/v1/align',{method:'POST',body});assert.equal(alignment.status,401);assert.doesNotMatch(await alignment.text(),/hidden-test-key/);
});
test('configured extension allowlist also protects transcription route',async t=>{
 const request=await fixture(t,{key:'test-key',allowedExtensionIds:['a'.repeat(32)]});
 const body=JSON.stringify({text:'Hello'});
 assert.equal((await request('/v1/align',{method:'POST',body,headers:{Origin:'chrome-extension://'+'b'.repeat(32)}})).status,403);
 assert.equal((await request('/health',{headers:{Origin:'chrome-extension://'+'a'.repeat(32)}})).status,200);
});
