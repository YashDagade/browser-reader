import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
const vaultSource = await readFile(new URL('../extension/credential-vault.js', import.meta.url), 'utf8');
const sessionSource = await readFile(new URL('../extension/session-data.js', import.meta.url), 'utf8');

const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const indexedDB=new IDBFactory();
  let listener, hasOffscreen = false, audioSession = null, documentAlive=true;
  const events = {}, messages = [], audio = [], saved = {}, local = {hermesConnection:{mode:'direct',apiKey:'private-test-value',consent:true}}, accesses=[];
  const event = name => ({ addListener: callback => { events[name] = callback; } });
  const clone = value => JSON.parse(JSON.stringify(value));
  const chrome = {
    runtime: {
      onMessage: { addListener: callback => { listener = callback; } },
      onInstalled: event('installed'),
      openOptionsPage: async()=>{events.optionsOpened=true;},
      getURL: path => `chrome-extension://hermes/${path}`,
      getContexts: async () => hasOffscreen ? [{}] : [],
      sendMessage: async message => {audio.push(clone(message));if(message.action==='load')audioSession=message.sessionId;if(message.action==='unload')audioSession=null;return {ok:true,state:{sessionId:audioSession}};},
    },
    offscreen: {createDocument:async()=>{hasOffscreen=true;},closeDocument:async()=>{hasOffscreen=false;audioSession=null;}},
    alarms:{create:()=>{},clear:async()=>{},onAlarm:event('alarm')},
    permissions:{contains:async()=>true},
    storage: {
      session: {setAccessLevel:async()=>{},get:async key=>clone(Object.fromEntries([].concat(key).map(k=>[k,saved[k]]))),set:async value=>Object.assign(saved,clone(value)),remove:async key=>{for(const k of [].concat(key))delete saved[k];}},
      local:{get:async key=>clone(Object.fromEntries([].concat(key).map(k=>[k,local[k]]))),set:async value=>Object.assign(local,clone(value)),setAccessLevel:async value=>{accesses.push(value);}},
    },
    tabs: {
      sendMessage: async (tabId, message) => { messages.push({ tabId, ...clone(message) });if(message.type==='hermes-probe')return documentAlive?{sessionId:message.sessionId}:undefined; },
      onRemoved: event('removed'), onUpdated: event('updated'),
    },
    action: { onClicked: event('clicked'), setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    commands: { onCommand: event('command') },
    contextMenus: { onClicked: event('context') },
  };
  const restartWorker = () => vm.runInNewContext(vaultSource+'\n'+sessionSource+'\n'+source, {
    chrome, crypto:webcrypto, indexedDB, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, clearInterval, setInterval, AbortSignal, importScripts:()=>{}, HermesSpeech:{health:async()=>({configured:true,mode:'direct',running:true})},
    fetch: async () => ({ json: async () => ({ configured: true }) }),
  });
  restartWorker();
  const command = (action, extra = {}, tabId = 7) => new Promise(resolve => listener({ target: 'background', type: 'control', action, sessionId: 'article', ...extra }, { tab: { id: tabId }, documentId:'document-'+tabId, url:'https://article.example/essay#intro' }, resolve));
  const load = (model = 'gpt-4o-mini-tts') => command('load', {
    article: { title: 'Essay', lang: 'en', chunks: [{ text: 'One two three four.', start: 0, end: 4 }, { text: 'Five six seven eight.', start: 4, end: 8 }], totalWords: 8 },
    settings: { model, speed: 1.5 },
  });
  const state = (value, sender = { url: chrome.runtime.getURL('offscreen.html') }, sessionId = 'article') => listener({ target: 'background', type: 'state', sessionId, state: value }, sender, () => {});
  const message=(type,extra={},sender={tab:{id:7}})=>new Promise(resolve=>listener({target:'background',type,...extra},sender,resolve));
  return {restartWorker,replaceDocument:()=>{documentAlive=false;},command,load,state,message,messages,audio,events,saved,local,accesses,hasOffscreen:()=>hasOffscreen,expire:()=>{hasOffscreen=false;audioSession=null;}};
}

test('background restores remembered credentials after session loss and exposes only safe setup metadata',async()=>{
  const app=harness(),options={url:'chrome-extension://hermes/options.html'},key='sk-'+'b'.repeat(32);
  const saved=await app.message('connection-manage',{action:'save',connection:{mode:'direct',consent:true,rememberKey:true,apiKey:key}},options);
  assert.equal(saved.connection.rememberKey,true);assert.equal(saved.connection.hasKey,true);assert.equal(saved.connection.apiKey,undefined);
  for(const property of Object.keys(app.saved))delete app.saved[property];
  app.restartWorker();
  const view=await app.message('connection-manage',{action:'get'},options);
  assert.equal(view.connection.hasKey,true);assert.equal(app.saved.hermesApiKey,key);
  assert.ok(!JSON.stringify(view).includes(key));
  assert.equal((await app.message('connection-internal')).error,'Not permitted.');
  await app.message('connection-manage',{action:'forget'},options);
  for(const property of Object.keys(app.saved))delete app.saved[property];
  app.restartWorker();
  assert.equal((await app.message('connection-manage',{action:'get'},options)).connection.hasKey,false);
});

