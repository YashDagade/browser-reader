/* Private data stays in session memory, with opt-in encrypted credential storage. */
(() => {
  let ready;
  let cipherPromise;
  let connectionQueue = Promise.resolve();
  function serialize(operation) {
    const result = connectionQueue.then(operation);
    connectionQueue = result.catch(() => {});
    return result;
  }
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
  async function readConnection() {
    await initialize();
    const [{hermesConnection = {}}, {hermesApiKey = ''}] = await Promise.all([
      chrome.storage.local.get('hermesConnection'), chrome.storage.session.get('hermesApiKey'),
    ]);
    const mode = hermesConnection.mode === 'local' ? 'local' : 'direct';
    const rememberKey = hermesConnection.rememberKey === true;
    const consent = hermesConnection.consent === true;
    let apiKey = hermesApiKey, keyError = '';
    if (!apiKey && mode === 'direct' && consent && rememberKey) {
      try {
        apiKey = await HermesCredentialVault.read();
        if (!apiKey) throw Error('Missing saved key.');
        await chrome.storage.session.set({hermesApiKey: apiKey});
      } catch {
        apiKey = '';
        keyError = 'Could not unlock the saved key. Re-import your .env.local file and save again, or disconnect to remove it.';
      }
    }
    return {mode, apiKey, consent, rememberKey, keyError};
  }
  function connection() { return serialize(readConnection); }
  function saveConnection(input) { return serialize(async () => {
    const previous = await readConnection();
    const mode = input.mode === 'local' ? 'local' : 'direct';
    const candidate = typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : previous.apiKey;
    const rememberKey = mode === 'direct' && input.rememberKey === true;
    if (input.consent !== true) throw Error('Review and accept the OpenAI disclosure before saving.');
    if (mode === 'direct' && (!/^sk-[A-Za-z0-9_-]{16,}$/.test(candidate) || candidate.length > 1024)) throw Error('Import or paste a valid OpenAI API key first.');
    if (rememberKey) {
      try { await HermesCredentialVault.save(candidate); }
      catch { throw Error('Could not save the encrypted key. Try again, or turn off Remember on this device to use session memory.'); }
    } else if (previous.rememberKey) {
      try { await HermesCredentialVault.remove(); }
      catch { throw Error('Could not remove the saved key. Try again before changing storage mode.'); }
    }
    if (mode === 'direct') await chrome.storage.session.set({hermesApiKey: candidate});
    else await chrome.storage.session.remove('hermesApiKey');
    await chrome.storage.local.set({hermesConnection: {mode, consent: true, rememberKey}});
    return readConnection();
  }); }
  function forgetConnection() { return serialize(async () => {
    await initialize();
    const {hermesConnection = {mode: 'direct'}} = await chrome.storage.local.get('hermesConnection');
    // Revoke access even if storage deletion fails; a later retry can finish cleanup.
    await chrome.storage.local.set({hermesConnection: {...hermesConnection, consent: false}});
    await chrome.storage.session.remove('hermesApiKey');
    // Also remove a possible orphan from an interrupted first save, before its
    // nonsecret remember flag reached Chrome storage.
    try { await HermesCredentialVault.remove(); }
    catch { throw Error('Disconnected, but credential storage could not be cleared. Click Disconnect OpenAI again to finish removing any saved key.'); }
    await chrome.storage.local.set({hermesConnection: {mode: hermesConnection.mode, consent: false, rememberKey: false}});
    return readConnection();
  }); }
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
