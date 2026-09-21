import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
const source=await fs.readFile(new URL('../extension/session-data.js',import.meta.url),'utf8');
const vaultSource=await fs.readFile(new URL('../extension/credential-vault.js',import.meta.url),'utf8');
function harness(local={},session={},indexedDB=new IDBFactory()) {
 const clone=value=>JSON.parse(JSON.stringify(value));
 const levels=[];
 const area=(values,name)=>({get:async keys=>clone(Object.fromEntries([].concat(keys).map(k=>[k,values[k]]))),set:async values2=>Object.assign(values,clone(values2)),remove:async keys=>{for(const k of [].concat(keys))delete values[k];},setAccessLevel:async value=>levels.push([name,value.accessLevel])});
 const context=vm.createContext({chrome:{storage:{local:area(local,'local'),session:area(session,'session')}},crypto:webcrypto,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,indexedDB});
 vm.runInContext(vaultSource+'\n'+source,context);
 return {api:context.HermesSession,vault:context.HermesCredentialVault,local,session,levels,indexedDB};
}
test('migration removes durable plaintext and does not infer user consent',async()=>{
 const app=harness({hermesConnection:{mode:'direct',apiKey:'old-private-value'},settings:{voice:'nova',instructions:'Private topic'}});
 const connection=await app.api.connection();
 assert.equal(connection.apiKey,'old-private-value');assert.equal(connection.consent,false);
 assert.deepEqual(app.local,{hermesConnection:{mode:'direct',consent:false},settings:{voice:'nova'}});
 assert.equal(app.session.hermesApiKey,'old-private-value');assert.equal(app.session.hermesInstructions,'Private topic');
 assert.deepEqual(app.levels,[['local','TRUSTED_CONTEXTS'],['session','TRUSTED_CONTEXTS']]);
});

