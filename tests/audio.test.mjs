import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';

const timingSource = await readFile(new URL('../extension/timing.js', import.meta.url), 'utf8');
const cacheSource = await readFile(new URL('../extension/audio-cache.js', import.meta.url), 'utf8');
const source = await readFile(new URL('../extension/offscreen.js', import.meta.url), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const sessionCipher = { id: 'test-playback-session', key: [...webcrypto.getRandomValues(new Uint8Array(32))] };

function wav(byteLength = 8044) {
  const data = new ArrayBuffer(byteLength);
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
    for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
  }
  view.setUint32(4, byteLength - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 1000, true);
  view.setUint32(28, 2000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, byteLength - 44, true);
  return data;
}

function harness({ withAlignment = false, persistentStore = null, cipher = sessionCipher, clock = null, engine = source, decodeReady = 4 } = {}) {
  const requests = [];
  const players = [];
  const alignments = [];
  const timers = new Map();
  let timerCounter = 0;
  const messages = [];
  const revoked = [];
  let listener;

  let urlCounter = 0;
  class Player {
    constructor(url) {
      this.src = url;
      this.readyState = decodeReady;
      this.events = new Map();
      this.duration = 4;
      this.currentTime = 0;
      this.paused = true;
      this.playCount = 0;
      players.push(this);
    }
    play() { this.paused = false; this.playCount += 1; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() { if (!this.src) this.emit('emptied'); }
    addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name,new Set()); this.events.get(name).add(fn); }
    removeEventListener(name, fn) { this.events.get(name)?.delete(fn); }
    emit(name) { for (const fn of [...(this.events.get(name)||[])]) fn(); }
    ready() { this.readyState=4; this.emit('loadedmetadata'); this.emit('canplay'); }
  }
  const context = {
    Audio: Player, Blob, DOMException, AbortController, DataView, Uint8Array, ArrayBuffer,
    ...(persistentStore ? { indexedDB: persistentStore, crypto: webcrypto, TextEncoder, TextDecoder } : {}),
    setTimeout: clock?.setTimeout || setTimeout, clearTimeout: clock?.clearTimeout || clearTimeout,
    ...(clock ? {Date: class extends Date {static now(){return clock.now;}}} : {}),
    setInterval: (callback) => { const id = ++timerCounter; timers.set(id, callback); return id; },
    clearInterval: (id) => timers.delete(id),
    navigator: {},
    URL: { createObjectURL: () => `blob:reader-${++urlCounter}`, revokeObjectURL: (url) => revoked.push(url) },
    chrome: { runtime: {
      onMessage: { addListener: (callback) => { listener = callback; } },
      sendMessage: (message) => {
        if (message.type === 'audio-key-internal') return Promise.resolve({ cipher: structuredClone(cipher) });
        messages.push(message); return Promise.resolve();
      },
    } },
    HermesSpeech: {
      speech: (body, signal) => new Promise((resolve, reject) => {
        const request = { options: { signal }, resolve, reject, body };
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        requests.push(request);
      }),
      ...(withAlignment ? { align: (body, buffer, signal) => new Promise((resolve, reject) => {
        const request = { body, buffer, signal, resolve, reject };
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        alignments.push(request);
      }) } : {}),
    },
  };
  vm.runInNewContext(timingSource, context);
  if (persistentStore) vm.runInNewContext(cacheSource, context);
  vm.runInNewContext(engine, context);
  const command = (action, extra = {}) => {
    let response;
    listener({ target: 'offscreen', action, ...extra }, {}, (reply) => { response = reply; });
    assert.equal(response?.ok, true);
    return response.state;
  };
  const resolve = async (request = requests[0], buffer = wav()) => {
    request.resolve({ ok: true, arrayBuffer: async () => buffer });
    await flush();
  };
  const load = (count = 8, sessionId = 'test') => command('load', {
    sessionId, tabId: 7,
    chunks: Array.from({ length: count }, (_, index) => ({ text: `Chunk ${index} has words.`, start: index * 4, end: index * 4 + 4 })),
    totalWords: count * 4,
    settings: { speed: 1, generationSpeed: 1, voice: 'coral', model: 'gpt-4o-mini-tts' },
  });
  return { command, requests, players, messages, revoked, resolve, load, alignments, timers, diskCache: context.HermesAudioCache,
    tick: () => { for (const callback of timers.values()) callback(); } };
}

