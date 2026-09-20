/* Small, deterministic word timing utilities. No model runs in the browser. */
(() => {
  'use strict';

  const tokens = (text) => text.match(/\S+/gu) || [];
  const digits = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const normalized = (word) => word.normalize('NFKC').toLowerCase()
    .replace(/\d/gu, (digit) => digits[Number(digit)])
    .replace(/[^\p{L}\p{N}]/gu, '');
  const weight = (word) => 0.65 + Math.min(word.replace(/[^\p{L}\p{N}]/gu, '').length, 18) * 0.085
    + (/[.!?]["')\]]*$/.test(word) ? 0.8 : /[,;:]["')\]]*$/.test(word) ? 0.35 : 0);

  // Reading the PCM envelope is substantially cheaper than decoding a second copy.
  // The coarse scan ignores tiny edge noise and keeps a little breathing room.
  function inspectWav(buffer) {
    const empty = { duration: 0, start: 0, end: 0 };
    if (!(buffer?.byteLength >= 44)) return empty;
    const view = new DataView(buffer);
    const tag = (offset) => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return empty;
    let format = 0, channels = 0, rate = 0, bytesPerSecond = 0, bits = 0, dataOffset = 0, dataSize = 0;
    for (let offset = 12; offset + 8 <= buffer.byteLength;) {
      const kind = tag(offset);
      const size = view.getUint32(offset + 4, true);
      const available = buffer.byteLength - offset - 8;
      if (kind === 'fmt ' && available >= 16) {
        format = view.getUint16(offset + 8, true);
        channels = view.getUint16(offset + 10, true);
        rate = view.getUint32(offset + 12, true);
        bytesPerSecond = view.getUint32(offset + 16, true);
        bits = view.getUint16(offset + 22, true);
      }
      if (kind === 'data') { dataOffset = offset + 8; dataSize = Math.min(size, available); break; }
      offset += 8 + size + size % 2;
    }
    const duration = bytesPerSecond ? dataSize / bytesPerSecond : 0;
    if (!duration || format !== 1 || bits !== 16 || !channels || !rate) return { duration, start: 0, end: duration };
    const frameSize = channels * 2;
    const frames = Math.floor(dataSize / frameSize);
    const step = Math.max(1, Math.floor(rate / 1000));
    let first = -1, last = -1;
    // Limit inspection to the two ends; long articles do not mean long scans.
    const edgeFrames = Math.min(frames, Math.ceil(rate * 2));
    const audible = (frame) => {
      for (let channel = 0; channel < channels; channel += 1) {
        if (Math.abs(view.getInt16(dataOffset + frame * frameSize + channel * 2, true)) > 220) return true;
      }
      return false;
    };
    for (let frame = 0; frame < edgeFrames; frame += step) {
      if (audible(frame)) { first = frame; break; }
    }
    for (let frame = frames - 1; frame >= frames - edgeFrames; frame -= step) {
      if (audible(frame)) { last = frame; break; }
    }
    if (first < 0 || last < first) return { duration, start: 0, end: duration };
    return { duration, start: Math.max(0, first / rate - 0.035), end: Math.min(duration, last / rate + 0.08) };
  }

  function estimate(text, duration, window = {}) {
    const weights = tokens(text).map(weight);
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const start = Math.max(0, Math.min(duration, window.start || 0));
    const end = Math.max(start, Math.min(duration, window.end || duration));
    const boundaries = [start];
    let accumulated = 0;
    for (const item of weights) {
      accumulated += item;
      boundaries.push(start + accumulated / sum * (end - start));
    }
    return boundaries;
  }

  function similar(left, right) {
    if (left === right) return 1;
    if (Math.min(left.length, right.length) < 5 || Math.abs(left.length - right.length) > 2) return 0;
    // Permit a transcription typo, but do not turn unrelated jargon into anchors.
    const previous = Array.from({ length: right.length + 1 }, (_, i) => i);
    for (let i = 1; i <= left.length; i += 1) {
      let diagonal = previous[0];
      previous[0] = i;
      for (let j = 1; j <= right.length; j += 1) {
        const old = previous[j];
        previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1,
          diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
        diagonal = old;
      }
    }
    return previous[right.length] <= Math.max(1, Math.floor(Math.max(left.length, right.length) * 0.12)) ? 0.85 : 0;
  }

  function align(text, timestampWords, duration, estimated = estimate(text, duration)) {
    const originals = tokens(text);
    const source = originals.map((word, index) => ({ key: normalized(word), index })).filter((word) => word.key);
    if (!source.length || !Array.isArray(timestampWords) || !duration) return null;
    let previous = -1;
    const spoken = [];
    for (const word of timestampWords) {
      const key = normalized(String(word.word ?? ''));
      const start = Number(word.start), end = Number(word.end);
      if (!key) continue;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < -0.05 || end < start
        || end > duration + 0.3 || start < previous - 0.05) return null;
      previous = start;
      spoken.push({ key, start: Math.max(0, start), end: Math.min(duration, end) });
    }
    if (!spoken.length || spoken.length > source.length * 8 + 20) return null;

    // Monotone token alignment, allowing merged hyphens and split acronyms.
    // A bounded match window avoids quadratic work on long passages.
    const anchors = [];
    let left = 0, right = 0, matchedLetters = 0, matchedWords = 0;
    while (left < source.length && right < spoken.length) {
      let match = null;
      for (let skip = 0; skip <= 5 && !match; skip += 1) {
        const choices = [];
        for (let a = 0; a <= skip; a += 1) {
          const b = skip - a;
          if (left + a >= source.length || right + b >= spoken.length) continue;
          let sourceKey = '';
          for (let takeA = 1; takeA <= 3 && left + a + takeA <= source.length; takeA += 1) {
            sourceKey += source[left + a + takeA - 1].key;
            let spokenKey = '';
            for (let takeB = 1; takeB <= 6 && right + b + takeB <= spoken.length; takeB += 1) {
              spokenKey += spoken[right + b + takeB - 1].key;
              const confidence = sourceKey === spokenKey ? 1
                : takeA === 1 && takeB === 1 ? similar(sourceKey, spokenKey) : 0;
              if (confidence) choices.push({ a, b, takeA, takeB, confidence });
            }
          }
        }
        choices.sort((a, b) => b.confidence - a.confidence || (a.takeA + a.takeB) - (b.takeA + b.takeB));
        match = choices[0] || null;
      }
      if (!match) { left += 1; right += 1; continue; }
      left += match.a;
      right += match.b;
      const start = spoken[right].start;
      const end = spoken[right + match.takeB - 1].end;
      const group = source.slice(left, left + match.takeA);
      const letters = group.reduce((sum, word) => sum + word.key.length, 0);
      let position = 0;
      for (const word of group) {
        anchors.push({ index: word.index, start: start + (end - start) * position / letters });
        position += word.key.length;
      }
      matchedLetters += letters * match.confidence;
      matchedWords += match.takeA * match.confidence;
      left += match.takeA;
      right += match.takeB;
    }
    const coverage = matchedLetters / source.reduce((sum, word) => sum + word.key.length, 0);
    if (coverage < 0.82 || matchedWords / source.length < 0.75 || anchors.length < Math.min(2, source.length)) return null;
    const boundaries = [...estimated];
    for (const anchor of anchors) boundaries[anchor.index] = anchor.start;
    // Fill omissions between trustworthy anchors using the estimated relative pace.
    const brackets = [{ index: -1, start: 0 }, ...anchors, { index: originals.length, start: Math.min(duration, spoken.at(-1).end) }];
    for (let at = 0; at < brackets.length - 1; at += 1) {
      const first = brackets[at], last = brackets[at + 1];
      const base = first.index < 0 ? 0 : estimated[first.index];
      const span = estimated[last.index] - base;
      for (let i = first.index + 1; i < last.index; i += 1) {
        const fraction = span > 0 ? (estimated[i] - base) / span : 0;
        boundaries[i] = first.start + Math.max(0, Math.min(1, fraction)) * (last.start - first.start);
      }
    }
    boundaries[originals.length] = Math.max(boundaries[originals.length - 1], Math.min(duration, spoken.at(-1).end));
    for (let i = 1; i < boundaries.length; i += 1) boundaries[i] = Math.max(boundaries[i - 1], boundaries[i]);
    return { boundaries, coverage };
  }

  globalThis.HermesTiming = Object.freeze({ inspectWav, estimate, align });
})();