async function storedCredential(indexedDB, change) {
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hermes-credentials',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try {
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction('credentials',change?'readwrite':'readonly'),store=tx.objectStore('credentials');
   const r=store.get('openai');let value;
   r.onsuccess=()=>{value=r.result;if(change)store.put(change(value),'openai');};
   tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error);
  });
 } finally { db.close(); }
}
test('remembered credentials survive browser restart as authenticated ciphertext with a non-exportable key',async()=>{
 const app=harness(),key='sk-'+'r'.repeat(32);
 await app.api.saveConnection({mode:'direct',apiKey:key,consent:true,rememberKey:true});
 const saved=await storedCredential(app.indexedDB);
 assert.equal(saved.key.extractable,false);assert.equal(saved.key.algorithm.length,256);
 await assert.rejects(webcrypto.subtle.exportKey('raw',saved.key));
 assert.ok(!new TextDecoder().decode(saved.ciphertext).includes(key));
 assert.doesNotMatch(JSON.stringify(app.local),/sk-|ciphertext|plaintext/);
 const restarted=harness(app.local,{},app.indexedDB);
 const connection=await restarted.api.connection();
 assert.equal(connection.apiKey,key);assert.equal(connection.rememberKey,true);assert.equal(connection.keyError,'');
 assert.equal(restarted.session.hermesApiKey,key);
});
test('turning remembering off removes the durable credential and retains only the current session',async()=>{
 const app=harness(),key='sk-'+'r'.repeat(32);
 await app.api.saveConnection({mode:'direct',apiKey:key,consent:true,rememberKey:true});
 await app.api.saveConnection({mode:'direct',consent:true,rememberKey:false});
 assert.equal(await storedCredential(app.indexedDB),undefined);
 assert.equal((await app.api.connection()).apiKey,key);
 assert.equal((await harness(app.local,{},app.indexedDB).api.connection()).apiKey,'');
});
test('disconnect deletes the encrypted credential, its crypto key, memory copy, and consent',async()=>{
 const app=harness();
 await app.api.saveConnection({mode:'direct',apiKey:'sk-'+'d'.repeat(32),consent:true,rememberKey:true});
 const connection=await app.api.forgetConnection();
 assert.equal(connection.apiKey,'');assert.equal(connection.rememberKey,false);assert.equal(connection.consent,false);
 assert.equal(await storedCredential(app.indexedDB),undefined);
 assert.equal((await harness(app.local,{},app.indexedDB).api.connection()).apiKey,'');
});
test('disconnect cleans up an orphan from a save interrupted before the remember flag was written',async()=>{
 const app=harness();
 await app.vault.save('sk-'+'i'.repeat(32));
 assert.equal(app.local.hermesConnection,undefined);
 await app.api.forgetConnection();
 assert.equal(await storedCredential(app.indexedDB),undefined);
});
test('tampered ciphertext fails closed and can be replaced or forgotten without unlocking it',async()=>{
 const app=harness(),key='sk-'+'t'.repeat(32);
 await app.api.saveConnection({mode:'direct',apiKey:key,consent:true,rememberKey:true});
 await storedCredential(app.indexedDB,saved=>{new Uint8Array(saved.ciphertext)[0]^=1;return saved;});
 const restarted=harness(app.local,{},app.indexedDB);
 const connection=await restarted.api.connection();
 assert.equal(connection.apiKey,'');assert.match(connection.keyError,/Re-import/);
 assert.ok(!connection.keyError.includes(key));
 await restarted.api.saveConnection({mode:'direct',apiKey:key,consent:true,rememberKey:true});
 assert.equal((await harness(app.local,{},app.indexedDB).api.connection()).apiKey,key);
 await storedCredential(app.indexedDB,saved=>({...saved,version:99}));
 await harness(app.local,{},app.indexedDB).api.forgetConnection();
 assert.equal(await storedCredential(app.indexedDB),undefined);
});
test('unavailable encrypted storage never silently persists plaintext or reports a saved key',async()=>{
 const app=harness({}, {}, {open:()=>{throw Error('Private device error');}}),key='sk-'+'f'.repeat(32);
 await assert.rejects(app.api.saveConnection({mode:'direct',apiKey:key,consent:true,rememberKey:true}),/Could not save the encrypted key/);
 assert.equal(app.session.hermesApiKey,undefined);assert.deepEqual(app.local,{});
 await app.api.saveConnection({mode:'direct',apiKey:key,consent:true,rememberKey:false});
 assert.equal((await app.api.connection()).apiKey,key);assert.doesNotMatch(JSON.stringify(app.local),/sk-/);
});
test('failed deletion revokes consent and clears memory, and a later disconnect can finish cleanup',async()=>{
 const app=harness();
 await app.api.saveConnection({mode:'direct',apiKey:'sk-'+'d'.repeat(32),consent:true,rememberKey:true});
 const broken=harness(app.local,app.session,{open:()=>{throw Error('Unavailable');}});
 await assert.rejects(broken.api.forgetConnection(),/Disconnected, but/);
 assert.equal(app.local.hermesConnection.consent,false);assert.equal(app.session.hermesApiKey,undefined);
 assert.equal((await broken.api.connection()).apiKey,'');
 await harness(app.local,{},app.indexedDB).api.forgetConnection();
 assert.equal(await storedCredential(app.indexedDB),undefined);
});
test('concurrent restore and disconnect cannot restore a key after it was forgotten',async()=>{
 const app=harness();
 await app.api.saveConnection({mode:'direct',apiKey:'sk-'+'q'.repeat(32),consent:true,rememberKey:true});
 const restarted=harness(app.local,{},app.indexedDB);
 await Promise.all([restarted.api.connection(),restarted.api.forgetConnection(),restarted.api.connection()]);
 assert.equal(restarted.session.hermesApiKey,undefined);assert.equal(await storedCredential(app.indexedDB),undefined);
});
test('switching to the optional helper removes direct credentials without copying the supplied key',async()=>{
 const app=harness();
 await app.api.saveConnection({mode:'direct',apiKey:'sk-'+'h'.repeat(32),consent:true,rememberKey:true});
 const result=await app.api.saveConnection({mode:'local',apiKey:'do-not-copy',consent:true,rememberKey:true});
 assert.equal(result.rememberKey,false);assert.equal(result.apiKey,'');assert.equal(await storedCredential(app.indexedDB),undefined);
});
test('remembered credentials require saved consent before they are unlocked',async()=>{
 const app=harness();
 await app.api.saveConnection({mode:'direct',apiKey:'sk-'+'c'.repeat(32),consent:true,rememberKey:true});
 app.local.hermesConnection.consent=false;
 assert.equal((await harness(app.local,{},app.indexedDB).api.connection()).apiKey,'');
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