test('default and legacy browser settings use OpenAI without a native TTS API', async () => {
  const app=harness();
  assert.equal((await app.message('preferences')).settings.model,'gpt-4o-mini-tts');
  await app.load('local');
  await app.command('play');
  assert.equal(app.audio.find(m=>m.action==='load').settings.model,'gpt-4o-mini-tts');
  await app.command('pause');await app.command('seek',{wordIndex:5});
  const loads=app.audio.filter(m=>m.action==='load').length;
  await app.command('settings',{settings:{speed:4}});
  assert.equal(app.audio.at(-1).action,'settings');
  assert.equal(app.audio.at(-1).settings.speed,4);
  assert.equal(app.audio.filter(m=>m.action==='load').length,loads);
});

test('missing consent blocks playback with setup guidance and no audio document',async()=>{
  const app=harness();app.local.hermesConnection.consent=false;
  await app.load();
  assert.match((await app.command('play')).error,/Connect OpenAI/);
  assert.equal(app.hasOffscreen(),false);assert.equal(app.audio.length,0);
  assert.equal(app.messages.at(-1).state.connected,false);
  assert.equal((await app.command('setup',{},8)).code,'STALE_SESSION');
  await app.command('setup');assert.equal(app.events.optionsOpened,true);
});

test('controls are bound to the active tab and session; only the offscreen page may publish cloud state', async () => {
  const app = harness();
  await app.load('gpt-4o-mini-tts');
  assert.equal((await app.command('play', {}, 8)).code,'STALE_SESSION');
  assert.equal((await app.command('play', { sessionId: 'stale' })).code,'STALE_SESSION');
  const before = app.messages.length;
  app.state({ status: 'playing', wordIndex: 6 }, { tab: { id: 7 }, url: 'https://article.example/' });
  app.state({ status: 'playing', wordIndex: 6 }, undefined, 'stale');
  await flush();
  assert.equal(app.messages.length, before);
  app.state({ status: 'paused', wordIndex: 3 });
  await flush();
  assert.equal(app.messages.at(-1).state.wordIndex, 3);
});

test('cloud recovery reloads an expired offscreen document at the saved word', async () => {
  const app = harness();
  await app.load('gpt-4o-mini-tts');
  app.state({ status: 'paused', wordIndex: 5 });
  await flush();
  app.expire();
  await app.command('play');
  assert.deepEqual(app.audio.slice(-3).map(message => message.action), ['load', 'seek', 'play']);
  assert.equal(app.audio.at(-2).wordIndex, 5);
});

test('switching API models during playback preserves position and closing its tab stops playback', async () => {
  const app = harness();
  await app.load();
  await app.command('play');
  app.state({status:'playing',wordIndex:2});await flush();
  await app.command('settings', { settings: { model: 'tts-1' } });
  assert.deepEqual(app.audio.slice(-3).map(message => message.action), ['load', 'seek', 'play']);
  assert.equal(app.audio.at(-2).wordIndex, 2);
  app.events.removed(7);
  await flush();
  assert.equal(app.audio.at(-1).action,'unload');
  assert.equal(app.saved.current, undefined);
});


test('opening an article stays idle and closing releases audio and source text',async()=>{
  const app=harness();await app.load('gpt-4o-mini-tts');
  assert.equal(app.hasOffscreen(),false);assert.equal(app.audio.length,0);
  await app.command('play');assert.equal(app.hasOffscreen(),true);
  await app.command('close');assert.equal(app.hasOffscreen(),false);
  assert.equal(app.saved.current,undefined);assert.equal(app.saved.playback,undefined);
});

test('credentials stay in trusted extension contexts and preferences return only reader fields',async()=>{
  const app=harness();app.local.settings={voice:'nova',apiKey:'never-return-this',instructions:'Physics article'};
  const result=await app.message('preferences');
  assert.equal(result.settings.voice,'nova');assert.equal(result.settings.apiKey,undefined);
  assert.equal(app.accesses[0].accessLevel,'TRUSTED_CONTEXTS');
  assert.match((await app.message('connection-internal')).error,/Not permitted/);
  const internal=await app.message('connection-internal',{}, {url:'chrome-extension://hermes/offscreen.html'});
  assert.equal(internal.connection.apiKey,'private-test-value');
  assert.equal(internal.permission,true);
});

