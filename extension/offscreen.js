/* Audio lives here so closing the popup or changing tabs never interrupts it. */
(() => {
  'use strict';

  const API = 'http://127.0.0.1:43123';
  const CLIENT_HEADER = { 'X-Reader-Client': 'browser-reader-v1' };
  const MAX_REQUESTS = 2;
  const LOOKAHEAD = 3;
  const cache = new Map();
  const queue = [];
  let activeRequests = 0;
  let generation = 0;
  let operation = 0;
  let sessionId = null;
  let tabId = null;
  let chunks = [];
  let totalWords = 0;
  let wordIndex = 0;
  let settings = { speed: 1, voice: 'coral', model: 'gpt-4o-mini-tts' };
  let status = 'idle';
  let error = null;
  let wantsPlayback = false;
  let audio = null;
  let currentChunk = -1;
  let lastPublishedWord = -1;
  let lastPublishedAt = 0;

  function state() {
    return { status, wordIndex, totalWords, ...settings, error };
  }

  function publish(force = true) {
    if (sessionId === null) return;
    const now = Date.now();
    if (!force && wordIndex === lastPublishedWord && now - lastPublishedAt < 1000) return;
    lastPublishedWord = wordIndex;
    lastPublishedAt = now;
    try {
      const sent = chrome.runtime.sendMessage({
        target: 'background', type: 'state', sessionId, tabId, state: state(),
      });
      if (sent?.catch) sent.catch(() => {});
    } catch { /* The worker can be asleep; the next state event wakes it. */ }
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = status === 'playing' ? 'playing'
        : status === 'paused' || status === 'loading' ? 'paused' : 'none';
    }
  }

  function speed(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0.75, Math.min(4, number)) : settings.speed;
  }

  function abortError() {
    return new DOMException('Playback changed', 'AbortError');
  }

  function destroyAudio() {
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio = null;
    currentChunk = -1;
  }

  function release(entry) {
    entry.controller?.abort();
    if (entry.url) URL.revokeObjectURL(entry.url);
    if (entry.phase === 'queued') entry.reject(abortError());
  }

  function clearCache() {
    generation += 1;
    for (const entry of cache.values()) release(entry);
    cache.clear();
    queue.length = 0;
  }

  function fail(cause) {
    wantsPlayback = false;
    operation += 1;
    destroyAudio();
    clearCache();
    status = 'error';
    error = cause?.message || 'Audio could not be played. Please try again.';
    publish();
  }

  // A WAV's sample count supplies its duration without an AudioContext decode.
  // Some providers use an unknown data length while streaming; use bytes received.
  function wavDuration(buffer) {
    const view = new DataView(buffer);
    const fourCC = (offset) => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
    if (buffer.byteLength < 44 || fourCC(0) !== 'RIFF' || fourCC(8) !== 'WAVE') return 0;
    let bytesPerSecond = 0;
    for (let offset = 12; offset + 8 <= buffer.byteLength;) {
      const kind = fourCC(offset);
      const declaredSize = view.getUint32(offset + 4, true);
      const available = buffer.byteLength - offset - 8;
      if (kind === 'fmt ' && available >= 16) bytesPerSecond = view.getUint32(offset + 16, true);
      if (kind === 'data' && bytesPerSecond) return Math.min(declaredSize, available) / bytesPerSecond;
      offset += 8 + declaredSize + (declaredSize % 2);
    }
    return 0;
  }

  function buildTimings(text, duration) {
    const words = text.match(/\S+/gu) || [];
    const weights = words.map((word) => {
      const letters = word.replace(/[^\p{L}\p{N}]/gu, '').length;
      return 0.65 + Math.min(letters, 18) * 0.085
        + (/[.!?]["')\]]*$/.test(word) ? 0.8 : /[,;:]["')\]]*$/.test(word) ? 0.35 : 0);
    });
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    let accumulated = 0;
    const boundaries = [0];
    for (const weight of weights) {
      accumulated += weight;
      boundaries.push(accumulated / sum * duration);
    }
    return boundaries;
  }

  function chunkForWord(index) {
    const found = chunks.findIndex((chunk) => index >= chunk.start && index < chunk.end);
    return found >= 0 ? found : Math.max(0, chunks.length - 1);
  }

  function updateWord() {
    if (!audio || !['playing', 'paused'].includes(status)
      || currentChunk < 0 || !Number.isFinite(audio.currentTime)) return;
    const entry = cache.get(currentChunk);
    if (!entry?.timings?.length) return;
    let low = 0;
    let high = entry.timings.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (entry.timings[middle] <= audio.currentTime) low = middle;
      else high = middle - 1;
    }
    const chunk = chunks[currentChunk];
    wordIndex = Math.min(chunk.end - 1, chunk.start + low);
  }

  async function requestSpeech(entry) {
    const controller = new AbortController();
    entry.controller = controller;
    // A hung local service must not leave playback stuck in Loading indefinitely.
    const timeout = setTimeout(() => controller.abort('timeout'), 90000);
    try {
      const response = await fetch(`${API}/v1/speech`, {
        method: 'POST',
        headers: { ...CLIENT_HEADER, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: entry.text, voice: entry.voice, model: entry.model }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let detail;
        try {
          const payload = await response.json();
          detail = typeof payload.error === 'string' ? payload.error : payload.error?.message;
        } catch { /* A proxy may send a plain status response. */ }
        throw new Error(detail || `Speech request failed (${response.status}). Check the local reader service.`);
      }
      const buffer = await response.arrayBuffer();
      if (entry.generation !== generation || cache.get(entry.index) !== entry) throw abortError();
      if (buffer.byteLength < 44) throw new Error('The speech service returned empty audio. Please try again.');
      entry.duration = wavDuration(buffer);
      entry.timings = buildTimings(entry.text, entry.duration);
      entry.url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
      return entry;
    } catch (cause) {
      if (controller.signal.aborted && controller.signal.reason === 'timeout') {
        throw new Error('The speech request timed out. Check your connection and try again.');
      }
      if (cause instanceof TypeError) {
        throw new Error('The local reader service is unavailable. Start it, or choose the built-in voice.');
      }
      throw cause;
    } finally {
      clearTimeout(timeout);
    }
  }

  function pump() {
    while (activeRequests < MAX_REQUESTS && queue.length) {
      const entry = queue.shift();
      if (entry.generation !== generation || cache.get(entry.index) !== entry) continue;
      activeRequests += 1;
      entry.phase = 'fetching';
      requestSpeech(entry).then((result) => {
        entry.phase = 'ready';
        entry.resolve(result);
      }, (cause) => {
        entry.phase = 'failed';
        if (cache.get(entry.index) === entry) cache.delete(entry.index);
        entry.reject(cause);
      }).finally(() => {
        activeRequests -= 1;
        pump();
      });
    }
  }

  function ensureChunk(index, priority = false) {
    let entry = cache.get(index);
    if (entry) {
      if (priority && entry.phase === 'queued') {
        const position = queue.indexOf(entry);
        if (position >= 0) queue.splice(position, 1);
        queue.unshift(entry);
      }
      pump();
      return entry.promise;
    }
    const chunk = chunks[index];
    entry = {
      index, generation, text: chunk.text, voice: settings.voice, model: settings.model,
      phase: 'queued', url: null, duration: 0, timings: null,
    };
    entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
    // Lookahead failures are surfaced only if this chunk is actually played.
    entry.promise.catch(() => {});
    cache.set(index, entry);
    if (priority) queue.unshift(entry);
    else queue.push(entry);
    pump();
    return entry.promise;
  }

  function maintainCache(index) {
    for (const [key, entry] of cache) {
      if (key < index - 1 || key > index + LOOKAHEAD) {
        release(entry);
        cache.delete(key);
      }
    }
    for (let next = index + 1; next <= Math.min(chunks.length - 1, index + LOOKAHEAD); next += 1) {
      ensureChunk(next).catch(() => {});
    }
  }

  function waitForMetadata(player) {
    if (player.readyState >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        player.removeEventListener('loadedmetadata', ready);
        player.removeEventListener('error', failed);
        player.removeEventListener('emptied', cancelled);
      };
      const ready = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('The returned audio could not be decoded.')); };
      const cancelled = () => { cleanup(); reject(abortError()); };
      player.addEventListener('loadedmetadata', ready, { once: true });
      player.addEventListener('error', failed, { once: true });
      player.addEventListener('emptied', cancelled, { once: true });
      timer = setTimeout(failed, 15000);
    });
  }

  async function startAtWord() {
    if (!wantsPlayback || !chunks.length) return;
    if (settings.model === 'local') {
      fail(new Error('The built-in voice must be played by the extension background worker.'));
      return;
    }
    const thisOperation = ++operation;
    const thisGeneration = generation;
    const targetWord = wordIndex;
    const index = chunkForWord(targetWord);
    destroyAudio();
    status = 'loading';
    error = null;
    publish();
    try {
      const pending = ensureChunk(index, true);
      // Start the requested chunk first, then overlap bounded preparation.
      maintainCache(index);
      const entry = await pending;
      if (thisOperation !== operation || thisGeneration !== generation || !wantsPlayback) return;
      const player = new Audio(entry.url);
      audio = player;
      currentChunk = index;
      player.preload = 'auto';
      player.preservesPitch = true;
      player.playbackRate = settings.speed;
      player.onended = () => {
        if (audio !== player || !wantsPlayback) return;
        if (index + 1 >= chunks.length) {
          wordIndex = totalWords ? totalWords - 1 : 0;
          wantsPlayback = false;
          status = 'ended';
          publish();
          return;
        }
        wordIndex = chunks[index + 1].start;
        startAtWord();
      };
      player.onerror = () => {
        if (audio === player) {
          fail(new Error('Audio playback failed. Please try again.'));
        }
      };
      await waitForMetadata(player);
      if (thisOperation !== operation || thisGeneration !== generation || !wantsPlayback) return;
      if (Number.isFinite(player.duration) && player.duration > 0) {
        entry.duration = player.duration;
        entry.timings = buildTimings(entry.text, player.duration);
      }
      const offset = Math.max(0, Math.min(entry.timings.length - 2, targetWord - chunks[index].start));
      player.currentTime = entry.timings[offset] || 0;
      await player.play();
      if (thisOperation !== operation || !wantsPlayback) {
        if (audio !== player || !wantsPlayback) player.pause();
        return;
      }
      status = 'playing';
      publish();
    } catch (cause) {
      if (thisOperation !== operation || thisGeneration !== generation || cause?.name === 'AbortError') return;
      fail(cause);
    }
  }

  function play() {
    if (!chunks.length) return;
    if (wantsPlayback && (status === 'playing' || status === 'loading')) return;
    if (status === 'ended') wordIndex = 0;
    wantsPlayback = true;
    error = null;
    if (audio && status === 'paused' && audio.readyState >= 1) {
      const player = audio;
      const thisOperation = operation;
      player.playbackRate = settings.speed;
      player.play().then(() => {
        if (!wantsPlayback || audio !== player || operation !== thisOperation) {
          if (audio !== player || !wantsPlayback) player.pause();
          return;
        }
        status = 'playing';
        publish();
      }).catch((cause) => {
        if (audio === player && wantsPlayback && operation === thisOperation) fail(cause);
      });
    } else startAtWord();
  }

  function pause() {
    wantsPlayback = false;
    operation += 1;
    if (status === 'loading') {
      destroyAudio();
    } else if (audio) {
      updateWord();
      audio.pause();
    }
    status = chunks.length ? 'paused' : 'idle';
    publish();
  }

  function stop() {
    wantsPlayback = false;
    operation += 1;
    destroyAudio();
    clearCache();
    wordIndex = 0;
    status = 'idle';
    error = null;
    publish();
  }

  function seek(value) {
    const requested = Number(value);
    if (!Number.isFinite(requested) || !chunks.length) return;
    wordIndex = Math.max(0, Math.min(totalWords - 1, Math.floor(requested)));
    operation += 1;
    destroyAudio();
    error = null;
    if (wantsPlayback) startAtWord();
    else {
      status = 'paused';
      publish();
    }
  }

  function configure(next = {}) {
    updateWord();
    const changedVoice = next.voice !== undefined && next.voice !== settings.voice;
    const changedModel = next.model !== undefined && next.model !== settings.model;
    settings = {
      speed: next.speed === undefined ? settings.speed : speed(next.speed),
      voice: typeof next.voice === 'string' && next.voice ? next.voice : settings.voice,
      model: typeof next.model === 'string' && next.model ? next.model : settings.model,
    };
    if (changedVoice || changedModel) {
      operation += 1;
      destroyAudio();
      clearCache();
      if (wantsPlayback) startAtWord();
      else publish();
    } else {
      if (audio) audio.playbackRate = settings.speed;
      publish();
    }
  }

  function load(message) {
    wantsPlayback = false;
    operation += 1;
    destroyAudio();
    clearCache();
    sessionId = message.sessionId;
    tabId = message.tabId;
    chunks = Array.isArray(message.chunks) ? message.chunks.filter((chunk) =>
      typeof chunk.text === 'string' && chunk.text.trim() && Number.isInteger(chunk.start)
      && Number.isInteger(chunk.end) && chunk.end > chunk.start) : [];
    totalWords = chunks.length ? Math.max(0, Number(message.totalWords) || chunks.at(-1).end) : 0;
    wordIndex = 0;
    status = 'idle';
    error = null;
    configure(message.settings || {});
    if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Browser Reader', artist: 'Article narration' });
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== 'offscreen') return;
    // Content scripts must route their requests through the trusted worker.
    if (sender?.tab) return;
    try {
      switch (message.action) {
        case 'load': load(message); break;
        case 'play': play(); break;
        case 'pause': pause(); break;
        case 'stop': stop(); break;
        case 'seek': seek(message.wordIndex); break;
        case 'settings': configure(message.settings || {}); break;
        case 'snapshot': break;
        default: sendResponse({ ok: false, error: 'Unknown audio command' }); return;
      }
      sendResponse({ ok: true, state: state() });
    } catch (cause) {
      sendResponse({ ok: false, error: cause.message });
    }
    return false;
  });

  setInterval(() => {
    if (status !== 'playing' || !audio) return;
    updateWord();
    publish(false);
  }, 80);

  if ('mediaSession' in navigator) {
    for (const [action, handler] of Object.entries({
      play, pause, stop,
      seekbackward: () => seek(wordIndex - 35),
      seekforward: () => seek(wordIndex + 35),
      previoustrack: () => seek(chunks[Math.max(0, chunkForWord(wordIndex) - 1)]?.start || 0),
      nexttrack: () => seek(chunks[Math.min(chunks.length - 1, chunkForWord(wordIndex) + 1)]?.start || 0),
    })) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Browser support varies. */ }
    }
  }
})();