test('loading is free; speech starts only on Play and obeys concurrency bound', async () => {
  const app = harness();
  app.load();
  assert.equal(app.requests.length, 0);
  app.command('play');
  assert.equal(app.requests.length, 4);
  assert.equal(app.requests[0].body.text, 'Chunk 0 has words.');
  assert.equal(app.requests[0].body.speed, undefined);
  await app.resolve();
  assert.equal(app.players.length, 1);
  assert.equal(app.command('snapshot').status, 'playing');
  app.command('stop');
  await flush();
});

test('Pause while a request is pending cannot autoplay on response', async () => {
  const app = harness();
  app.load();
  app.command('play');
  app.command('pause');
  await app.resolve();
  assert.equal(app.players.length, 0);
  assert.equal(app.command('snapshot').status, 'paused');
  app.command('play');
  await flush();
  assert.equal(app.players.length, 1);
  assert.equal(app.command('snapshot').status, 'playing');
  app.command('stop');
  await flush();
});

test('speed is applied instantly without synthesizing again; paused seek waits for Play', async () => {
  const app = harness();
  app.load();
  app.command('play');
  await app.resolve();
  const requestCount = app.requests.length;
  app.command('settings', { settings: { speed: 4 } });
  assert.equal(app.players[0].playbackRate, 4);
  assert.equal(app.players[0].preservesPitch, true);
  assert.equal(app.requests.length, requestCount);
  app.command('pause');
  app.command('seek', { wordIndex: 2 });
  assert.equal(app.requests.length, requestCount);
  assert.equal(app.command('snapshot').wordIndex, 2);
  app.command('play');
  await flush();
  assert.ok(app.players.at(-1).currentTime > 0);
  assert.equal(app.players.at(-1).playbackRate, 4);
  assert.equal(app.command('snapshot').status, 'playing');
  app.command('stop');
  await flush();
});

test('Stop aborts pending requests and frees blobs, while retaining the article', async () => {
  const app = harness();
  app.load();
  app.command('play');
  await app.resolve();
  const player = app.players[0];
  app.command('stop');
  await flush();
  assert.equal(player.paused, true);
  assert.equal(app.revoked.length, 1);
  assert.ok(app.requests.every((request) => request.options.signal.aborted));
  assert.equal(app.command('snapshot').status, 'idle');
  assert.equal(app.command('snapshot').totalWords, 32);
  app.command('play');
  assert.equal(app.command('snapshot').status, 'loading');
  app.command('stop');
  await flush();
});

test('replacing a session discards the old response and changing voice restarts at the current word', async () => {
  const app = harness();
  app.load();
  app.command('play');
  const original = app.requests[0];
  app.load(4, 'new-session');
  await app.resolve(original);
  assert.equal(app.players.length, 0);
  app.command('play');
  await app.resolve(app.requests.findLast(r=>r.body.text==='Chunk 0 has words.'&&!r.options.signal.aborted));
  const player = app.players.at(-1);
  player.currentTime = 2.5;
  app.tick();
  const word = app.command('snapshot').wordIndex;
  assert.ok(word > 0);
  app.command('settings', { settings: { voice: 'cedar' } });
  await flush();
  assert.equal(player.paused, true);
  assert.equal(app.command('snapshot').wordIndex, word);
  assert.equal(app.requests.at(-2).body.voice, 'cedar');
  app.command('stop');
  await flush();
});

test('far seek cancels unrelated lookahead and prioritizes the requested chunk', async () => {
  const app = harness();
  app.load();
  app.command('play');
  app.command('seek', { wordIndex: 24 });
  await flush();
  assert.equal(app.requests[4].body.text, 'Chunk 6 has words.');
  assert.equal(app.requests[5].body.text, 'Chunk 7 has words.');
  await app.resolve(app.requests[4]);
  assert.equal(app.command('snapshot').wordIndex, 24);
  assert.equal(app.command('snapshot').status, 'playing');
  app.command('stop');
  await flush();
});


test('no polling while idle or paused; stop and unload release timers and article state', async () => {
  const app = harness();
  app.load(1);
  assert.equal(app.timers.size, 0);
  assert.equal(app.command('get-state').sessionId, 'test');
  app.command('play');
  await app.resolve();
  assert.equal(app.timers.size, 1);
  app.command('pause');
  assert.equal(app.timers.size, 0);
  app.command('play');
  await flush();
  assert.equal(app.timers.size, 1);
  const before = app.messages.length;
  const unloaded = app.command('unload');
  assert.equal(app.messages.length, before, 'unloading must not overwrite retained background position');
  assert.equal(unloaded.totalWords, 0);
  assert.equal(app.command('get-state').sessionId, null);
  assert.equal(app.timers.size, 0);
  assert.equal(app.revoked.length, 1);
});

