import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('../extension/ui.js', import.meta.url), 'utf8');

function fixture(t, options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><article>Original page text.</article></body></html>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.eval(script);
  const actions = [];
  const ui = dom.window.ReaderUI.create({
    title: 'A scientific essay', totalWords: 240, ...options,
    onAction(action, payload) {
      // Copy payloads across realms so assertions inspect public values.
      actions.push({ action, payload: payload === undefined ? undefined : JSON.parse(JSON.stringify(payload)) });
    },
  });
  const root = ui.host.shadowRoot;
  const get = selector => root.querySelector(selector);
  const dispatch = (element, event) => element.dispatchEvent(new dom.window.Event(event, { bubbles: true, composed: true }));
  return { dom, ui, root, get, actions, dispatch };
}

test('playback controls dispatch actions appropriate to current state and stopping leaves the reader available', t => {
  const { ui, get, actions } = fixture(t);
  const play = get('.primary');
  assert.equal(play.getAttribute('aria-label'), 'Start reading');
  play.click();
  ui.update({ status: 'playing', wordIndex: 8 });
  assert.equal(play.getAttribute('aria-label'), 'Pause reading');
  play.click();
  ui.update({ status: 'loading' });
  play.click();
  ui.update({ status: 'paused' });
  assert.equal(play.getAttribute('aria-label'), 'Resume reading');
  play.click();
  get('.previous').click();
  get('.next').click();
  get('.stop').click();
  ui.update({ status: 'stopped', wordIndex: 0 });
  assert.equal(ui.host.isConnected, true);
  assert.equal(play.getAttribute('aria-label'), 'Start reading');
  assert.deepEqual(actions.map(event => event.action), ['play', 'pause', 'pause', 'play', 'previous', 'next', 'stop']);
});

test('speed slider immediately changes playback settings and presets keep the accessible display in sync', t => {
  const { get, actions, dispatch } = fixture(t, { settings: { speed: 1.5 } });
  get('.speed-toggle').click();
  assert.equal(get('.drawer').hidden, false);
  assert.equal(get('.speed-toggle').getAttribute('aria-expanded'), 'true');
  const speed = get('#reader-speed');
  speed.value = '2.75';
  dispatch(speed, 'input');
  assert.deepEqual(actions.at(-1), { action: 'settings', payload: { speed: 2.75 } });
  assert.equal(get('.speed-output').textContent, '2.75×');
  assert.equal(speed.getAttribute('aria-valuetext'), '2.75 times normal speed');
  get('[data-speed="4"]').click();
  assert.deepEqual(actions.at(-1), { action: 'settings', payload: { speed: 4 } });
  assert.equal(speed.value, '4');
  assert.equal(get('[data-speed="4"]').getAttribute('aria-pressed'), 'true');
  assert.equal(get('[data-speed="1.5"]').getAttribute('aria-pressed'), 'false');
});

test('voice and engine settings exclude incompatible voices and local mode does not claim a missing OpenAI connection', t => {
  const { ui, get, actions, dispatch } = fixture(t, { settings: { voice: 'marin' } });
  ui.update({ connected: false });
  assert.match(get('.notice').textContent, /OpenAI isn’t connected/);
  const model = get('#reader-model');
  model.value = 'tts-1';
  dispatch(model, 'change');
  assert.deepEqual(actions.at(-1), { action: 'settings', payload: { model: 'tts-1', voice: 'coral' } });
  const voices = Array.from(get('#reader-voice').options, option => option.value);
  assert.ok(!voices.includes('marin'));
  assert.ok(!voices.includes('cedar'));
  get('#reader-voice').value = 'sage';
  dispatch(get('#reader-voice'), 'change');
  assert.deepEqual(actions.at(-1), { action: 'settings', payload: { voice: 'sage' } });
  get('#reader-follow').checked = false;
  dispatch(get('#reader-follow'), 'change');
  assert.deepEqual(actions.at(-1), { action: 'settings', payload: { follow: false } });
  model.value = 'local';
  dispatch(model, 'change');
  assert.deepEqual(actions.at(-1), { action: 'settings', payload: { model: 'local' } });
  assert.equal(get('.voice-field').hidden, true);
  assert.equal(get('.notice').hidden, true);
  assert.match(get('.timing-hint').textContent, /browser’s voice/);
});

