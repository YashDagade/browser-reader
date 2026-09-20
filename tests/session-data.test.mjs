import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=await fs.readFile(new URL('../extension/session-data.js',import.meta.url),'utf8');
function harness(local={},session={}) {
 const clone=value=>JSON.parse(JSON.stringify(value));
 const levels=[];
 const area=(values,name)=>({get:async keys=>clone(Object.fromEntries([].concat(keys).map(k=>[k,values[k]]))),set:async values2=>Object.assign(values,clone(values2)),remove:async keys=>{for(const k of [].concat(keys))delete values[k];},setAccessLevel:async value=>levels.push([name,value.accessLevel])});
 const context=vm.createContext({chrome:{storage:{local:area(local,'local'),session:area(session,'session')}},crypto:webcrypto,Uint8Array});
 vm.runInContext(source,context);
 return {api:context.HermesSession,local,session,levels};
}
test('migration removes durable plaintext and does not infer user consent',async()=>{
 const app=harness({hermesConnection:{mode:'direct',apiKey:'old-private-value'},settings:{voice:'nova',instructions:'Private topic'}});
 const connection=await app.api.connection();
 assert.equal(connection.apiKey,'old-private-value');assert.equal(connection.consent,false);
 assert.deepEqual(app.local,{hermesConnection:{mode:'direct',consent:false},settings:{voice:'nova'}});
 assert.equal(app.session.hermesApiKey,'old-private-value');assert.equal(app.session.hermesInstructions,'Private topic');
 assert.deepEqual(app.levels,[['local','TRUSTED_CONTEXTS'],['session','TRUSTED_CONTEXTS']]);
});
test('private values survive a worker restart but not a browser restart',async()=>{
 const app=harness();const key='sk-'+'x'.repeat(32);
 await app.api.saveConnection({mode:'direct',apiKey:key,consent:true});
 await app.api.savePreferences({voice:'nova',instructions:'Private topic'});
 const cipher=await app.api.audioCipher();assert.equal(cipher.key.length,32);
 const restarted=harness(app.local,app.session);
 assert.equal((await restarted.api.connection()).apiKey,key);
 assert.equal((await restarted.api.preferences()).instructions,'Private topic');
 assert.equal((await restarted.api.audioCipher()).id,cipher.id);
 const fresh=harness(app.local,{});
 assert.equal((await fresh.api.connection()).apiKey,'');assert.equal((await fresh.api.preferences()).instructions,'');
 assert.notEqual((await fresh.api.audioCipher()).id,cipher.id);
 assert.doesNotMatch(JSON.stringify(app.local),/Private topic|sk-|hermesAudioCipher/);
});
test('save requires affirmative consent and disconnect withdraws it for either mode',async()=>{
 const app=harness();
 await assert.rejects(app.api.saveConnection({mode:'local'}),/disclosure/);
 assert.deepEqual(app.local,{});
 await app.api.saveConnection({mode:'local',apiKey:'must-not-be-copied',consent:true});
 assert.equal(app.session.hermesApiKey,undefined);
 const result=await app.api.forgetConnection();assert.equal(result.consent,false);assert.equal(result.apiKey,'');
});
test('concurrent cache clients share one random session key',async()=>{
 const app=harness();const [a,b]=await Promise.all([app.api.audioCipher(),app.api.audioCipher()]);
 assert.deepEqual(a,b);assert.equal(a.key.length,32);assert.ok(a.key.every(n=>Number.isInteger(n)&&n>=0&&n<=255));
 assert.equal(Object.keys(app.local).length,0);
});

test('new installs default to direct OpenAI while legacy voice settings migrate without granting consent',async()=>{
 const fresh=harness();
 assert.equal((await fresh.api.connection()).mode,'direct');
 assert.equal((await fresh.api.connection()).consent,false);
 assert.equal((await fresh.api.preferences()).model,'gpt-4o-mini-tts');
 const legacy=harness({hermesConnection:{mode:'local'},settings:{model:'local',voice:'nova',speed:4}});
 const prefs=await legacy.api.preferences();
 assert.equal(prefs.model,'gpt-4o-mini-tts');assert.equal(prefs.voice,'nova');assert.equal(prefs.speed,4);
 assert.equal((await legacy.api.connection()).mode,'local');
 assert.equal((await legacy.api.connection()).consent,false);
});