test('alignment never delays playback and refines the current word once available', async () => {
  const app = harness({ withAlignment: true });
  app.load(1);
  app.command('play');
  await app.resolve();
  assert.equal(app.command('snapshot').status, 'playing');
  assert.equal(app.command('snapshot').timingSource, 'estimated');
  assert.equal(app.alignments.length, 1);
  app.players[0].currentTime = 0.8;
  app.alignments[0].resolve({ words: [
    { word: 'Chunk', start: 0.1, end: 0.2 }, { word: 'zero', start: 0.3, end: 0.5 },
    { word: 'has', start: 0.6, end: 1.5 }, { word: 'words', start: 2, end: 3.8 },
  ] });
  await flush();
  assert.equal(app.command('snapshot').timingSource, 'aligned');
  assert.equal(app.command('snapshot').wordIndex, 2);
  app.command('pause');
  app.command('seek', { wordIndex: 3 });
  app.command('play');
  await flush();
  assert.equal(app.players.at(-1).currentTime, 2);
  app.command('stop');
  await flush();
});

test('estimated mode makes no alignment requests; alignment failure leaves speech playing', async () => {
  const app = harness({ withAlignment: true });
  app.load(1);
  app.command('settings', { settings: { syncMode: 'estimated' } });
  app.command('play');
  await app.resolve();
  assert.equal(app.alignments.length, 0);
  app.command('settings', { settings: { syncMode: 'precise' } });
  await flush();
  assert.equal(app.alignments.length, 1);
  app.alignments[0].reject(new Error('Transcription unavailable'));
  await flush();
  assert.equal(app.command('snapshot').status, 'playing');
  assert.equal(app.command('snapshot').error, null);
  assert.equal(app.command('snapshot').timingSource, 'estimated');
  app.command('stop');
  await flush();
});

test('seeking cancels old alignment and stale results cannot move the new position', async () => {
  const app = harness({ withAlignment: true });
  app.load();
  app.command('play');
  await app.resolve();
  const previous = app.alignments[0];
  assert.ok(previous);
  app.command('seek', { wordIndex: 24 });
  assert.equal(previous.signal.aborted, true);
  previous.resolve({ words: [{ word: 'Chunk', start: 0, end: 1 }] });
  await flush();
  assert.equal(app.command('snapshot').wordIndex, 24);
  assert.equal(app.command('snapshot').timingSource, 'estimated');
  app.command('stop');
  await flush();
});

test('remaining duration uses measured audio, advances during speech, and scales immediately with speed', async () => {
  const app = harness();
  app.load(1);
  app.command('play');
  await app.resolve();
  assert.equal(app.command('snapshot').remainingSeconds, 4);
  app.players[0].currentTime = 1.3;
  app.tick();
  assert.equal(app.command('snapshot').remainingSeconds, 2.7);
  app.command('settings', { settings: { speed: 3 } });
  assert.ok(Math.abs(app.command('snapshot').remainingSeconds - 0.9) < 0.0001);
  app.players[0].onended();
  assert.equal(app.command('snapshot').remainingSeconds, 0);
  assert.equal(app.timers.size, 0);
  assert.equal(app.revoked.length, 1);
});

test('instructions invalidate generated audio while speed and sync options do not', async () => {
  const app = harness();
  app.load(1);
  app.command('play');
  await app.resolve();
  app.players[0].currentTime = 2;
  app.tick();
  const word = app.command('snapshot').wordIndex;
  app.command('settings', { settings: { instructions: 'Physics article; pronounce the symbols clearly.' } });
  await flush();
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[1].body.instructions, 'Physics article; pronounce the symbols clearly.');
  assert.equal(app.command('snapshot').wordIndex, word);
  await app.resolve(app.requests[1]);
  const requests = app.requests.length;
  app.command('settings', { settings: { speed: 2, syncMode: 'estimated' } });
  assert.equal(app.requests.length, requests);
  app.command('stop');
  await flush();
});

