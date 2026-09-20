import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  let listener, hasOffscreen = false;
  const events = {}, messages = [], spoken = [], audio = [], saved = {};
  const event = name => ({ addListener: callback => { events[name] = callback; } });
  const clone = value => JSON.parse(JSON.stringify(value));
  const chrome = {
    runtime: {
      onMessage: { addListener: callback => { listener = callback; } },
      onInstalled: event('installed'),
      getURL: path => `chrome-extension://tempo/${path}`,
      getContexts: async () => hasOffscreen ? [{}] : [],
      sendMessage: async message => { audio.push(clone(message)); return { ok: true }; },
    },
    offscreen: { createDocument: async () => { hasOffscreen = true; } },
    storage: {
      session: { get: async key => ({ [key]: saved[key] }), set: async value => Object.assign(saved, clone(value)), remove: async key => { delete saved[key]; } },
      local: { get: async () => ({}), set: async () => {} },
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
    chrome, clearInterval, setInterval, AbortSignal,
    fetch: async () => ({ json: async () => ({ configured: true }) }),
  });
  const command = (action, extra = {}, tabId = 7) => new Promise(resolve => listener({ target: 'background', type: 'control', action, sessionId: 'article', ...extra }, { tab: { id: tabId } }, resolve));
  const load = (model = 'local') => command('load', {
    article: { title: 'Essay', lang: 'en', chunks: [{ text: 'One two three four.', start: 0, end: 4 }, { text: 'Five six seven eight.', start: 4, end: 8 }], totalWords: 8 },
    settings: { model, speed: 1.5 },
  });
  const state = (value, sender = { url: chrome.runtime.getURL('offscreen.html') }, sessionId = 'article') => listener({ target: 'background', type: 'state', sessionId, state: value }, sender, () => {});
  return { command, load, state, spoken, messages, audio, events, saved, expire: () => { hasOffscreen = false; } };
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
  assert.equal(app.audio.at(-1).action, 'stop');
  assert.equal(app.saved.current, undefined);
});
