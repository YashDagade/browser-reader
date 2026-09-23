import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';

const source = await readFile(new URL('../extension/audio-cache.js', import.meta.url), 'utf8');
const day = 24 * 60 * 60 * 1000;
const sessionCipher = { id: 'test-browser-session', key: [...webcrypto.getRandomValues(new Uint8Array(32))] };
function harness(factory = new IDBFactory(), clock = { now: 100 * day }, timers = {}, session = sessionCipher) {
  const context = { indexedDB: factory, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Blob,
    chrome: { runtime: { sendMessage: async (message) => {
      assert.equal(message.target, 'background'); assert.equal(message.type, 'audio-key-internal');
      return session ? { cipher: structuredClone(session) } : {};
    } } },
    setTimeout, clearTimeout, ...timers, Date: { now: () => clock.now } };
  vm.runInNewContext(source, context);
  return { cache: context.HermesAudioCache, factory, clock };
}
const payload = { text: 'Physics has precise terms.', model: 'gpt-4o-mini-tts', voice: 'alloy', instructions: 'Physics article.' };
const record = (size = 100) => ({ blob: new Blob([new Uint8Array(size)], { type: 'audio/wav' }),
  duration: 2, estimatedTimings: [0, 0.4, 0.8, 1.4, 2], alignedTimings: [0.1, 0.3, 0.7, 1.3, 1.9] });

test('speech keys ignore speed, follow, layout, sync and credentials while distinguishing speech inputs', async () => {
  const { cache } = harness();
  const key = await cache.keyFor(payload);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(await cache.keyFor({ ...payload, speed: 4, follow: false, syncMode: 'estimated', layout: 'left', apiKey: 'example-only' }), key);
  for (const change of [{ text: 'Another passage.' }, { voice: 'nova' }, { model: 'tts-1' }, { instructions: 'Biology article.' }, { generationSpeed: 2.3 }]) {
    assert.notEqual(await cache.keyFor({ ...payload, ...change }), key);
  }
  assert.equal(await cache.keyFor({ ...payload, instructions: ' Physics article. ' }), key);
  assert.equal(await cache.keyFor({ ...payload, generationSpeed: 1 }), key);
  assert.equal(await cache.keyFor({ ...payload, generationSpeed: 2.3, speed: 1 }),
    await cache.keyFor({ ...payload, generationSpeed: 2.3, speed: 4 }));
  assert.equal(await cache.keyFor({ ...payload, model: 'tts-1', instructions: 'One' }),
    await cache.keyFor({ ...payload, model: 'tts-1', instructions: 'Two' }));
});

test('encrypted audio and timings survive a fresh document within the same browser session', async () => {
  const first = harness();
  const key = await first.cache.keyFor(payload);
  const original = record();
  assert.equal(await first.cache.put(key, { ...original, text: payload.text, apiKey: 'example-only', articleURL: 'https://example.com/private' }), true);
  const second = harness(first.factory, first.clock);
  const saved = await second.cache.get(key);
  assert.equal(saved.blob.size, original.blob.size);
  assert.deepEqual(Array.from(saved.alignedTimings), original.alignedTimings);
  assert.deepEqual(Object.keys(saved).sort(), ['alignedTimings', 'blob', 'duration', 'estimatedTimings', 'key']);
  assert.equal((await second.cache.stats()).entries, 1);
});

test('32 MiB limit evicts least recently used audio', async () => {
  const { cache, clock } = harness();
  const keys = [];
  for (let i = 0; i < 3; i += 1) keys.push(await cache.keyFor({ ...payload, text: `Passage ${i}` }));
  assert.equal(await cache.put(keys[0], record(12 * 1024 * 1024)), true);
  clock.now += 10;
  await cache.put(keys[1], record(12 * 1024 * 1024));
  clock.now += 10;
  await cache.get(keys[0]);
  clock.now += 10;
  await cache.put(keys[2], record(12 * 1024 * 1024));
  const stats = await cache.stats();
  assert.equal(stats.bytes, 24 * 1024 * 1024);
  assert.equal(stats.entries, 2);
  assert.equal(await cache.get(keys[1]), null);
  assert.ok(await cache.get(keys[0]));
  assert.ok(await cache.get(keys[2]));
});

test('audio expires after seven days even if recently used; regeneration starts a fresh TTL', async () => {
  const { cache, clock } = harness();
  const key = await cache.keyFor(payload);
  await cache.put(key, record());
  clock.now += 6 * day;
  assert.ok(await cache.get(key));
  clock.now += day;
  assert.equal(await cache.get(key), null);
  assert.equal((await cache.stats()).entries, 0);
  await cache.put(key, record());
  assert.ok(await cache.get(key));
});