test('alignment is bounded to one request and stop cancels preparation', async () => {
  const app = harness({ withAlignment: true });
  app.load(8);
  app.command('play');
  await app.resolve(app.requests[0]);
  await app.resolve(app.requests[1]);
  await app.resolve(app.requests[2]);
  assert.equal(app.alignments.length, 1);
  app.command('stop');
  await flush();
  assert.equal(app.alignments[0].signal.aborted, true);
  assert.equal(app.alignments.length, 1);
  assert.equal(app.revoked.length, 3);
});


test('audio byte budget evicts oversized lookahead while keeping the playing passage', async () => {
  const app = harness();
  app.load(3);
  app.command('play');
  await app.resolve(app.requests[0], wav(7 * 1024 * 1024));
  await app.resolve(app.requests[1], wav(7 * 1024 * 1024));
  assert.equal(app.command('snapshot').status, 'playing');
  assert.equal(app.players[0].paused, false);
  assert.equal(app.revoked.length, 1, '14 MiB of cache must evict at least one passage');
  assert.equal(app.revoked[0], 'blob:reader-2');
  app.command('stop');
  await flush();
});


const until = async (condition) => {
  for (let i = 0; i < 100; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Expected asynchronous state did not arrive');
};

test('completed speech and aligned timings survive stop and a new offscreen document without new API requests', async () => {
  const persistentStore = new IDBFactory();
  const first = harness({ withAlignment: true, persistentStore });
  first.load(1);
  first.command('play');
  await until(() => first.requests.length === 1);
  await first.resolve();
  await until(() => first.alignments.length === 1);
  first.alignments[0].resolve({ words: [
    { word: 'Chunk', start: 0.1, end: 0.2 }, { word: 'zero', start: 0.3, end: 0.5 },
    { word: 'has', start: 0.6, end: 1.5 }, { word: 'words', start: 2, end: 3.8 },
  ] });
  await until(() => first.command('snapshot').timingSource === 'aligned');
  assert.equal((await first.diskCache.stats()).entries, 1);
  first.command('unload');
  const second = harness({ withAlignment: true, persistentStore });
  second.load(1, 'second-document');
  second.command('settings', { settings: { speed: 4 } });
  second.command('play');
  await until(() => second.command('snapshot').status === 'playing');
  assert.equal(second.requests.length, 0);
  assert.equal(second.alignments.length, 0);
  assert.equal(second.command('snapshot').timingSource, 'aligned');
  second.command('settings', { settings: { speed: 2 } });
  assert.equal(second.players[0].playbackRate, 2);
  assert.equal(second.requests.length, 0);
  assert.equal(second.alignments.length, 0);
  second.command('pause');
  second.command('seek', { wordIndex: 3 });
  second.command('play');
  await until(() => second.command('snapshot').status === 'playing');
  assert.equal(second.players.at(-1).currentTime, 2);
  second.command('stop');
});

test('failed and cancelled speech never enters the persistent cache', async () => {
  const app = harness({ persistentStore: new IDBFactory() });
  app.load(1);
  app.command('play');
  await until(() => app.requests.length === 1);
  app.requests[0].reject(new Error('Network failed'));
  await until(() => app.command('snapshot').status === 'error');
  assert.equal((await app.diskCache.stats()).entries, 0);
  app.command('play');
  await until(() => app.requests.length === 2);
  app.command('stop');
  await app.resolve(app.requests[1]);
  assert.equal((await app.diskCache.stats()).entries, 0);
});

test('cached speech without timings can add alignment once without repeating synthesis', async () => {
  const persistentStore = new IDBFactory();
  const first = harness({ persistentStore });
  first.load(1);
  first.command('settings', { settings: { syncMode: 'estimated' } });
  first.command('play');
  await until(() => first.requests.length === 1);
  await first.resolve();
  assert.equal((await first.diskCache.stats()).entries, 1);
  first.command('stop');
  const second = harness({ withAlignment: true, persistentStore });
  second.load(1);
  second.command('play');
  await until(() => second.alignments.length === 1);
  assert.equal(second.requests.length, 0);
  assert.equal(second.command('snapshot').status, 'playing');
  second.command('stop');
  await flush();
});


test('speed changes while synthesis is pending neither abort nor regenerate it', async () => {
  const app = harness({ persistentStore: new IDBFactory() });
  app.load(1);
  app.command('play');
  await until(() => app.requests.length === 1);
  const pending = app.requests[0];
  app.command('settings', { settings: { speed: 4 } });
  app.command('settings', { settings: { speed: 2.5 } });
  assert.equal(pending.options.signal.aborted, false);
  assert.equal(app.requests.length, 1);
  await app.resolve(pending);
  assert.equal(app.players[0].playbackRate, 2.5);
  app.command('stop');
});

test('generated speed normalizes playback and remaining time without moving word timestamps or requesting more audio', async () => {
  const app = harness({ withAlignment: true });
  app.load(1);
  app.command('settings', { settings: { speed: 2.3, generationSpeed: 2.3 } });
  app.command('play');
  assert.equal(app.requests[0].body.generationSpeed, 2.3);
  await app.resolve();
  const player = app.players[0];
  assert.equal(player.playbackRate, 1);
  assert.equal(player.preservesPitch, true);
  assert.equal(app.command('snapshot').remainingSeconds, 4);
  app.alignments[0].resolve({ words: [
    {word:'Chunk', start:0, end:.4}, {word:'0', start:.5, end:1},
    {word:'has', start:1.2, end:2}, {word:'words.', start:2.2, end:3.8},
  ] });
  await flush();
  player.currentTime = 1.3;
  app.tick();
  assert.equal(app.command('snapshot').wordIndex, 2);
  app.command('settings', { settings: { speed: 1 } });
  assert.equal(player.playbackRate, 1 / 2.3);
  assert.equal(player.currentTime, 1.3);
  assert.equal(app.command('snapshot').wordIndex, 2);
  assert.ok(Math.abs(app.command('snapshot').remainingSeconds - 2.7 * 2.3) < .001);
  app.command('pause');
  app.command('seek', { wordIndex: 2 });
  app.command('play');
  await flush();
  assert.equal(app.players.at(-1).currentTime, 1.2);
  assert.equal(app.players.at(-1).playbackRate, 1 / 2.3);
  for(const speed of [2.35,2.4,4,7]) {
    app.command('settings', { settings: { speed } });
    assert.equal(app.players.at(-1).playbackRate, speed / 2.3);
    assert.equal(app.players.at(-1).currentTime, 1.2);
    assert.equal(app.players.at(-1).preservesPitch, true);
  }
  assert.equal(app.requests.length, 1);
  assert.equal(app.alignments.length, 1);
  app.command('stop');
});

test('changing generation speed replaces pending audio and resumes at the current word; paused changes stay free', async () => {
  const app = harness();
  app.load(1);
  app.command('play');
  await app.resolve();
  app.players[0].currentTime = 2;
  app.tick();
  const word = app.command('snapshot').wordIndex;
  app.command('settings', { settings: { generationSpeed: 2.3, speed: 2.3 } });
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[1].body.generationSpeed, 2.3);
  assert.equal(app.players[0].src, '');
  await app.resolve(app.requests[1]);
  assert.equal(app.players.at(-1).playbackRate, 1);
  assert.equal(app.command('snapshot').wordIndex, word);
  app.command('pause');
  app.command('settings', { settings: { generationSpeed: 4, speed: 4 } });
  assert.equal(app.requests.length, 2);
  assert.equal(app.command('snapshot').status, 'paused');
  app.command('play');
  assert.equal(app.requests[2].body.generationSpeed, 4);
  app.command('stop');
  await flush();
});

