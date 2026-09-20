/* Private extension storage: hashed speech inputs, generated audio, numeric timings.
   No credentials, original text, or article URLs are written to this database. */
(() => {
  'use strict';

  const DATABASE = 'hermes-audio-cache';
  const VERSION = 'speech-v1-timing-v1';
  const MAX_BYTES = 32 * 1024 * 1024;
  const MAX_ENTRIES = 256;
  const TTL = 7 * 24 * 60 * 60 * 1000;
  let databasePromise;

  function database() {
    if (databasePromise) return databasePromise;
    if (!globalThis.indexedDB) return Promise.resolve(null);
    databasePromise = new Promise((resolve) => {
      let settled = false;
      const finish = (database) => {
        if (settled) { database?.close(); return; }
        settled = true;
        clearTimeout(timer);
        resolve(database);
      };
      const timer = setTimeout(() => finish(null), 1200);
      try {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('metadata')) db.createObjectStore('metadata', { keyPath: 'key' });
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); databasePromise = null; };
          finish(db);
        };
        request.onerror = () => finish(null);
        request.onblocked = () => finish(null);
      } catch { finish(null); }
    });
    return databasePromise;
  }

  async function keyFor(payload) {
    if (!globalThis.indexedDB || !globalThis.crypto?.subtle) return null;
    const model = String(payload.model || '');
    const canonical = JSON.stringify([VERSION, model, String(payload.voice || ''),
      String(payload.text || ''), model === 'gpt-4o-mini-tts' ? String(payload.instructions || '').trim().slice(0, 1000) : '']);
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
  }

  const validKey = (key) => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
  const validBoundaries = (values, duration) => Array.isArray(values) && values.length >= 2 && values.length <= 4097
    && values.every((value, i) => Number.isFinite(value) && value >= 0 && value <= duration + 0.05
      && (i === 0 || value >= values[i - 1]));

  function validRecord(record) {
    return Boolean(record && record.blob instanceof Blob && record.blob.size >= 44 && record.blob.size <= MAX_BYTES
      && Number.isFinite(record.duration) && record.duration > 0 && record.duration < 1800
      && validBoundaries(record.estimatedTimings, record.duration)
      && (!record.alignedTimings || (record.alignedTimings.length === record.estimatedTimings.length
        && validBoundaries(record.alignedTimings, record.duration))));
  }

  async function transaction(mode, run, fallback) {
    const db = await database();
    if (!db) return fallback;
    return new Promise((resolve) => {
      let value = fallback, tx, settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve(result);
      };
      const timer = setTimeout(() => {
        try { tx?.abort(); } catch { /* The transaction may already be closed. */ }
        finish(fallback);
      }, 1500);
      try {
        tx = db.transaction(['audio', 'metadata'], mode);
        tx.oncomplete = () => finish(value);
        tx.onerror = tx.onabort = () => finish(fallback);
        run(tx.objectStore('audio'), tx.objectStore('metadata'), (result) => { value = result; });
      } catch {
        try { tx?.abort(); } catch { /* Nothing was opened. */ }
        finish(fallback);
      }
    });
  }

  async function get(key) {
    if (!validKey(key)) return null;
    return transaction('readwrite', (audio, metadata, result) => {
      const request = metadata.get(key);
      request.onsuccess = () => {
        const info = request.result;
        if (!info) return;
        const now = Date.now();
        if (!Number.isFinite(info.createdAt) || now - info.createdAt >= TTL) {
          audio.delete(key); metadata.delete(key); return;
        }
        const saved = audio.get(key);
        saved.onsuccess = () => {
          if (!validRecord(saved.result)) { audio.delete(key); metadata.delete(key); return; }
          metadata.put({ ...info, usedAt: now });
          result(saved.result);
        };
      };
    }, null);
  }

  async function put(key, input) {
    if (!validKey(key) || !validRecord(input)) return false;
    // Whitelist fields, so callers cannot accidentally persist payloads or keys.
    const record = { key, blob: input.blob, duration: input.duration,
      estimatedTimings: [...input.estimatedTimings],
      ...(input.alignedTimings ? { alignedTimings: [...input.alignedTimings] } : {}) };
    return transaction('readwrite', (audio, metadata, result) => {
      const request = metadata.getAll();
      request.onsuccess = () => {
        const now = Date.now();
        const previous = request.result.find((item) => item.key === key);
        const current = { key, bytes: record.blob.size,
          createdAt: previous && now - previous.createdAt < TTL ? previous.createdAt : now, usedAt: now };
        const retained = [];
        for (const item of request.result) {
          if (item.key === key) continue;
          if (!Number.isFinite(item.bytes) || now - item.createdAt >= TTL) {
            audio.delete(item.key); metadata.delete(item.key);
          } else retained.push(item);
        }
        retained.push(current);
        retained.sort((a, b) => a.usedAt - b.usedAt);
        let bytes = retained.reduce((sum, item) => sum + item.bytes, 0);
        while (bytes > MAX_BYTES || retained.length > MAX_ENTRIES) {
          const oldest = retained.shift();
          bytes -= oldest.bytes;
          audio.delete(oldest.key); metadata.delete(oldest.key);
        }
        if (!retained.some((item) => item.key === key)) return;
        audio.put(record); metadata.put(current); result(true);
      };
    }, false);
  }

  async function stats() {
    return transaction('readwrite', (audio, metadata, result) => {
      const request = metadata.getAll();
      request.onsuccess = () => {
        const now = Date.now();
        let bytes = 0, entries = 0;
        for (const item of request.result) {
          if (now - item.createdAt >= TTL) { audio.delete(item.key); metadata.delete(item.key); }
          else { bytes += item.bytes; entries += 1; }
        }
        result({ available: true, bytes, entries, maxBytes: MAX_BYTES, maxAgeDays: 7 });
      };
    }, { available: false, bytes: 0, entries: 0, maxBytes: MAX_BYTES, maxAgeDays: 7 });
  }

  async function clear() {
    return transaction('readwrite', (audio, metadata, result) => {
      audio.clear(); metadata.clear(); result(true);
    }, false);
  }

  globalThis.HermesAudioCache = Object.freeze({ keyFor, get, put, stats, clear });
})();
