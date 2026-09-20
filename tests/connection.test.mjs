import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const source=await fs.readFile(new URL('../extension/speech-client.js',import.meta.url),'utf8');
const optionsSource=await fs.readFile(new URL('../extension/options.js',import.meta.url),'utf8');
const optionsHTML=await fs.readFile(new URL('../extension/options.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function client({connection={mode:'local'},permission=true,offscreen=false,fetchImpl=()=>{throw Error('Unexpected fetch')}}={}){
 const calls=[];
 const chrome={runtime:{sendMessage:async message=>{calls.push(message);return {connection,permission};}},permissions:{contains:async()=>permission}};
 if(!offscreen)chrome.storage={local:{get:async()=>({hermesConnection:connection})}};
 const context=vm.createContext({chrome,fetch:fetchImpl,Response,Blob,FormData,TextDecoder,Uint8Array,ArrayBuffer,AbortSignal,DOMException});
 vm.runInContext(source,context);return {api:context.HermesSpeech,calls};
}
test('local is the default and health never returns a credential',async()=>{
 const {api}=client({fetchImpl:async(url,options)=>{assert.equal(url,'http://127.0.0.1:43123/health');assert.equal(options.headers['X-Reader-Client'],'browser-reader-v1');return Response.json({configured:true,running:true,apiKey:'must-not-pass-through'});}});
 assert.deepEqual(JSON.parse(JSON.stringify(await api.health())),{configured:true,running:true,mode:'local'});
});
test('direct speech keeps credentials in authorization and uses bounded custom instructions',async()=>{
 let body,headers;
 const secret='development-only-token';
 const {api}=client({connection:{mode:'direct',apiKey:secret},fetchImpl:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/audio/speech');body=JSON.parse(options.body);headers=options.headers;return new Response('RIFF-speech');}});
 const response=await api.speech({text:'A bio article.',voice:'alloy',model:'gpt-4o-mini-tts',instructions:'Focus on gene names.'});
 assert.equal(await response.text(),'RIFF-speech');assert.equal(headers.Authorization,'Bearer '+secret);assert.match(body.instructions,/verbatim/);assert.match(body.instructions,/Focus on gene names/);assert.equal(body.speed,1);assert.doesNotMatch(JSON.stringify(body),/development-only-token/);
 const health=await api.health();assert.equal(health.mode,'direct');assert.equal(health.configured,true);assert.doesNotMatch(JSON.stringify(health),/development-only-token/);
});
test('direct mode refuses requests without optional host permission and sanitizes upstream failures',async()=>{
 const blocked=client({connection:{mode:'direct',apiKey:'private-value'},permission:false});
 await assert.rejects(blocked.api.speech({text:'Hello',model:'gpt-4o-mini-tts'}),/Allow OpenAI access/);
 const {api}=client({connection:{mode:'direct',apiKey:'private-value'},fetchImpl:async()=>new Response('private-value echoed by upstream',{status:401})});
 await assert.rejects(api.speech({text:'Hello',model:'gpt-4o-mini-tts'}),error=>/rejected the API key/.test(error.message)&&!error.message.includes('private-value'));
});
test('offscreen obtains config through trusted runtime route instead of unavailable storage APIs',async()=>{
 const {api,calls}=client({offscreen:true,connection:{mode:'direct',apiKey:'private-value'},fetchImpl:async()=>new Response('RIFF-speech')});
 await api.speech({text:'Hello',voice:'nova',model:'tts-1'});
 assert.equal(calls.length,1);assert.equal(calls[0].target,'background');assert.equal(calls[0].type,'connection-internal');
});
test('direct alignment posts only generated audio and filters timestamp results',async()=>{
 const {api}=client({connection:{mode:'direct',apiKey:'private-value'},fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');assert.equal(options.body.get('model'),'whisper-1');assert.equal(options.body.get('timestamp_granularities[]'),'word');assert.equal(options.headers['Content-Type'],undefined);assert.equal(await options.body.get('file').text(),'RIFF-audio');
  return Response.json({words:[{word:'bio',start:0,end:.4,other:'discard'},{word:'wrong',start:2,end:1}]});
 }});
 const result=await api.align({text:'bio',voice:'alloy',model:'gpt-4o-mini-tts'},new TextEncoder().encode('RIFF-audio').buffer);
 assert.equal(JSON.stringify(result),JSON.stringify({words:[{word:'bio',start:0,end:.4}]}));
});
test('direct speech rejects oversized upstream audio before buffering it',async()=>{
 const {api}=client({connection:{mode:'direct',apiKey:'private-value'},fetchImpl:async()=>new Response('audio',{headers:{'content-length':String(20*1024*1024)}})});
 await assert.rejects(api.speech({text:'Hello',model:'tts-1'}),/too large/);
});
async function setupOptions(connection={mode:'local'}){
 const dom=new JSDOM(optionsHTML,{url:'https://extension.example/options.html',runScripts:'outside-only'});
 const stored={settings:{},hermesConnection:connection};let granted=true,requests=0;
 dom.window.chrome={storage:{local:{get:async()=>stored,set:async value=>Object.assign(stored,value)}},permissions:{request:async()=>{requests++;return granted;},remove:async()=>true}};
 dom.window.HermesSpeech={health:async()=>({configured:Boolean(stored.hermesConnection.apiKey),running:true,mode:stored.hermesConnection.mode})};
 let cacheEntries=2;
 dom.window.HermesAudioCache={stats:async()=>({available:true,bytes:cacheEntries*1048576,entries:cacheEntries}),clear:async()=>{cacheEntries=0;return true;}};
 dom.window.eval(optionsSource);await tick();
 return {dom,stored,deny:()=>{granted=false;},requests:()=>requests};
}
test('setup saves direct key only on deliberate Save and clears the password without rendering it',async()=>{
 const {dom,stored,requests}=await setupOptions();const doc=dom.window.document;
 const key='sk-'+'x'.repeat(32);
 doc.querySelector('#connection-mode').value='direct';doc.querySelector('#api-key').value=key;
 assert.equal(stored.hermesConnection.mode,'local');doc.querySelector('#save-connection').click();await tick();
 assert.equal(requests(),1);assert.equal(stored.hermesConnection.apiKey,key);assert.equal(stored.hermesConnection.mode,'direct');assert.equal(doc.querySelector('#api-key').value,'');assert.ok(!doc.body.textContent.includes(key));
 doc.querySelector('#forget').click();await tick();assert.equal(stored.hermesConnection.apiKey,undefined);assert.ok(!doc.body.textContent.includes(key));dom.window.close();
});
test('denied direct permission leaves stored local connection unchanged',async()=>{
 const {dom,stored,deny}=await setupOptions();const doc=dom.window.document;deny();
 doc.querySelector('#connection-mode').value='direct';doc.querySelector('#api-key').value='sk-'+'x'.repeat(32);doc.querySelector('#save-connection').click();await tick();
 assert.equal(stored.hermesConnection.mode,'local');assert.equal(stored.hermesConnection.apiKey,undefined);assert.match(doc.querySelector('#connection-saved').textContent,/not granted/);dom.window.close();
});
test('saving local helper mode never copies a newly entered key into Chrome',async()=>{
 const {dom,stored,requests}=await setupOptions();const doc=dom.window.document;
 doc.querySelector('#api-key').value='sk-'+'x'.repeat(32);doc.querySelector('#save-connection').click();await tick();
 assert.equal(requests(),0);assert.equal(stored.hermesConnection.mode,'local');assert.equal(stored.hermesConnection.apiKey,undefined);assert.equal(doc.querySelector('#api-key').value,'');dom.window.close();
});
test('clearing saved audio leaves connection and voice preferences untouched',async()=>{
 const {dom,stored}=await setupOptions({mode:'direct',apiKey:'development-only-token'});const doc=dom.window.document;
 const before=JSON.stringify(stored);
 assert.match(doc.querySelector('#cache-status').textContent,/2.0 MiB.*2 saved passages/);
 doc.querySelector('#clear-cache').click();await tick();
 assert.match(doc.querySelector('#cache-status').textContent,/0.0 MiB.*0 saved passages/);
 assert.match(doc.querySelector('#cache-result').textContent,/Saved audio cleared/);
 assert.equal(JSON.stringify(stored),before);dom.window.close();
});