test('next audio is decoded before the boundary and handed off without a loading state or duplicate request',async()=>{
 const app=harness();app.load(5);app.command('play');await app.resolve(app.requests[0]);await app.resolve(app.requests[1]);
 const first=app.players.find(p=>!p.paused),warm=app.players.find(p=>p!==first&&p.src);assert.ok(warm);assert.equal(warm.playCount,0);assert.equal(warm.preload,'auto');
 const count=app.requests.length,states=app.messages.length;first.onended();await flush();
 assert.equal(warm.playCount,1);assert.equal(app.command('snapshot').wordIndex,4);assert.equal(app.players.filter(p=>!p.paused).length,1);
 assert.equal(app.messages.slice(states).some(m=>m.state.status==='loading'),false);assert.equal(app.requests.length,count);app.command('stop');
});

test('prefetch refills past three chunks while current audio is still playing, with bounded concurrency',async()=>{
 const app=harness();app.load(80);app.command('play');let peak=0;
 for(let i=0;i<18;i++){const pending=app.requests.filter(r=>!r.done&&!r.options.signal.aborted);peak=Math.max(peak,pending.length);if(!pending.length)break;pending[0].done=true;await app.resolve(pending[0]);}
 assert.ok(app.command('snapshot').bufferedSeconds>=60);assert.ok(app.requests.length>4);assert.ok(peak<=4);assert.ok(app.requests.length<=17);assert.equal(app.command('snapshot').wordIndex,0);
 const count=app.requests.length;app.command('pause');await flush();assert.equal(app.requests.length,count);app.command('stop');
});

