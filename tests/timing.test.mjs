import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const context = { DataView, Uint8Array };
vm.runInNewContext(await readFile(new URL('../extension/timing.js', import.meta.url), 'utf8'), context);
const { inspectWav, estimate, align } = context.HermesTiming;
const words = (text, starts = []) => text.split(' ').map((word, i) => ({ word, start: starts[i] ?? i, end: (starts[i] ?? i) + 0.5 }));

test('timestamps map punctuation, merged hyphens, and split acronyms to original source words', () => {
  const text = 'GPT-4 improves multi-modal physics.';
  const result = align(text, words('G P T four improves multi modal physics', [0.2, 0.3, 0.4, 0.5, 1, 2, 2.5, 3]), 4);
  assert.ok(result);
  assert.deepEqual(Array.from(result.boundaries), [0.2, 1, 2, 3, 3.5]);
  assert.equal(result.coverage, 1);
});

test('merged transcript words divide their span across original words without shifting later words', () => {
  const result = align('A data set improves physics', words('A dataset improves physics', [0, 0.5, 2, 3]), 4);
  assert.ok(result);
  assert.equal(result.boundaries[1], 0.5);
  assert.ok(result.boundaries[2] > 0.5 && result.boundaries[2] < 1);
  assert.equal(result.boundaries[3], 2);
});

test('minor omissions are interpolated between matching words', () => {
  const text = 'The very tiny model learns scientific patterns from abundant data.';
  const result = align(text, words('The tiny model learns scientific patterns from abundant data', [0, 1, 2, 3, 4, 5, 6, 7, 8]), 9);
  assert.ok(result);
  assert.ok(result.boundaries[1] > 0 && result.boundaries[1] < 1);
  assert.equal(result.boundaries[2], 1);
  assert.equal(result.boundaries[9], 8);
});

test('unreliable, unrelated, and invalid timestamps fall back instead of misleading highlights', () => {
  const text = 'Polygenic prediction estimates inherited genetic risk.';
  assert.equal(align(text, words('Hello welcome to the podcast today'), 8), null);
  assert.equal(align(text, [{ word: 'Polygenic', start: 2, end: 1 }], 8), null);
  assert.equal(align(text, [{ word: 'Polygenic', start: 0, end: 9 }], 8), null);
  assert.equal(align(text, [{ word: 'Polygenic', start: 1, end: 2 }, { word: 'prediction', start: 0, end: 1 }], 8), null);
});

test('estimates ignore detected edge silence and maintain monotonic word boundaries', () => {
  const result = estimate('Tiny models learn. Larger models generalize.', 8, { start: 0.5, end: 7.1 });
  assert.equal(result[0], 0.5);
  assert.ok(Math.abs(result.at(-1) - 7.1) < 0.0001);
  assert.ok(result.every((value, i) => !i || value > result[i - 1]));
});

test('WAV inspection obtains duration and speech window without decoding audio', () => {
  const rate = 1000, frames = 4000;
  const data = new ArrayBuffer(44 + frames * 2);
  const bytes = new Uint8Array(data), view = new DataView(data);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  }
  view.setUint32(4, data.byteLength - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, frames * 2, true);
  for (let i = 500; i < 3200; i += 1) view.setInt16(44 + i * 2, 1000, true);
  const info = inspectWav(data);
  assert.equal(info.duration, 4);
  assert.ok(info.start > 0.4 && info.start < 0.5);
  assert.ok(info.end > 3.2 && info.end < 3.3);
});

test('single words and punctuation-only separators have safe boundaries', () => {
  const result = align('Hello — physics.', words('Hello physics', [0.1, 1]), 2);
  assert.ok(result);
  assert.equal(result.boundaries.length, 4);
  assert.ok(result.boundaries[1] >= 0.1 && result.boundaries[1] <= 1);
  assert.equal(align('Hello!', words('hello', [0.2]), 1).boundaries[0], 0.2);
});