test('layout updates do not touch audio; idle release preserves the resume position',async()=>{
  const app=harness();await app.load('gpt-4o-mini-tts');await app.command('play');
  app.state({status:'paused',wordIndex:5});await flush();
  const count=app.audio.length;
  await app.message('layout',{layout:{dock:'left',x:20,y:50,collapsed:true}});
  assert.equal(app.audio.length,count);assert.equal(app.local.settings.layout.dock,'left');
  app.events.alarm({name:'hermes-release-audio'});await flush();
  assert.equal(app.hasOffscreen(),false);assert.equal(app.saved.playback.state.wordIndex,5);
  await app.command('play');assert.equal(app.audio.at(-2).wordIndex,5);
});

test('a layout change after worker restart persists through a subsequent restore without restarting audio',async()=>{
  const app=harness();await app.load('gpt-4o-mini-tts');
  await app.command('settings',{settings:{layout:{dock:'left',collapsed:false}}});
  app.state({status:'paused',wordIndex:5});await flush();
  assert.equal(app.saved.playback.state.settings.layout.dock,'left');
  const audioCount=app.audio.length;

  app.restartWorker();
  await app.message('layout',{layout:{dock:'right',x:80,y:120,collapsed:false}});
  assert.equal(app.local.settings.layout.dock,'right');
  assert.equal(app.saved.playback.state.settings.layout.dock,'right');
  assert.equal(app.saved.playback.state.wordIndex,5);

  app.restartWorker();
  app.state({status:'paused',wordIndex:5});await flush();
  assert.equal(app.messages.at(-1).state.settings.layout.dock,'right');
  assert.equal(app.messages.at(-1).state.wordIndex,5);
  assert.equal(app.audio.length,audioCount);
});


test('pause and seek retain a live cloud document instead of reloading the article',async()=>{
  const app=harness();await app.load('gpt-4o-mini-tts');await app.command('play');
  await app.command('pause');await app.command('seek',{wordIndex:3});
  assert.equal(app.audio.filter(message=>message.action==='load').length,1);
  assert.equal(app.audio.at(-1).action,'seek');
});


test('replay after idle release starts an ended article from the beginning',async()=>{
  const app=harness();await app.load('gpt-4o-mini-tts');await app.command('play');
  app.state({status:'ended',wordIndex:7});await flush();app.expire();
  const before=app.audio.length;await app.command('play');
  assert.deepEqual(app.audio.slice(before).map(message=>message.action),['get-state','load','play']);
});


test('same-document loading and fragment navigation preserve the active reading session',async()=>{
  const app=harness();await app.load('gpt-4o-mini-tts');await app.command('play');
  const loads=app.audio.filter(m=>m.action==='load').length;
  app.events.updated(7,{status:'loading',url:'https://article.example/essay#chapter-two'});await flush();
  app.events.updated(7,{status:'complete'});await flush();
  assert.ok(app.saved.current);assert.equal(app.hasOffscreen(),true);
  assert.equal((await app.command('pause')).ok,true);
  assert.equal(app.audio.filter(m=>m.action==='load').length,loads);
});

test('a replaced document releases speech while a later page can register normally',async()=>{
  const app=harness();await app.load('gpt-4o-mini-tts');await app.command('play');
  app.replaceDocument();app.events.updated(7,{status:'complete'});await flush();
  assert.equal(app.saved.current,undefined);assert.equal(app.hasOffscreen(),false);
  assert.equal((await app.command('play')).code,'STALE_SESSION');
  await app.load('gpt-4o-mini-tts');assert.equal((await app.command('play')).ok,true);
});

test('reconnecting an article restores its position without audio generation until play',async()=>{
  const app=harness();await app.load('gpt-4o-mini-tts');
  const article=app.saved.current;
  await app.command('close');
  await app.command('load',{article,settings:article.settings,wordIndex:5});
  assert.equal(app.saved.current.state.wordIndex,5);assert.equal(app.hasOffscreen(),false);
  await app.command('play');assert.equal(app.audio.at(-2).wordIndex,5);
});
test('key, cipher and private-setting routes reject content scripts and ordinary pages',async()=>{
 const app=harness();
 for(const type of ['connection-internal','audio-key-internal','connection-manage','preferences-save']) {
  assert.match((await app.message(type,{action:'save',connection:{mode:'local',consent:true}})).error,/Not permitted/);
  assert.match((await app.message(type,{}, {url:'https://article.example/options.html'})).error,/Not permitted/);
 }
 const options={url:'chrome-extension://hermes/options.html?restricted=1',tab:{id:99}};
 const view=await app.message('connection-manage',{action:'get'},options);
 assert.equal(view.connection.hasKey,true);assert.equal(view.connection.apiKey,undefined);
 assert.equal(app.local.hermesConnection.apiKey,undefined);
 const internal={url:'chrome-extension://hermes/offscreen.html'};
 const first=await app.message('audio-key-internal',{},internal);
 assert.equal(first.cipher.key.length,32);
 app.restartWorker();
 assert.equal(JSON.stringify((await app.message('audio-key-internal',{},internal)).cipher),JSON.stringify(first.cipher));
 assert.ok((await app.message('preferences',{},options)).settings);
});
