import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';

const source = await readFile(new URL('../extension/audio-cache.js', import.meta.url), 'utf8');
const day = 24 * 60 * 60 * 1000;
function harness(factory = new IDBFactory(), clock = { now: 100 * day }, timers = {}) {
  const context = { indexedDB: factory, crypto: webcrypto, TextEncoder, Uint8Array, Blob,
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
  for (const change of [{ text: 'Another passage.' }, { voice: 'nova' }, { model: 'tts-1' }, { instructions: 'Biology article.' }]) {
    assert.notEqual(await cache.keyFor({ ...payload, ...change }), key);
  }
  assert.equal(await cache.keyFor({ ...payload, instructions: ' Physics article. ' }), key);
  assert.equal(await cache.keyFor({ ...payload, model: 'tts-1', instructions: 'One' }),
    await cache.keyFor({ ...payload, model: 'tts-1', instructions: 'Two' }));
});

test('completed audio and numeric timings survive a fresh extension document without saving text or credentials', async () => {
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