test('seeking previews locally, survives playback updates, and dispatches one seek when committed', t => {
  const { ui, get, actions, dispatch } = fixture(t);
  ui.update({ status: 'playing', wordIndex: 10 });
  const progress = get('.progress');
  dispatch(progress, 'pointerdown');
  progress.value = '89';
  dispatch(progress, 'input');
  ui.update({ wordIndex: 12 });
  assert.equal(progress.value, '89');
  assert.equal(actions.length, 0);
  dispatch(progress, 'change');
  assert.deepEqual(actions, [{ action: 'seek', payload: { wordIndex: 89 } }]);
  assert.equal(progress.getAttribute('aria-valuetext'), 'Word 90 of 240');
  ui.update({ wordIndex: 91 });
  assert.equal(progress.value, '91');
  // Merely pressing and releasing the slider must not freeze later progress.
  dispatch(progress, 'pointerdown');
  dispatch(progress, 'pointerup');
  ui.update({ wordIndex: 92 });
  assert.equal(progress.value, '92');
});

test('paste action accepts text verbatim, rejects empty input, and closes the settings drawer', t => {
  const { get, actions, dispatch } = fixture(t);
  get('.settings-toggle').click();
  get('.paste-toggle').click();
  assert.equal(get('#reader-paste').hidden, false);
  const input = get('#reader-text');
  const submit = get('.paste-action');
  assert.equal(submit.disabled, true);
  input.value = '   \n ';
  dispatch(input, 'input');
  assert.equal(submit.disabled, true);
  input.value = '  Eigenvalues, <em>not markup</em>, and Hamiltonians.  ';
  dispatch(input, 'input');
  assert.equal(submit.disabled, false);
  submit.click();
  assert.deepEqual(actions, [{ action: 'paste', payload: { text: 'Eigenvalues, <em>not markup</em>, and Hamiltonians.' } }]);
  assert.equal(get('.drawer').hidden, true);
  assert.equal(get('.settings-toggle').getAttribute('aria-expanded'), 'false');
});

test('article titles and error messages are rendered as text without altering the source page', t => {
  const title = '<img src=x onerror="window.wasInjected=true"> A technical essay';
  const { dom, ui, root, get } = fixture(t, { title });
  assert.equal(get('.title').textContent, title);
  assert.equal(root.querySelector('img'), null);
  ui.update({ title: '<script>window.wasInjected=true</script>', status: 'error', error: '<b>API unavailable</b>' });
  assert.equal(get('.title').textContent, '<script>window.wasInjected=true</script>');
  assert.equal(get('.notice').textContent, '<b>API unavailable</b>');
  assert.equal(root.querySelector('script, img, b'), null);
  assert.equal(dom.window.wasInjected, undefined);
  assert.equal(dom.window.document.querySelector('article').textContent, 'Original page text.');
});

test('keyboard interaction is isolated, Escape dismisses settings, and destroy disables detached controls', t => {
  const { dom, ui, get, actions } = fixture(t);
  let pageKeys = 0;
  dom.window.document.addEventListener('keydown', () => pageKeys++);
  get('.settings-toggle').click();
  get('#reader-speed').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }));
  assert.equal(get('.drawer').hidden, true);
  assert.equal(pageKeys, 0);
  assert.equal(ui.host.shadowRoot.activeElement, get('.settings-toggle'));
  get('.close').click();
  assert.equal(actions.at(-1).action, 'close');
  const play = get('.primary');
  ui.destroy();
  assert.equal(ui.host.isConnected, false);
  const previousLength = actions.length;
  play.click();
  ui.update({ status: 'playing' });
  assert.equal(actions.length, previousLength);
});

test('reopening replaces the existing player instead of stacking duplicates', t => {
  const { dom, ui } = fixture(t);
  const replacement = dom.window.ReaderUI.create({ title: 'Another essay', totalWords: 25 });
  assert.equal(ui.host.isConnected, false);
  assert.equal(replacement.host.isConnected, true);
  assert.equal(dom.window.document.querySelectorAll('#browser-reader-root').length, 1);
  replacement.destroy();
});
