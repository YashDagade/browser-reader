import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/offscreen.js', import.meta.url), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));

function wav() {
  const data = new ArrayBuffer(8044);
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
    for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
  }
  view.setUint32(4, 8036, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 1000, true);
  view.setUint32(28, 2000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, 8000, true);
  return data;
}

function harness() {
  const requests = [];
  const players = [];
  const messages = [];
  const revoked = [];
  let listener;
  let tick;
  let urlCounter = 0;
  class Player {
    constructor(url) {
      this.src = url;
      this.readyState = 1;
      this.duration = 4;
      this.currentTime = 0;
      this.paused = true;
      this.playCount = 0;
      players.push(this);
    }
    play() { this.paused = false; this.playCount += 1; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() {}
    addEventListener() {}
    removeEventListener() {}
  }
  const context = {
    Audio: Player, Blob, DOMException, AbortController, DataView, Uint8Array,
    setTimeout, clearTimeout, setInterval: (callback) => { tick = callback; },
    navigator: {},
    URL: { createObjectURL: () => `blob:reader-${++urlCounter}`, revokeObjectURL: (url) => revoked.push(url) },
    chrome: { runtime: {
      onMessage: { addListener: (callback) => { listener = callback; } },
      sendMessage: (message) => { messages.push(message); return Promise.resolve(); },
    } },
    fetch: (url, options) => new Promise((resolve, reject) => {
      const request = { url, options, resolve, reject, body: JSON.parse(options.body) };
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      requests.push(request);
    }),
  };
  vm.runInNewContext(source, context);
  const command = (action, extra = {}) => {
    let response;
    listener({ target: 'offscreen', action, ...extra }, {}, (reply) => { response = reply; });
    assert.equal(response?.ok, true);
    return response.state;
  };
  const resolve = async (request = requests[0]) => {
    request.resolve({ ok: true, arrayBuffer: async () => wav() });
    await flush();
  };
  const load = (count = 8, sessionId = 'test') => command('load', {
    sessionId, tabId: 7,
    chunks: Array.from({ length: count }, (_, index) => ({ text: `Chunk ${index} has words.`, start: index * 4, end: index * 4 + 4 })),
    totalWords: count * 4,
    settings: { speed: 1, voice: 'coral', model: 'gpt-4o-mini-tts' },
  });
  return { command, requests, players, messages, revoked, resolve, load, tick: () => tick() };
}

test('loading is free; speech starts only on Play and obeys concurrency bound', async () => {
  const app = harness();
  app.load();
  assert.equal(app.requests.length, 0);
  app.command('play');
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[0].body.text, 'Chunk 0 has words.');
  assert.equal(app.requests[0].options.headers['X-Reader-Client'], 'browser-reader-v1');
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
  await app.resolve(app.requests.at(-2));
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
  assert.equal(app.requests[2].body.text, 'Chunk 6 has words.');
  assert.equal(app.requests[3].body.text, 'Chunk 7 has words.');
  await app.resolve(app.requests[2]);
  assert.equal(app.command('snapshot').wordIndex, 24);
  assert.equal(app.command('snapshot').status, 'playing');
  app.command('stop');
  await flush();
});