test('resume restarts queued speech preparation and stop releases the preloaded player',async()=>{
 const app=harness();app.load(30);app.command('play');await app.resolve(app.requests[0]);app.command('pause');
 for(const request of app.requests.slice(1))await app.resolve(request);
 const before=app.requests.length;app.command('play');await flush();assert.ok(app.requests.length>before);app.command('stop');await flush();assert.ok(app.players.every(p=>p.paused&&!p.src));
});

test('a decoding preloaded passage is cancelled by seek and cannot start late',async()=>{
 const app=harness({decodeReady:1});app.load(30);app.command('play');await app.resolve(app.requests[0]);await app.resolve(app.requests[1]);
 const warm=app.players.find(p=>p.paused&&p.src);assert.ok(warm);app.players.find(p=>!p.paused).onended();await flush();
 app.command('seek',{wordIndex:100});warm.ready();await flush();assert.equal(warm.playCount,0);assert.equal(warm.src,'');assert.equal(app.command('snapshot').wordIndex,100);app.command('stop');await flush();
});

test('memory eviction does not repeatedly regenerate the same oversized lookahead',async()=>{
 const app=harness();app.load(8);app.command('play');await app.resolve(app.requests[0],wav(7*1024*1024));await app.resolve(app.requests[1],wav(7*1024*1024));
 for(let i=0;i<5;i++)app.command('settings',{settings:{speed:2+i*.05}});
 assert.equal(app.requests.filter(r=>r.body.text==='Chunk 1 has words.').length,1);app.command('stop');await flush();
});

test('failed speculative speech stays failed until played instead of retrying on every refill',async()=>{
 const app=harness();app.load(10);app.command('play');await app.resolve(app.requests[0]);app.requests[1].reject(Error('Rate limited'));await flush();
 for(let i=0;i<5;i++)app.command('settings',{settings:{speed:2+i*.05}});
 assert.equal(app.requests.filter(r=>r.body.text==='Chunk 1 has words.').length,1);app.players.find(p=>!p.paused).onended();await flush();assert.equal(app.command('snapshot').status,'error');app.command('stop');
});

test('long narration absorbs a 25-second network slowdown after two minutes without a mid-article stall',async t=>{
 const callbacks=new Map();let id=0;const clock={now:0,setTimeout:(fn,ms)=>{callbacks.set(++id,{fn,at:clock.now+ms});return id;},clearTimeout:id=>callbacks.delete(id)};
 const app=harness({clock,engine:process.env.HERMES_BASELINE?await readFile(process.env.HERMES_BASELINE,'utf8'):source});app.load(90);app.command('settings',{settings:{speed:2.3,generationSpeed:2.3}});app.command('play');
 let started=false,stalled=0,peak=0,transitions=0,previous=-1;
 for(;clock.now<450000;clock.now+=100){
  for(const request of app.requests){if(request.due===undefined)request.due=clock.now+(clock.now>=120000&&clock.now<145000?25000:2500);}
  for(const request of app.requests){if(!request.done&&!request.options.signal.aborted&&clock.now>=request.due){request.done=true;await app.resolve(request);}}
  peak=Math.max(peak,app.requests.filter(r=>!r.done&&!r.options.signal.aborted).length);
  for(const [key,job] of callbacks)if(job.at<=clock.now){callbacks.delete(key);job.fn();}
  const state=app.command('snapshot');if(state.status==='ended')break;
  if(state.status==='playing'){started=true;const player=app.players.find(p=>!p.paused);assert.ok(player);player.currentTime+=.1*player.playbackRate;if(player.currentTime>=4){player.currentTime=4;player.onended();await flush();}}
  else if(started&&state.status==='loading')stalled+=100;
  app.tick();if(state.wordIndex!==previous&&state.wordIndex%4===0){previous=state.wordIndex;transitions++;}await flush();
 }
 const result={simulatedSeconds:clock.now/1000,stallSeconds:stalled/1000,requests:app.requests.length,peakRequests:peak,transitions,final:app.command('snapshot').status};
 t.diagnostic(JSON.stringify(result));app.command('stop');await flush();
 assert.equal(result.final,'ended');assert.equal(result.requests,90);assert.ok(peak<=4);assert.equal(stalled,0);
});
