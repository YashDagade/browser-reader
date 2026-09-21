/* Optional device-local credentials. No plaintext secret is written to disk.
 * The non-exportable CryptoKey lives in the same Chrome profile as the ciphertext.
 * This is not an OS keychain and cannot protect a compromised browser/profile. */
(() => {
  const DATABASE = 'hermes-credentials';
  const STORE = 'credentials';
  const RECORD = 'openai';
  const aad = () => new TextEncoder().encode('Hermes OpenAI credential v1');

  async function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      let abandoned = false;
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => reject(Error('Credential storage is unavailable.'));
      request.onblocked = () => { abandoned = true; reject(Error('Close other Hermes setup tabs and try again.')); };
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }

  async function record(mode, operation) {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = operation(transaction.objectStore(STORE));
        // A successful request can still be rolled back: wait for commit.
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(Error('Credential storage could not be updated.'));
        transaction.onerror = () => {}; // onabort handles transaction failures.
      });
    } finally { db.close(); }
  }

  async function save(value) {
    if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(value) || value.length > 1024) throw Error('Invalid OpenAI API key.');
    const key = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(value);
    try {
      const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: aad()}, key, plaintext);
      await record('readwrite', store => store.put({version: 1, key, iv, ciphertext}, RECORD));
    } finally { plaintext.fill(0); }
  }

  async function read() {
    const saved = await record('readonly', store => store.get(RECORD));
    if (!saved) return '';
    if (saved.version !== 1 || saved.key?.type !== 'secret' || saved.key.extractable !== false ||
        saved.key.algorithm?.name !== 'AES-GCM' || saved.key.algorithm.length !== 256 ||
        !(saved.iv instanceof Uint8Array) || saved.iv.byteLength !== 12 ||
        !(saved.ciphertext instanceof ArrayBuffer) || saved.ciphertext.byteLength > 2048) {
      throw Error('Saved credential is invalid.');
    }
    const plaintext = new Uint8Array(await crypto.subtle.decrypt(
      {name: 'AES-GCM', iv: saved.iv, additionalData: aad()}, saved.key, saved.ciphertext));
    try {
      const value = new TextDecoder().decode(plaintext);
      if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(value)) throw Error('Saved credential is invalid.');
      return value;
    } finally { plaintext.fill(0); }
  }

  async function remove() { await record('readwrite', store => store.delete(RECORD)); }
  globalThis.HermesCredentialVault = Object.freeze({save, read, remove});
})();
