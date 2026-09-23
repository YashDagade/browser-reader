import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {webcrypto} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
const source=await fs.readFile(new URL('../extension/speech-client.js',import.meta.url),'utf8');
const optionsSource=await fs.readFile(new URL('../extension/options.js',import.meta.url),'utf8');
const optionsHTML=await fs.readFile(new URL('../extension/options.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function client({connection={mode:'local'},permission=true,offscreen=false,fetchImpl=()=>{throw Error('Unexpected fetch')}}={}){
 const calls=[];
 const chrome={runtime:{sendMessage:async message=>{calls.push(message);return {connection:{consent:true,...connection},permission};}},permissions:{contains:async()=>permission}};
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
async function setupOptions(connection={mode:'local'},indexedDB=new IDBFactory()){
 const dom=new JSDOM(optionsHTML,{url:'https://extension.example/options.html',runScripts:'outside-only'});
 const stored={settings:{},hermesConnection:connection},session={};let granted=true,requests=0;
 const area=data=>({setAccessLevel:async()=>{},get:async keys=>Object.fromEntries([].concat(keys).map(key=>[key,data[key]])),set:async values=>Object.assign(data,values),remove:async key=>{delete data[key];}});
 dom.window.chrome={storage:{local:area(stored),session:area(session)},permissions:{request:async()=>{requests++;return granted;},remove:async()=>true}};
 Object.defineProperty(dom.window,'crypto',{value:webcrypto});
 Object.assign(dom.window,{indexedDB,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer});
 dom.window.eval(await fs.readFile(new URL('../extension/credential-vault.js',import.meta.url),'utf8'));
 dom.window.eval(await fs.readFile(new URL('../extension/session-data.js',import.meta.url),'utf8'));
 const api=dom.window.HermesSession;
 dom.window.chrome.runtime={sendMessage:async message=>{
  try {
   if(message.type==='preferences')return {settings:await api.preferences()};
   if(message.type==='preferences-save'){await api.savePreferences({...await api.preferences(),...message.settings});return {ok:true};}
   if(message.type==='connection-manage'){
    const value=message.action==='save'?await api.saveConnection(message.connection):message.action==='forget'?await api.forgetConnection():await api.connection();
    return {connection:{mode:value.mode,consent:value.consent,hasKey:!!value.apiKey,rememberKey:value.rememberKey,keyError:value.keyError}};
   }
   throw Error('Unexpected route');
  }catch(error){return {error:error.message};}
 }};
 dom.window.HermesSpeech={health:async()=>({configured:Boolean(session.hermesApiKey),running:true,mode:stored.hermesConnection.mode})};
 let cacheEntries=2;
 dom.window.HermesAudioCache={stats:async()=>({available:true,bytes:cacheEntries*1048576,entries:cacheEntries}),clear:async()=>{cacheEntries=0;return true;}};
 dom.window.eval(optionsSource);await tick();
 return {dom,stored,session,api,indexedDB,deny:()=>{granted=false;},requests:()=>requests};
}
async function until(predicate) {
 for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}
 assert.fail('Timed out waiting for Options to settle.');
}
test('Options opt-in saves encrypted credentials, restores the checkbox on restart, and supports forgetting',async()=>{
 const app=await setupOptions(),doc=app.dom.window.document,key='sk-'+'o'.repeat(32);
 assert.equal(doc.querySelector('#remember-key').checked,false);
 doc.querySelector('#connection-mode').value='direct';doc.querySelector('#api-key').value=key;
 doc.querySelector('#remember-key').checked=true;doc.querySelector('#cloud-consent').checked=true;
 doc.querySelector('#save-connection').click();
 await until(()=>doc.querySelector('#connection-saved').textContent.includes('saved encrypted'));
 assert.equal(app.stored.hermesConnection.rememberKey,true);assert.equal(doc.querySelector('#api-key').value,'');
 assert.ok(!doc.body.textContent.includes(key));app.dom.window.close();
 const fresh=await setupOptions(app.stored.hermesConnection,app.indexedDB),page=fresh.dom.window.document;
 await until(()=>page.querySelector('#remember-key').checked);
 assert.equal(fresh.session.hermesApiKey,key);assert.equal(page.querySelector('#api-key').value,'');
 page.querySelector('#forget').click();
 await until(()=>page.querySelector('#connection-saved').textContent.includes('removed from memory and encrypted storage'));
 assert.equal(page.querySelector('#remember-key').checked,false);assert.equal((await fresh.api.connection()).apiKey,'');
 fresh.dom.window.close();
});
test('Options reports encrypted storage failures without clearing the entered key or showing success',async()=>{
 const app=await setupOptions({}, {open:()=>{throw Error('Unavailable');}}),doc=app.dom.window.document;
 doc.querySelector('#api-key').value='sk-'+'f'.repeat(32);doc.querySelector('#cloud-consent').checked=true;doc.querySelector('#remember-key').checked=true;
 doc.querySelector('#save-connection').click();
 await until(()=>!doc.querySelector('#save-connection').disabled);
 assert.match(doc.querySelector('#connection-saved').textContent,/Could not save the encrypted key/);
 assert.ok(doc.querySelector('#api-key').value);assert.equal(app.stored.hermesConnection.rememberKey,undefined);
 assert.equal(app.session.hermesApiKey,undefined);app.dom.window.close();
});
test('setup saves direct key only on deliberate Save and clears the password without rendering it',async()=>{
 const {dom,stored,session,requests}=await setupOptions();const doc=dom.window.document;
 const key='sk-'+'x'.repeat(32);
 doc.querySelector('#connection-mode').value='direct';doc.querySelector('#api-key').value=key;
 assert.equal(stored.hermesConnection.mode,'local');doc.querySelector('#cloud-consent').checked=true;doc.querySelector('#save-connection').click();await tick();
 assert.equal(requests(),1);assert.equal(session.hermesApiKey,key);assert.equal(stored.hermesConnection.apiKey,undefined);assert.equal(stored.hermesConnection.mode,'direct');assert.equal(doc.querySelector('#api-key').value,'');assert.ok(!doc.body.textContent.includes(key));
 doc.querySelector('#forget').click();await until(()=>!doc.querySelector('#forget').disabled);assert.equal(session.hermesApiKey,undefined);assert.equal(stored.hermesConnection.apiKey,undefined);assert.ok(!doc.body.textContent.includes(key));dom.window.close();
});
test('denied direct permission leaves stored local connection unchanged',async()=>{
 const {dom,stored,deny}=await setupOptions();const doc=dom.window.document;deny();
 doc.querySelector('#connection-mode').value='direct';doc.querySelector('#api-key').value='sk-'+'x'.repeat(32);doc.querySelector('#cloud-consent').checked=true;doc.querySelector('#save-connection').click();await tick();
 assert.equal(stored.hermesConnection.mode,'local');assert.equal(stored.hermesConnection.apiKey,undefined);assert.match(doc.querySelector('#connection-saved').textContent,/not granted/);dom.window.close();
});
test('saving local helper mode never copies a newly entered key into Chrome',async()=>{
 const {dom,stored,session,requests}=await setupOptions();const doc=dom.window.document;
 doc.querySelector('#api-key').value='sk-'+'x'.repeat(32);doc.querySelector('#cloud-consent').checked=true;doc.querySelector('#save-connection').click();await tick();
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
test('neither direct nor helper may transmit speech or alignment without consent',async()=>{
 for(const mode of ['direct','local']) {
  let requests=0;
  const {api}=client({connection:{mode,apiKey:'private-value',consent:false},fetchImpl:async()=>{requests++;throw Error('Should not send');}});
  await assert.rejects(api.speech({text:'Private content',model:'gpt-4o-mini-tts'}),/disclosure/);
  await assert.rejects(api.align({text:'Private content'},new ArrayBuffer(2)),/not been approved/);
  assert.equal(requests,0);
 }
});
test('setup requires an unchecked-by-default disclosure before asking for host access',async()=>{
 const {dom,stored,requests}=await setupOptions();const doc=dom.window.document;
 doc.querySelector('#connection-mode').value='direct';doc.querySelector('#api-key').value='sk-'+'x'.repeat(32);
 assert.equal(doc.querySelector('#cloud-consent').checked,false);
 doc.querySelector('#save-connection').click();await tick();
 assert.equal(requests(),0);assert.equal(stored.hermesConnection.mode,'local');
 assert.match(doc.querySelector('#connection-saved').textContent,/accept the OpenAI disclosure/);dom.window.close();
});
test('helper consent can be withdrawn even when Chrome has no API key',async()=>{
 const {dom,stored}=await setupOptions({mode:'local',consent:true});const doc=dom.window.document;
 assert.equal(doc.querySelector('#forget').hidden,false);
 doc.querySelector('#forget').click();await until(()=>!doc.querySelector('#forget').disabled);
 assert.equal(stored.hermesConnection.consent,false);assert.equal(doc.querySelector('#cloud-consent').checked,false);dom.window.close();
});

test('fresh Options show only API voices, direct setup, and a missing-key prompt',async()=>{
 const {dom}=await setupOptions({});const doc=dom.window.document;
 assert.equal(doc.querySelector('#connection-mode').value,'direct');
 assert.equal(doc.querySelector('#model').value,'gpt-4o-mini-tts');
 assert.ok(!Array.from(doc.querySelector('#model').options,o=>o.value).includes('local'));
 assert.match(doc.querySelector('#connection').textContent,/key|Connect OpenAI/);
 assert.doesNotMatch(doc.body.textContent,/on-device|browser voice/i);dom.window.close();
});

test('direct mode with no API key cannot fall back to another voice or make a request',async()=>{
 let requests=0;
 const {api}=client({connection:{mode:'direct',apiKey:''},fetchImpl:async()=>{requests++;throw Error('Unexpected request');}});
 assert.equal((await api.health()).configured,false);
 await assert.rejects(api.speech({text:'Hello',model:'gpt-4o-mini-tts'}),/Save an OpenAI API key/);
 assert.equal(requests,0);
});

test('both speech transports forward generation speed and reject invalid values before a paid request', async () => {
 for (const mode of ['direct', 'local']) {
  const bodies=[];
  const {api}=client({connection:{mode,apiKey:'test-only-value'},fetchImpl:async(_url,options)=>{bodies.push(JSON.parse(options.body));return new Response('RIFF-test');}});
  for (const model of ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']) await api.speech({text:'Sample.',model,voice:'alloy',generationSpeed:2.3,speed:4});
  assert.equal(bodies.length,3);
  for (const body of bodies) assert.equal(mode === 'direct' ? body.speed : body.generationSpeed,2.3);
  for (const generationSpeed of [0,8,NaN,Infinity,'2.3']) await assert.rejects(api.speech({text:'Sample.',generationSpeed}),/Narration speed/);
  assert.equal(bodies.length,3);
 }
});

test('Options persists the preferred narration speed and rejects invalid edits', async () => {
 const app=await setupOptions(),doc=app.dom.window.document;
 const input=doc.querySelector('#generation-speed');
 assert.equal(input.value,'2.3');
 input.value='3.25';input.dispatchEvent(new app.dom.window.Event('change'));
 await until(()=>app.stored.settings.generationSpeed===3.25);
 input.value='8';input.dispatchEvent(new app.dom.window.Event('change'));
 await tick();
 assert.equal(app.stored.settings.generationSpeed,3.25);
 assert.match(doc.querySelector('#saved').textContent,/0.75× to 4×/);
 app.dom.window.close();
});
