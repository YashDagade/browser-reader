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
