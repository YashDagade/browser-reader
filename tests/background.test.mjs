import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  let listener, hasOffscreen = false, audioSession = null;
  const events = {}, messages = [], spoken = [], audio = [], saved = {}, local = {hermesConnection:{mode:'direct',apiKey:'private-test-value'}}, accesses=[];
  const event = name => ({ addListener: callback => { events[name] = callback; } });
  const clone = value => JSON.parse(JSON.stringify(value));
  const chrome = {
    runtime: {
      onMessage: { addListener: callback => { listener = callback; } },
      onInstalled: event('installed'),
      getURL: path => `chrome-extension://hermes/${path}`,
      getContexts: async () => hasOffscreen ? [{}] : [],
      sendMessage: async message => {audio.push(clone(message));if(message.action==='load')audioSession=message.sessionId;if(message.action==='unload')audioSession=null;return {ok:true,state:{sessionId:audioSession}};},
    },
    offscreen: {createDocument:async()=>{hasOffscreen=true;},closeDocument:async()=>{hasOffscreen=false;audioSession=null;}},
    alarms:{create:()=>{},clear:async()=>{},onAlarm:event('alarm')},
    permissions:{contains:async()=>true},
    storage: {
      session: {get:async key=>Object.fromEntries([].concat(key).map(k=>[k,saved[k]])),set:async value=>Object.assign(saved,clone(value)),remove:async key=>{for(const k of [].concat(key))delete saved[k];}},
      local:{get:async key=>({[key]:local[key]}),set:async value=>Object.assign(local,clone(value)),setAccessLevel:async value=>{accesses.push(value);}},
    },
    tabs: {
      sendMessage: async (tabId, message) => { messages.push({ tabId, ...clone(message) }); },
      onRemoved: event('removed'), onUpdated: event('updated'),
    },
    tts: {
      stop() {}, resume() {},
      getVoices: callback => callback([{ voiceName: 'Samantha', lang: 'en-US', remote: false }]),
      speak: (text, options, callback) => { spoken.push({ text, options }); callback(); },
    },
    action: { onClicked: event('clicked'), setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    commands: { onCommand: event('command') },
    contextMenus: { onClicked: event('context') },
  };
  vm.runInNewContext(source, {
    chrome, clearInterval, setInterval, AbortSignal, importScripts:()=>{}, HermesSpeech:{health:async()=>({configured:true,mode:'direct',running:true})},
    fetch: async () => ({ json: async () => ({ configured: true }) }),
  });
  const command = (action, extra = {}, tabId = 7) => new Promise(resolve => listener({ target: 'background', type: 'control', action, sessionId: 'article', ...extra }, { tab: { id: tabId } }, resolve));
  const load = (model = 'local') => command('load', {
    article: { title: 'Essay', lang: 'en', chunks: [{ text: 'One two three four.', start: 0, end: 4 }, { text: 'Five six seven eight.', start: 4, end: 8 }], totalWords: 8 },
    settings: { model, speed: 1.5 },
  });
  const state = (value, sender = { url: chrome.runtime.getURL('offscreen.html') }, sessionId = 'article') => listener({ target: 'background', type: 'state', sessionId, state: value }, sender, () => {});
  const message=(type,extra={},sender={tab:{id:7}})=>new Promise(resolve=>listener({target:'background',type,...extra},sender,resolve));
  return {command,load,state,message,spoken,messages,audio,events,saved,local,accesses,hasOffscreen:()=>hasOffscreen,expire:()=>{hasOffscreen=false;audioSession=null;}};
}

test('local pause and seek invalidate late native voice events and resume at the selected word', async () => {
  const app = harness();
  await app.load();
  await app.command('play');
  const first = app.spoken[0];
  first.options.onEvent({ type: 'start' });
  first.options.onEvent({ type: 'word', charIndex: 8 });
  assert.equal(app.messages.at(-1).state.wordIndex, 2);
  await app.command('pause');
  first.options.onEvent({ type: 'end' });
  assert.equal(app.spoken.length, 1);
  await app.command('seek', { wordIndex: 5 });
  assert.equal(app.messages.at(-1).state.status, 'paused');
  await app.command('play');
  assert.equal(app.spoken.at(-1).text, 'six seven eight.');
  await app.command('settings', { settings: { speed: 4 } });
  assert.equal(app.spoken.at(-1).text, 'six seven eight.');
  assert.equal(app.spoken.at(-1).options.rate, 4);
});

test('controls are bound to the active tab and session; only the offscreen page may publish cloud state', async () => {
  const app = harness();
  await app.load('gpt-4o-mini-tts');
  assert.match((await app.command('play', {}, 8)).error, /no longer active/);
  assert.match((await app.command('play', { sessionId: 'stale' })).error, /no longer active/);
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

test('switching a playing local session to cloud preserves position and closing its tab stops playback', async () => {
  const app = harness();
  await app.load();
  await app.command('play');
  app.spoken[0].options.onEvent({ type: 'start' });
  app.spoken[0].options.onEvent({ type: 'word', charIndex: 8 });
  await app.command('settings', { settings: { model: 'gpt-4o-mini-tts' } });
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