test('entry limit bounds metadata for tiny passages and clear removes all saved audio', async () => {
  const { cache, clock } = harness();
  for (let i = 0; i < 258; i += 1) {
    clock.now += 1;
    const key = await cache.keyFor({ ...payload, text: `Passage ${i}` });
    await cache.put(key, record(44));
  }
  assert.equal((await cache.stats()).entries, 256);
  assert.equal(await cache.clear(), true);
  const stats = await cache.stats();
  assert.equal(stats.bytes, 0);
  assert.equal(stats.entries, 0);
});

test('invalid, empty and unbounded timing records are never cached', async () => {
  const { cache } = harness();
  const key = await cache.keyFor(payload);
  for (const invalid of [
    { ...record(), blob: new Blob([]) },
    { ...record(), duration: Infinity },
    { ...record(), estimatedTimings: [0, 1, 0.5, 2] },
    { ...record(), alignedTimings: [0, 100] },
    { ...record(), alignedTimings: [0, 1] },
  ]) assert.equal(await cache.put(key, invalid), false);
  assert.equal(await cache.get(key), null);
});

test('storage unavailable is a cache miss, allowing normal speech to continue', async () => {
  const { cache } = harness(null);
  assert.equal(await cache.keyFor(payload), null);
  assert.equal(await cache.get('a'.repeat(64)), null);
  assert.equal(await cache.put('a'.repeat(64), record()), false);
  assert.equal((await cache.stats()).available, false);
  assert.equal(await cache.clear(), false);
});


test('stalled IndexedDB transactions time out instead of blocking speech indefinitely', async () => {
  let aborted = 0;
  const database = { close() {}, transaction: () => ({
    objectStore: () => ({ get: () => ({}) }), abort: () => { aborted += 1; },
  }) };
  const factory = { open() {
    const request = {};
    queueMicrotask(() => { request.result = database; request.onsuccess(); });
    return request;
  } };
  const { cache } = harness(factory, { now: 100 * day }, { setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, 10)) });
  assert.equal(await cache.get('a'.repeat(64)), null);
  assert.equal(aborted, 1);
});


