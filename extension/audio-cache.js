/* Encrypted, session-only replay cache. The background keeps the AES key in
   chrome.storage.session; IndexedDB receives ciphertext and opaque metadata only. */
(() => {
  'use strict';

  const DATABASE = 'hermes-audio-cache';
  const VERSION = 'speech-v1-timing-v1';
  const MAX_BYTES = 32 * 1024 * 1024;
  const MAX_ENTRIES = 256;
  const TTL = 7 * 24 * 60 * 60 * 1000;
  const MAX_METADATA_BYTES = 256 * 1024;
  let databasePromise;
  let cipherPromise;
  let writeEpoch = 0;
  const pendingWrites = new Map();

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
        const request = indexedDB.open(DATABASE, 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          // Version 1 stored reconstructible audio. Never carry it into this format.
          for (const name of ['audio', 'metadata']) {
            if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
            db.createObjectStore(name, { keyPath: 'key' });
          }
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

  async function cipher() {
    if (cipherPromise) return cipherPromise;
    if (!globalThis.crypto?.subtle || !globalThis.chrome?.runtime?.sendMessage) return null;
    cipherPromise = (async () => {
      let timer;
      try {
        const reply = await Promise.race([
          chrome.runtime.sendMessage({ target: 'background', type: 'audio-key-internal' }),
          new Promise((resolve) => { timer = setTimeout(() => resolve(null), 1200); }),
        ]);
        const value = reply?.cipher;
        if (typeof value?.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id)
          || !Array.isArray(value.key) || value.key.length !== 32
          || value.key.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null;
        const raw = Uint8Array.from(value.key);
        try {
          const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
          return { id: value.id, key };
        } finally {
          raw.fill(0);
          value.key.fill(0);
        }
      } catch { return null; }
      finally { clearTimeout(timer); }
    })();
    const pending = cipherPromise;
    const result = await pending;
    // A suspended worker or temporary messaging failure must not disable replay
    // for the lifetime of this document. Successful keys remain memoized.
    if (!result && cipherPromise === pending) cipherPromise = null;
    return result;
  }

  function authenticatedData(key, id) {
    return new TextEncoder().encode(`hermes-encrypted-audio-v2:${id}:${key}`);
  }

  async function encryptRecord(key, input, encryption) {
    const metadata = { duration: input.duration, estimatedTimings: [...input.estimatedTimings],
      ...(input.alignedTimings ? { alignedTimings: [...input.alignedTimings] } : {}) };
    const encoded = new TextEncoder().encode(JSON.stringify(metadata));
    if (encoded.byteLength > MAX_METADATA_BYTES) return null;
    const audio = new Uint8Array(await input.blob.arrayBuffer());
    const packed = new Uint8Array(4 + encoded.byteLength + audio.byteLength);
    new DataView(packed.buffer).setUint32(0, encoded.byteLength, true);
    packed.set(encoded, 4);
    packed.set(audio, 4 + encoded.byteLength);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    try {
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
        additionalData: authenticatedData(key, encryption.id), tagLength: 128 }, encryption.key, packed);
      return { key, cipherId: encryption.id, iv, ciphertext };
    } finally {
      audio.fill(0); encoded.fill(0); packed.fill(0);
    }
  }

  async function decryptRecord(key, input, encryption) {
    if (!input || input.cipherId !== encryption.id || input.key !== key
      || !(input.iv instanceof Uint8Array) || input.iv.byteLength !== 12
      || !(input.ciphertext instanceof ArrayBuffer) || input.ciphertext.byteLength < 64
      || input.ciphertext.byteLength > MAX_BYTES + MAX_METADATA_BYTES + 20) return null;
    let packed;
    try {
      packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: input.iv,
        additionalData: authenticatedData(key, encryption.id), tagLength: 128 }, encryption.key, input.ciphertext));
      const length = new DataView(packed.buffer).getUint32(0, true);
      if (!length || length > MAX_METADATA_BYTES || length + 4 > packed.byteLength - 44) return null;
      const metadata = JSON.parse(new TextDecoder().decode(packed.subarray(4, 4 + length)));
      // Construct a fresh Blob before erasing the temporary decrypted byte buffer.
      const record = { key, blob: new Blob([packed.subarray(4 + length)], { type: 'audio/wav' }),
        duration: metadata.duration, estimatedTimings: metadata.estimatedTimings,
        ...(metadata.alignedTimings ? { alignedTimings: metadata.alignedTimings } : {}) };
      return validRecord(record) ? record : null;
    } catch { return null; }
    finally { packed?.fill(0); }
  }

  async function keyFor(payload) {
    if (!globalThis.indexedDB || !globalThis.crypto?.subtle) return null;
    const model = String(payload.model || '');
    const parts = [VERSION, model, String(payload.voice || ''),
      String(payload.text || ''), model === 'gpt-4o-mini-tts' ? String(payload.instructions || '').trim().slice(0, 1000) : ''];
    // Keep existing 1× recordings reusable after upgrading. Other source speeds
    // require their own audio and timestamps; toolbar playback speed is omitted.
    if ((payload.generationSpeed ?? 1) !== 1) parts.push(payload.generationSpeed);
    const canonical = JSON.stringify(parts);
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
    // Open first so legacy plaintext is removed even if key access is unavailable.
    if (!await database()) return null;
    const encryption = await cipher();
    if (!encryption) return null;
    const saved = await transaction('readwrite', (audio, metadata, result) => {
      const request = metadata.get(key);
      request.onsuccess = () => {
        const info = request.result;
        if (!info) return;
        const now = Date.now();
        if (info.cipherId !== encryption.id || !Number.isFinite(info.createdAt) || now - info.createdAt >= TTL) {
          audio.delete(key); metadata.delete(key); return;
        }
        const requestAudio = audio.get(key);
        requestAudio.onsuccess = () => {
          metadata.put({ ...info, usedAt: now });
          result(requestAudio.result);
        };
      };
    }, null);
    if (!saved) return null;
    const record = await decryptRecord(key, saved, encryption);
    if (!record) await transaction('readwrite', (audio, metadata) => { audio.delete(key); metadata.delete(key); }, null);
    return record;
  }

  async function writeRecord(key, input, epoch) {
    if (epoch !== writeEpoch || !await database()) return false;
    const encryption = await cipher();
    if (!encryption || epoch !== writeEpoch) return false;
    let record;
    try { record = await encryptRecord(key, input, encryption); }
    catch { return false; }
    if (!record || epoch !== writeEpoch) return false;
    return transaction('readwrite', (audio, metadata, result) => {
      const request = metadata.getAll();
      request.onsuccess = () => {
        if (epoch !== writeEpoch) return;
        const now = Date.now();
        const previous = request.result.find((item) => item.key === key && item.cipherId === encryption.id);
        const current = { key, cipherId: encryption.id, bytes: input.blob.size,
          createdAt: previous && now - previous.createdAt < TTL ? previous.createdAt : now, usedAt: now };
        const retained = [];
        for (const item of request.result) {
          if (item.key === key) continue;
          if (item.cipherId !== encryption.id || !Number.isFinite(item.bytes) || now - item.createdAt >= TTL) {
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

  function put(key, input) {
    if (!validKey(key) || !validRecord(input)) return Promise.resolve(false);
    const snapshot = { blob: input.blob, duration: input.duration, estimatedTimings: [...input.estimatedTimings],
      ...(input.alignedTimings ? { alignedTimings: [...input.alignedTimings] } : {}) };
    const epoch = writeEpoch;
    // A later aligned save must not be overtaken by an earlier encryption task.
    const previous = pendingWrites.get(key) || Promise.resolve();
    const task = previous.then(() => writeRecord(key, snapshot, epoch)).catch(() => false);
    pendingWrites.set(key, task);
    task.then(() => { if (pendingWrites.get(key) === task) pendingWrites.delete(key); });
    return task;
  }

  async function stats() {
    await Promise.all([...pendingWrites.values()]);
    const unavailable = { available: false, bytes: 0, entries: 0, maxBytes: MAX_BYTES, maxAgeDays: 7, retention: 'browser-session' };
    if (!await database()) return unavailable;
    const encryption = await cipher();
    if (!encryption) return unavailable;
    return transaction('readwrite', (audio, metadata, result) => {
      const request = metadata.getAll();
      request.onsuccess = () => {
        const now = Date.now();
        let bytes = 0, entries = 0;
        for (const item of request.result) {
          if (item.cipherId !== encryption.id || now - item.createdAt >= TTL) { audio.delete(item.key); metadata.delete(item.key); }
          else { bytes += item.bytes; entries += 1; }
        }
        result({ available: true, bytes, entries, maxBytes: MAX_BYTES, maxAgeDays: 7, retention: 'browser-session' });
      };
    }, unavailable);
  }

  async function clear() {
    writeEpoch += 1;
    return transaction('readwrite', (audio, metadata, result) => {
      audio.clear(); metadata.clear(); result(true);
    }, false);
  }

  globalThis.HermesAudioCache = Object.freeze({ keyFor, get, put, stats, clear });
})();
