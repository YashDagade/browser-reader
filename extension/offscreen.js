/* Audio lives here so closing the popup or changing tabs never interrupts it. */
(() => {
  'use strict';

  const timing = globalThis.HermesTiming;
  const MAX_REQUESTS = 2;
  const LOOKAHEAD = 3;
  const MAX_CACHE_BYTES = 12 * 1024 * 1024;
  const alignmentQueue = [];
  let activeAlignments = 0;
  let tickTimer = null;
  let secondsPerWord = 0.36;
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
  let settings = { speed: 1, voice: 'alloy', model: 'gpt-4o-mini-tts', instructions: '', syncMode: 'precise' };
  let status = 'idle';
  let error = null;
  let wantsPlayback = false;
  let audio = null;
  let currentChunk = -1;
  let lastPublishedWord = -1;
  let lastPublishedAt = 0;

  function remainingSeconds() {
    if (!totalWords || status === 'ended') return 0;
    const index = audio ? currentChunk : chunkForWord(wordIndex);
    const chunk = chunks[index];
    if (!chunk) return 0;
    const entry = cache.get(index);
    const offset = Math.max(0, wordIndex - chunk.start);
    const elapsed = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : entry?.timings?.[offset] || 0;
    let knownWords = 0, knownSeconds = 0;
    if (entry?.duration) {
      knownWords = chunk.end - wordIndex;
      knownSeconds = Math.max(0, entry.duration - elapsed);
    }
    // The cache contains at most a few chunks; never walk the article per tick.
    for (const [key, upcoming] of cache) {
      if (key > index && upcoming.duration) {
        knownWords += chunks[key].end - chunks[key].start;
        knownSeconds += upcoming.duration;
      }
    }
    return Math.max(0, (knownSeconds + Math.max(0, totalWords - wordIndex - knownWords) * secondsPerWord) / settings.speed);
  }

  function state() {
    const entry = cache.get(audio ? currentChunk : chunkForWord(wordIndex));
    return { status, wordIndex, totalWords, ...settings, error,
      timingSource: settings.syncMode === 'precise' && entry?.timingSource === 'aligned' ? 'aligned' : 'estimated',
      remainingSeconds: remainingSeconds() };
  }

  function stopTick() {
    if (tickTimer !== null) clearInterval(tickTimer);
    tickTimer = null;
  }

  function startTick() {
    stopTick();
    tickTimer = setInterval(() => {
      if (status !== 'playing' || !audio) { stopTick(); return; }
      updateWord();
      publish(false);
    }, 40);
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
    stopTick();
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
    cancelEntryAlignment(entry);
    const queuedSpeech = queue.indexOf(entry);
    if (queuedSpeech >= 0) queue.splice(queuedSpeech, 1);
    const queuedAlignment = alignmentQueue.indexOf(entry);
    if (queuedAlignment >= 0) alignmentQueue.splice(queuedAlignment, 1);
    entry.blob = null;
    if (entry.url) URL.revokeObjectURL(entry.url);
    entry.url = null;
    if (entry.phase === 'queued') entry.reject(abortError());
  }

  function clearCache() {
    generation += 1;
    for (const entry of cache.values()) release(entry);
    cache.clear();
    queue.length = 0;
    alignmentQueue.length = 0;
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

  function chunkForWord(index) {
    let low = 0, high = chunks.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (chunks[middle].end <= index) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function cancelEntryAlignment(entry) {
    entry.alignmentEpoch = (entry.alignmentEpoch || 0) + 1;
    entry.alignmentController?.abort();
    entry.alignmentController = null;
    if (entry.alignmentPhase !== 'ready') entry.alignmentPhase = null;
  }

  function cancelAlignments() {
    alignmentQueue.length = 0;
    for (const entry of cache.values()) cancelEntryAlignment(entry);
  }

  function scheduleAlignment(entry, priority = false) {
    if (settings.syncMode !== 'precise' || !entry.blob || !globalThis.HermesSpeech?.align
      || entry.alignmentPhase === 'ready' || entry.alignmentPhase === 'fetching') return;
    const existing = alignmentQueue.indexOf(entry);
    if (existing >= 0) alignmentQueue.splice(existing, 1);
    entry.alignmentPhase = 'queued';
    if (priority) alignmentQueue.unshift(entry);
    else alignmentQueue.push(entry);
    pumpAlignment();
  }

  function pumpAlignment() {
    if (activeAlignments || !wantsPlayback || settings.syncMode !== 'precise') return;
    const entry = alignmentQueue.shift();
    if (!entry) return;
    if (entry.generation !== generation || cache.get(entry.index) !== entry || !entry.blob) {
      pumpAlignment();
      return;
    }
    const epoch = entry.alignmentEpoch || 0;
    const controller = new AbortController();
    entry.alignmentController = controller;
    entry.alignmentPhase = 'fetching';
    activeAlignments += 1;
    const timeout = setTimeout(() => controller.abort('timeout'), 60000);
    (async () => {
      const buffer = await entry.blob.arrayBuffer();
      if (controller.signal.aborted) return;
      const result = await globalThis.HermesSpeech.align(entry.payload, buffer, controller.signal);
      if (controller.signal.aborted || epoch !== (entry.alignmentEpoch || 0)
        || entry.generation !== generation || cache.get(entry.index) !== entry || settings.syncMode !== 'precise') return;
      const aligned = timing.align(entry.text, result?.words, entry.duration, entry.estimatedTimings);
      entry.alignmentPhase = 'ready';
      if (aligned) {
        entry.alignedTimings = aligned.boundaries;
        entry.timings = aligned.boundaries;
        entry.timingSource = 'aligned';
        persistAudio(entry);
        if (entry.index === currentChunk && status === 'playing') {
          updateWord();
          publish();
        }
      }
    })().catch(() => {
      // Alignment improves navigation, but never blocks or fails speech playback.
      if (epoch === (entry.alignmentEpoch || 0)) entry.alignmentPhase = 'ready';
    }).finally(() => {
      clearTimeout(timeout);
      if (entry.alignmentController === controller) entry.alignmentController = null;
      activeAlignments -= 1;
      pumpAlignment();
    });
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

  function persistAudio(entry) {
    if (!entry.diskKey || !entry.blob || !globalThis.HermesAudioCache) return;
    // IndexedDB stores a Blob reference and numeric timings, never source text.
    const saved = { blob: entry.blob, duration: entry.duration,
      estimatedTimings: entry.estimatedTimings,
      ...(entry.alignedTimings ? { alignedTimings: entry.alignedTimings } : {}) };
    Promise.resolve(globalThis.HermesAudioCache.put(entry.diskKey, saved)).catch(() => {});
  }

  function installAudio(entry) {
    entry.bytes = entry.blob.size;
    entry.timings = settings.syncMode === 'precise' && entry.alignedTimings ? entry.alignedTimings : entry.estimatedTimings;
    entry.timingSource = entry.alignedTimings ? 'aligned' : 'estimated';
    if (entry.alignedTimings) entry.alignmentPhase = 'ready';
    entry.url = URL.createObjectURL(entry.blob);
    secondsPerWord = secondsPerWord * 0.65 + entry.duration / Math.max(1, chunks[entry.index].end - chunks[entry.index].start) * 0.35;
    enforceByteBudget();
    if (cache.get(entry.index) !== entry) throw abortError();
    scheduleAlignment(entry, entry.index === chunkForWord(wordIndex));
    return entry;
  }

  async function requestSpeech(entry) {
    const controller = new AbortController();
    entry.controller = controller;
    // A hung local service must not leave playback stuck in Loading indefinitely.
    const timeout = setTimeout(() => controller.abort('timeout'), 90000);
    try {
      if (globalThis.HermesAudioCache) {
        try {
          entry.diskKey = await globalThis.HermesAudioCache.keyFor(entry.payload);
          const saved = entry.diskKey ? await globalThis.HermesAudioCache.get(entry.diskKey) : null;
          if (entry.generation !== generation || cache.get(entry.index) !== entry || controller.signal.aborted) throw abortError();
          if (saved?.blob?.size <= MAX_CACHE_BYTES && saved.estimatedTimings?.length === chunks[entry.index].end - chunks[entry.index].start + 1) {
            entry.duration = saved.duration;
            entry.estimatedTimings = saved.estimatedTimings;
            entry.alignedTimings = saved.alignedTimings || null;
            entry.blob = saved.blob;
            return installAudio(entry);
          }
        } catch (cause) {
          if (cause?.name === 'AbortError') throw cause;
          // Quota restrictions or disabled storage never prevent reading.
        }
      }
      if (entry.generation !== generation || cache.get(entry.index) !== entry || controller.signal.aborted) throw abortError();
      if (!globalThis.HermesSpeech?.speech) throw new Error('The speech connection could not be loaded. Reload the extension.');
      const response = await globalThis.HermesSpeech.speech(entry.payload, controller.signal);
      if (!response.ok) {
        let detail;
        try {
          const payload = await response.json();
          detail = typeof payload.error === 'string' ? payload.error : payload.error?.message;
        } catch { /* A proxy may send a plain status response. */ }
        throw new Error(detail || `Speech request failed (${response.status}). Check the speech connection in settings.`);
      }
      const buffer = await response.arrayBuffer();
      if (entry.generation !== generation || cache.get(entry.index) !== entry) throw abortError();
      if (buffer.byteLength < 44) throw new Error('The speech service returned empty audio. Please try again.');
      if (buffer.byteLength > MAX_CACHE_BYTES) throw new Error('This audio passage is too large. Try a shorter selection.');
      entry.window = timing.inspectWav(buffer);
      entry.duration = entry.window.duration;
      if (!entry.duration) throw new Error('The speech service returned unsupported audio. Please try again.');
      entry.estimatedTimings = timing.estimate(entry.text, entry.duration, entry.window);
      entry.blob = new Blob([buffer], { type: 'audio/wav' });
      // Save only complete, validated responses. Playback does not await disk I/O.
      persistAudio(entry);
      return installAudio(entry);
    } catch (cause) {
      if (controller.signal.aborted && controller.signal.reason === 'timeout') {
        throw new Error('The speech request timed out. Check your connection and try again.');
      }
      if (cause instanceof TypeError) {
        throw new Error('The speech connection is unavailable. Check settings, or choose the built-in voice.');
      }
      throw cause;
    } finally {
      clearTimeout(timeout);
    }
  }

  function pump() {
    while (wantsPlayback && activeRequests < MAX_REQUESTS && queue.length) {
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
      index, generation, text: chunk.text,
      payload: { text: chunk.text, voice: settings.voice, model: settings.model, instructions: settings.instructions },
      phase: 'queued', url: null, blob: null, bytes: 0, duration: 0, timings: null,
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

  function enforceByteBudget() {
    let bytes = 0;
    for (const entry of cache.values()) bytes += entry.bytes || 0;
    const target = audio ? currentChunk : chunkForWord(wordIndex);
    const removable = [...cache.entries()].filter(([index]) => index !== target)
      .sort(([a], [b]) => Math.abs(b - target) - Math.abs(a - target));
    for (const [index, entry] of removable) {
      if (bytes <= MAX_CACHE_BYTES) break;
      bytes -= entry.bytes || 0;
      release(entry);
      cache.delete(index);
    }
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
          destroyAudio();
          clearCache();
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
        if (Math.abs(entry.duration - player.duration) > 0.1) {
          entry.duration = player.duration;
          entry.estimatedTimings = timing.estimate(entry.text, player.duration, entry.window);
          if (entry.timingSource !== 'aligned') entry.timings = entry.estimatedTimings;
        }
      }
      const offset = Math.max(0, Math.min(entry.timings.length - 2, targetWord - chunks[index].start));
      player.currentTime = entry.timings[offset] || 0;
      await player.play();
      if (thisOperation !== operation || !wantsPlayback) {
        if (audio !== player || !wantsPlayback) player.pause();
        return;
      }
      status = 'playing';
      startTick();
      scheduleAlignment(entry, true);
      pumpAlignment();
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
        startTick();
        const entry = cache.get(currentChunk);
        if (entry) scheduleAlignment(entry, true);
        pumpAlignment();
        publish();
      }).catch((cause) => {
        if (audio === player && wantsPlayback && operation === thisOperation) fail(cause);
      });
    } else startAtWord();
  }

  function pause() {
    stopTick();
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
    cancelAlignments();
    // A paused jump must also cancel unrelated preparation.
    const index = chunkForWord(wordIndex);
    for (const [key, entry] of cache) {
      if (key < index - 1 || key > index + LOOKAHEAD) { release(entry); cache.delete(key); }
    }
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
    const changedInstructions = next.instructions !== undefined && next.instructions !== settings.instructions;
    const oldSyncMode = settings.syncMode;
    settings = {
      speed: next.speed === undefined ? settings.speed : speed(next.speed),
      voice: typeof next.voice === 'string' && next.voice ? next.voice : settings.voice,
      model: typeof next.model === 'string' && next.model ? next.model : settings.model,
      instructions: typeof next.instructions === 'string' ? next.instructions.slice(0, 1500) : settings.instructions,
      syncMode: next.syncMode === 'estimated' ? 'estimated' : next.syncMode === 'precise' ? 'precise' : settings.syncMode,
    };
    if (changedVoice || changedModel || changedInstructions) {
      operation += 1;
      destroyAudio();
      clearCache();
      if (wantsPlayback) startAtWord();
      else publish();
    } else {
      if (oldSyncMode !== settings.syncMode) {
        cancelAlignments();
        for (const entry of cache.values()) {
          if (settings.syncMode === 'estimated') entry.timings = entry.estimatedTimings;
          else if (entry.alignedTimings) entry.timings = entry.alignedTimings;
          else scheduleAlignment(entry, entry.index === currentChunk);
        }
      }
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
    secondsPerWord = 0.36;
    status = 'idle';
    error = null;
    configure(message.settings || {});
    if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Hermes', artist: 'Article narration' });
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
        case 'unload': sessionId = null; stop(); chunks = []; totalWords = 0; tabId = null; break;
        case 'seek': seek(message.wordIndex); break;
        case 'settings': configure(message.settings || {}); break;
        case 'snapshot': break;
        case 'get-state': sendResponse({ ok: true, state: { sessionId, ...state() } }); return false;
        default: sendResponse({ ok: false, error: 'Unknown audio command' }); return;
      }
      sendResponse({ ok: true, state: state() });
    } catch (cause) {
      sendResponse({ ok: false, error: cause.message });
    }
    return false;
  });

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