async function rawStore(factory, name, change) {
  return new Promise((resolve, reject) => {
    const request = factory.open('hermes-audio-cache', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(name, change ? 'readwrite' : 'readonly');
      const store = transaction.objectStore(name);
      const records = store.getAll();
      records.onsuccess = () => { if (change) change(records.result, store); };
      transaction.oncomplete = () => { database.close(); resolve(records.result); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  });
}

test('IndexedDB contains ciphertext and opaque metadata, never audio blobs, readable timings or encryption keys', async () => {
  const { cache, factory } = harness();
  const key = await cache.keyFor(payload);
  const original = record();
  await cache.put(key, { ...original, text: payload.text, articleURL: 'https://example.com/private', apiKey: 'example-only' });
  const [saved] = await rawStore(factory, 'audio');
  assert.deepEqual(Object.keys(saved).sort(), ['cipherId', 'ciphertext', 'iv', 'key']);
  assert.ok(saved.ciphertext instanceof ArrayBuffer);
  assert.equal(saved.iv.byteLength, 12);
  assert.equal(saved.blob, undefined);
  assert.equal(saved.duration, undefined);
  assert.equal(saved.alignedTimings, undefined);
  assert.equal(saved.estimatedTimings, undefined);
  const [metadata] = await rawStore(factory, 'metadata');
  assert.deepEqual(Object.keys(metadata).sort(), ['bytes', 'cipherId', 'createdAt', 'key', 'usedAt']);
  assert.equal(JSON.stringify(metadata).includes(payload.text), false);
  assert.equal(JSON.stringify(metadata).includes(sessionCipher.key.join(',')), false);
  assert.equal(new TextDecoder().decode(saved.ciphertext).includes('estimatedTimings'), false);
  const restored = await cache.get(key);
  assert.deepEqual(new Uint8Array(await restored.blob.arrayBuffer()), new Uint8Array(await original.blob.arrayBuffer()));
  await cache.put(key, original);
  const [rewritten] = await rawStore(factory, 'audio');
  assert.notDeepEqual(rewritten.iv, saved.iv, 'each encryption uses a fresh 96-bit IV');
});

test('a new browser-session key cannot read old audio and maintenance removes its ciphertext', async () => {
  const first = harness();
  const key = await first.cache.keyFor(payload);
  const otherKey = await first.cache.keyFor({ ...payload, text: 'Another private passage' });
  await first.cache.put(key, record());
  await first.cache.put(otherKey, record());
  const nextCipher = { id: 'different-browser-session', key: [...webcrypto.getRandomValues(new Uint8Array(32))] };
  const second = harness(first.factory, first.clock, {}, nextCipher);
  assert.equal(await second.cache.get(key), null);
  assert.equal((await second.cache.stats()).entries, 0);
  assert.equal((await rawStore(first.factory, 'audio')).length, 0);
  assert.equal(await second.cache.put(key, record()), true);
  assert.ok(await second.cache.get(key));
});

test('tampered ciphertext and mismatched authenticated record identifiers are cache misses', async () => {
  const { cache, factory } = harness();
  const key = await cache.keyFor(payload);
  await cache.put(key, record());
  await rawStore(factory, 'audio', ([saved], store) => {
    new Uint8Array(saved.ciphertext)[10] ^= 255;
    store.put(saved);
  });
  assert.equal(await cache.get(key), null);
  assert.equal((await cache.stats()).entries, 0);
  await cache.put(key, record());
  const wrongKey = await cache.keyFor({ ...payload, text: 'Other text' });
  await rawStore(factory, 'audio', ([saved], store) => store.put({ ...saved, key: wrongKey }));
  await rawStore(factory, 'metadata', ([saved], store) => store.put({ ...saved, key: wrongKey }));
  assert.equal(await cache.get(wrongKey), null);
});

test('a missing session encryption key disables persistent caching without plaintext fallback', async () => {
  const { cache, factory } = harness(new IDBFactory(), { now: 100 * day }, {}, null);
  const key = await cache.keyFor(payload);
  assert.equal(await cache.put(key, record()), false);
  assert.equal(await cache.get(key), null);
  assert.equal((await cache.stats()).available, false);
  assert.equal((await rawStore(factory, 'audio')).length, 0);
});

test('database version 2 discards legacy plaintext audio before exposing the cache', async () => {
  const factory = new IDBFactory();
  await new Promise((resolve, reject) => {
    const request = factory.open('hermes-audio-cache', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('audio', { keyPath: 'key' });
      request.result.createObjectStore('metadata', { keyPath: 'key' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['audio', 'metadata'], 'readwrite');
      transaction.objectStore('audio').put({ key: 'a'.repeat(64), ...record() });
      transaction.objectStore('metadata').put({ key: 'a'.repeat(64), bytes: 100, createdAt: 100 * day, usedAt: 100 * day });
      transaction.oncomplete = () => { db.close(); resolve(); };
    };
  });
  const unavailable = harness(factory, { now: 100 * day }, {}, null);
  assert.equal((await unavailable.cache.stats()).available, false);
  assert.equal((await rawStore(factory, 'audio')).length, 0);
  const { cache } = harness(factory);
  assert.equal((await cache.stats()).entries, 0);
  assert.equal((await rawStore(factory, 'audio')).length, 0);
  const key = await cache.keyFor(payload);
  assert.equal(await cache.put(key, record()), true);
  assert.ok(await cache.get(key));
});


test('queued saves keep newer aligned timings and Clear cancels unfinished encryption writes', async () => {
  const { cache } = harness();
  const key = await cache.keyFor(payload);
  const first = record();
  delete first.alignedTimings;
  const writeFirst = cache.put(key, first);
  const writeSecond = cache.put(key, record());
  assert.deepEqual(await Promise.all([writeFirst, writeSecond]), [true, true]);
  assert.deepEqual(Array.from((await cache.get(key)).alignedTimings), record().alignedTimings);
  const pending = cache.put(key, record());
  assert.equal(await cache.clear(), true);
  assert.equal(await pending, false);
  assert.equal((await cache.stats()).entries, 0);
});


test('the imported AES-256 key is nonextractable and remains usable only for encryption and decryption', async () => {
  let imported;
  const subtle = new Proxy(webcrypto.subtle, { get(target, property) {
    if (property === 'importKey') return async (...args) => { imported = await target.importKey(...args); return imported; };
    const method = target[property];
    return typeof method === 'function' ? method.bind(target) : method;
  } });
  const crypto = { subtle, getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) };
  const { cache } = harness(new IDBFactory(), { now: 100 * day }, { crypto });
  const key = await cache.keyFor(payload);
  assert.equal(await cache.put(key, record()), true);
  assert.equal(imported.extractable, false);
  assert.equal(imported.algorithm.name, 'AES-GCM');
  assert.equal(imported.algorithm.length, 256);
  assert.deepEqual(imported.usages, ['encrypt', 'decrypt']);
  await assert.rejects(webcrypto.subtle.exportKey('raw', imported));
  assert.ok(await cache.get(key));
});


test('a timed-out session-key request can recover on the next cache operation', async () => {
  let calls = 0;
  const chrome = { runtime: { sendMessage: async () => {
    calls += 1;
    if (calls === 1) return new Promise(() => {});
    return { cipher: structuredClone(sessionCipher) };
  } } };
  const { cache } = harness(new IDBFactory(), { now: 100 * day }, {
    chrome, setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, 20)),
  });
  assert.equal((await cache.stats()).available, false);
  const key = await cache.keyFor(payload);
  assert.equal(await cache.put(key, record()), true);
  assert.ok(await cache.get(key));
  assert.equal((await cache.stats()).available, true);
  assert.equal(calls, 2, 'a recovered session key should remain memoized');
});
