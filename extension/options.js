const $ = selector => document.querySelector(selector);
const model = $('#model');
const voice = $('#voice');
const mode = $('#connection-mode');
let importedKey = '';
async function background(type, values = {}) {
  const response = await chrome.runtime.sendMessage({target: 'background', type, ...values});
  if (!response || response.error) throw Error(response?.error || 'The reader is unavailable. Reload setup and try again.');
  return response;
}
const legacyVoices = new Set(['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer']);
function voiceOptions() {
  const legacy = model.value === 'tts-1' || model.value === 'tts-1-hd';
  for (const option of voice.options) option.disabled = legacy && !legacyVoices.has(option.value);
  if (legacy && !legacyVoices.has(voice.value)) voice.value = 'alloy';
  $('#instructions').disabled = model.value !== 'gpt-4o-mini-tts';
}
function connectionFields() {
  $('#direct-fields').hidden = mode.value !== 'direct';
  $('#local-fields').hidden = mode.value === 'direct';
}
async function initialize() {
  const [{settings = {}}, {connection}] = await Promise.all([background('preferences'), background('connection-manage', {action: 'get'})]);
  model.value = ['gpt-4o-mini-tts','tts-1','tts-1-hd'].includes(settings.model) ? settings.model : 'gpt-4o-mini-tts'; voice.value = settings.voice || 'alloy';
  $('#instructions').value = settings.instructions || ''; $('#sync-mode').value = settings.syncMode || 'precise';
  mode.value = connection.mode; $('#forget').hidden = !connection.hasKey && !connection.consent && !connection.rememberKey;
  $('#remember-key').checked = connection.rememberKey === true;
  $('#cloud-consent').checked = connection.consent === true;
  connectionFields(); voiceOptions(); await Promise.all([check(), showCache()]);
}
async function savePreferences() {
  voiceOptions();
  try {
    await background('preferences-save', {settings: {model: model.value, voice: voice.value, instructions: $('#instructions').value.trim().slice(0, 1000), syncMode: $('#sync-mode').value}});
    $('#saved').textContent = 'Saved. Applies the next time you open a reader. Custom guidance lasts until Chrome quits.';
  } catch (error) { $('#saved').textContent = error.message; }
}
for (const element of [model, voice, $('#instructions'), $('#sync-mode')]) element.addEventListener('change', savePreferences);
mode.addEventListener('change', connectionFields);
$('#key-file').addEventListener('change', async event => {
  importedKey = ''; const file = event.target.files?.[0];
  try {
    if (!file || file.size > 65536) throw Error('Choose a small .env.local text file.');
    const text = await file.text();
    const match = text.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*["']?([^\s"'#]+)["']?\s*(?:#.*)?$/m);
    const value = match?.[1] || text.trim();
    if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(value)) throw Error('No OpenAI API key was found in this file.');
    importedKey = value; $('#api-key').value = '';
    $('#import-status').textContent = 'Key read locally. Choose whether to remember it, then click Save connection.';
  } catch (error) { $('#import-status').textContent = error.message; }
  event.target.value = '';
});
$('#api-key').addEventListener('input', () => { importedKey = ''; $('#import-status').textContent = ''; });
$('#save-connection').addEventListener('click', async () => {
  const status = $('#connection-saved'); status.textContent = '';
  $('#save-connection').disabled = true;
  try {
    if (!$('#cloud-consent').checked) {
      status.textContent = 'Review and accept the OpenAI disclosure before saving.'; return;
    }
    // The optional API permission is requested only by this deliberate user gesture.
    if (mode.value === 'direct' && !await chrome.permissions.request({origins: ['https://api.openai.com/*']})) {
      status.textContent = 'OpenAI permission was not granted. Your connection is unchanged.'; return;
    }
    const {connection} = await background('connection-manage', {action: 'save', connection: {
      mode: mode.value, apiKey: mode.value === 'direct' ? $('#api-key').value.trim() || importedKey : undefined, consent: true, rememberKey: $('#remember-key').checked,
    }});
    importedKey = ''; $('#api-key').value = ''; $('#import-status').textContent = '';
    $('#forget').hidden = !connection.hasKey && !connection.consent && !connection.rememberKey;
    $('#remember-key').checked = connection.rememberKey === true;
    status.textContent = connection.mode === 'direct'
      ? connection.rememberKey ? 'Key saved encrypted on this device. Hermes will reconnect after Chrome restarts. No local helper is required.'
        : 'Key kept in memory until Chrome quits. No local helper is required.'
      : 'Local helper selected. Any key previously saved in Chrome was removed.';
    await check();
  } catch (error) { status.textContent = error.message; }
  finally { $('#save-connection').disabled = false; }
});
$('#forget').addEventListener('click', async () => {
  $('#forget').disabled = true;
  try {
    await background('connection-manage', {action: 'forget'});
    await chrome.permissions.remove({origins: ['https://api.openai.com/*']});
    importedKey = ''; $('#api-key').value = ''; $('#key-file').value = ''; $('#import-status').textContent = '';
    $('#cloud-consent').checked = false; $('#remember-key').checked = false;
    $('#forget').hidden = true; $('#connection-saved').textContent = 'The key was removed from memory and encrypted storage. OpenAI consent was reset.'; await check();
  } catch (error) { $('#connection-saved').textContent = error.message; }
  finally { $('#forget').disabled = false; }
});
async function check() {
  const state = await HermesSpeech.health();
  const {connection} = await background('connection-manage', {action: 'get'});
  $('#connection').textContent = state.configured ? state.mode === 'direct' ? 'OpenAI direct connection is ready' : 'OpenAI local connection is ready' : state.running && state.mode === 'direct' ? 'Add your OpenAI key' : state.running ? 'Local helper ready · API key needed' : 'Connect OpenAI to start reading';
  $('#detail').textContent = state.configured ? state.mode === 'direct' ? 'Hermes is configured to call OpenAI from Chrome. Your key is checked when you first play audio.' : 'Open an article and choose an OpenAI voice in the player.' : state.mode === 'direct' ? 'Import or paste your own API key below, then save the connection.' : 'Connect directly with your API key, or start your configured local helper.';
  if (state.configured && !connection.consent) {
    $('#connection').textContent = 'Review OpenAI data sharing';
    $('#detail').textContent = 'Review the disclosure below, check the consent box, and save before using an OpenAI voice.';
  }
  if (connection.keyError) { $('#connection').textContent = 'Reconnect your OpenAI key'; $('#detail').textContent = connection.keyError; }
  if (new URLSearchParams(location.search).has('restricted')) $('#detail').textContent += ' This Chrome page cannot run the reader. Try a regular article webpage.';
}
$('#check').addEventListener('click', check);
async function showCache() {
  const state = await globalThis.HermesAudioCache?.stats();
  $('#cache-status').textContent = state?.available
    ? `${(state.bytes / 1048576).toFixed(1)} MiB of 32 MiB · ${state.entries} saved passages`
    : 'Saved audio is unavailable. Reading still works.';
  $('#clear-cache').disabled = !state?.available;
}
$('#clear-cache').addEventListener('click', async () => {
  $('#clear-cache').disabled = true;
  const cleared = await globalThis.HermesAudioCache?.clear();
  await showCache();
  $('#cache-result').textContent = cleared ? 'Saved audio cleared. Active reading may save new audio.' : 'Could not clear saved audio. Try again.';
});
initialize().catch(() => { $('#connection').textContent = 'Could not load setup. Reload this page to try again.'; });
