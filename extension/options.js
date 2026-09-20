const $ = selector => document.querySelector(selector);
const model = $('#model');
const voice = $('#voice');
const mode = $('#connection-mode');
let importedKey = '';
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
  const {settings = {}, hermesConnection = {mode: 'local'}} = await chrome.storage.local.get(['settings', 'hermesConnection']);
  model.value = settings.model || 'local'; voice.value = settings.voice || 'alloy';
  $('#instructions').value = settings.instructions || ''; $('#sync-mode').value = settings.syncMode || 'precise';
  mode.value = hermesConnection.mode || 'local'; $('#forget').hidden = !hermesConnection.apiKey;
  connectionFields(); voiceOptions(); await check();
}
async function savePreferences() {
  voiceOptions();
  const {settings = {}} = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({settings: {...settings, model: model.value, voice: voice.value, instructions: $('#instructions').value.trim().slice(0, 1000), syncMode: $('#sync-mode').value}});
  $('#saved').textContent = 'Saved. Applies the next time you open a reader.';
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
    $('#import-status').textContent = 'Key read locally. Click Save connection to store it in this Chrome profile.';
  } catch (error) { $('#import-status').textContent = error.message; }
  event.target.value = '';
});
$('#api-key').addEventListener('input', () => { importedKey = ''; $('#import-status').textContent = ''; });
$('#save-connection').addEventListener('click', async () => {
  const status = $('#connection-saved'); status.textContent = '';
  try {
    // The optional API permission is requested only by this deliberate user gesture.
    if (mode.value === 'direct' && !await chrome.permissions.request({origins: ['https://api.openai.com/*']})) {
      status.textContent = 'OpenAI permission was not granted. Your connection is unchanged.'; return;
    }
    const {hermesConnection = {}} = await chrome.storage.local.get('hermesConnection');
    const candidate = $('#api-key').value.trim() || importedKey || hermesConnection.apiKey || '';
    if (mode.value === 'direct' && !/^sk-[A-Za-z0-9_-]{16,}$/.test(candidate)) {
      status.textContent = 'Import or paste a valid OpenAI API key first.'; return;
    }
    const savedKey = mode.value === 'direct' ? candidate : hermesConnection.apiKey;
    await chrome.storage.local.set({hermesConnection: {mode: mode.value, ...(savedKey ? {apiKey: savedKey} : {})}});
    importedKey = ''; $('#api-key').value = ''; $('#import-status').textContent = '';
    $('#forget').hidden = !savedKey;
    status.textContent = mode.value === 'direct' ? 'Saved in this Chrome profile. No local helper is required.' : 'Local helper selected.';
    await check();
  } catch { status.textContent = 'Could not save the connection. Please try again.'; }
});
$('#forget').addEventListener('click', async () => {
  await chrome.storage.local.set({hermesConnection: {mode: mode.value}});
  await chrome.permissions.remove({origins: ['https://api.openai.com/*']});
  importedKey = ''; $('#api-key').value = ''; $('#key-file').value = ''; $('#import-status').textContent = '';
  $('#forget').hidden = true; $('#connection-saved').textContent = 'The saved key was removed from this Chrome profile.'; await check();
});
async function check() {
  const state = await HermesSpeech.health();
  $('#connection').textContent = state.configured ? state.mode === 'direct' ? 'OpenAI direct connection is ready' : 'OpenAI local connection is ready' : state.running && state.mode === 'direct' ? 'Add your OpenAI key' : state.running ? 'Local helper ready · API key needed' : 'On-device reading is ready';
  $('#detail').textContent = state.configured ? state.mode === 'direct' ? 'Hermes is configured to call OpenAI from Chrome. Your key is checked when you first play audio.' : 'Open an article and choose an OpenAI voice in the player.' : state.mode === 'direct' ? 'Import or paste your own API key below, then save the connection.' : 'The on-device voice works immediately. Select a connection below to enable OpenAI voices.';
  if (new URLSearchParams(location.search).has('restricted')) $('#detail').textContent += ' This Chrome page cannot run the reader. Try a regular article webpage.';
}
$('#check').addEventListener('click', check);
initialize().catch(() => { $('#connection').textContent = 'Could not load setup. Reload this page to try again.'; });
