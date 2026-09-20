/* Private data lives in Chrome's memory-only session storage, never sync/local. */
(() => {
  let ready;
  let cipherPromise;
  function initialize() {
    if (!ready) ready = (async () => {
      await Promise.all([
        chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
        chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
      ]);
      const local = await chrome.storage.local.get(['hermesConnection', 'settings']);
      const session = await chrome.storage.session.get(['hermesApiKey', 'hermesInstructions']);
      const connection = local.hermesConnection || {mode: 'direct'};
      // Migrate the personal prototype without ever rendering its saved key.
      if (connection.apiKey) {
        if (!session.hermesApiKey) await chrome.storage.session.set({hermesApiKey: connection.apiKey});
        await chrome.storage.local.set({hermesConnection: {mode: connection.mode || 'direct', consent: connection.consent === true}});
      }
      if (typeof local.settings?.instructions === 'string') {
        if (session.hermesInstructions === undefined) await chrome.storage.session.set({hermesInstructions: local.settings.instructions});
        const {instructions, ...settings} = local.settings;
        await chrome.storage.local.set({settings});
      }
    })();
    return ready;
  }
  async function connection() {
    await initialize();
    const [{hermesConnection = {}}, {hermesApiKey = ''}] = await Promise.all([
      chrome.storage.local.get('hermesConnection'), chrome.storage.session.get('hermesApiKey'),
    ]);
    return {mode: hermesConnection.mode === 'local' ? 'local' : 'direct', apiKey: hermesApiKey, consent: hermesConnection.consent === true};
  }
  async function saveConnection(input) {
    const previous = await connection();
    const mode = input.mode === 'local' ? 'local' : 'direct';
    const candidate = typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : previous.apiKey;
    if (input.consent !== true) throw Error('Review and accept the OpenAI disclosure before saving.');
    if (mode === 'direct' && !/^sk-[A-Za-z0-9_-]{16,}$/.test(candidate)) throw Error('Import or paste a valid OpenAI API key first.');
    if (mode === 'direct') await chrome.storage.session.set({hermesApiKey: candidate});
    await chrome.storage.local.set({hermesConnection: {mode, consent: true}});
    return connection();
  }
  async function forgetConnection() {
    const previous = await connection();
    await chrome.storage.session.remove('hermesApiKey');
    await chrome.storage.local.set({hermesConnection: {mode: previous.mode, consent: false}});
    return connection();
  }
  async function preferences() {
    await initialize();
    const [{settings = {}}, {hermesInstructions = ''}] = await Promise.all([
      chrome.storage.local.get('settings'), chrome.storage.session.get('hermesInstructions'),
    ]);
    return {...settings, model: ['gpt-4o-mini-tts','tts-1','tts-1-hd'].includes(settings.model) ? settings.model : 'gpt-4o-mini-tts', instructions: hermesInstructions};
  }
  async function savePreferences(value) {
    await initialize();
    const {instructions = '', ...settings} = value;
    await chrome.storage.session.set({hermesInstructions: String(instructions).slice(0, 1000)});
    await chrome.storage.local.set({settings});
  }
  async function audioCipher() {
    await initialize();
    if (!cipherPromise) cipherPromise = (async () => {
      const {hermesAudioCipher} = await chrome.storage.session.get('hermesAudioCipher');
      if (hermesAudioCipher?.id && Array.isArray(hermesAudioCipher.key) && hermesAudioCipher.key.length === 32 && hermesAudioCipher.key.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) return hermesAudioCipher;
      const cipher = {id: crypto.randomUUID(), key: Array.from(crypto.getRandomValues(new Uint8Array(32)))};
      await chrome.storage.session.set({hermesAudioCipher: cipher});
      return cipher;
    })().catch(error => {cipherPromise = null; throw error;});
    return cipherPromise;
  }
  globalThis.HermesSession = Object.freeze({initialize, connection, saveConnection, forgetConnection, preferences, savePreferences, audioCipher});
})();
