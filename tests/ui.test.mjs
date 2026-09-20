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
  assert.deepEqual(actions.at(-1), { action: 'settings', payload: { model: 'tts-1', voice: 'alloy' } });
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

test('collapsing to an orb and expanding preserve playback and persist layout without touching audio settings', t => {
  const { ui, get, actions } = fixture(t);
  ui.update({ status: 'playing', wordIndex: 33 });
  get('.settings-toggle').click();
  get('.collapse').click();
  assert.equal(get('.bar').hidden, true);
  assert.equal(get('.drawer').hidden, true);
  assert.equal(get('.orb').hidden, false);
  assert.equal(get('.orb').getAttribute('aria-label'), 'Expand Hermes');
  assert.equal(get('.orb').dataset.playing, 'true');
  assert.equal(actions.at(-1).action, 'layout');
  assert.equal(actions.at(-1).payload.collapsed, true);
  ui.update({ wordIndex: 34 });
  get('.orb').click();
  assert.equal(get('.bar').hidden, false);
  assert.equal(get('.orb').hidden, true);
  assert.equal(get('.primary').getAttribute('aria-label'), 'Pause reading');
  assert.equal(get('.progress').value, '34');
  assert.equal(actions.at(-1).payload.collapsed, false);
  assert.ok(actions.every(action => action.action === 'layout'));
});

test('docking uses vertical controls, floating restores horizontal controls, and resize clamps the widget', t => {
  const { dom, ui, get, actions } = fixture(t);
  get('.dock-button[data-dock="right"]').click();
  assert.equal(get('.reader').dataset.dock, 'right');
  assert.equal(get('.progress').getAttribute('aria-orientation'), 'vertical');
  assert.equal(get('.dock-button[data-dock="right"]').getAttribute('aria-pressed'), 'true');
  assert.equal(Number.parseFloat(ui.host.style.left), dom.window.innerWidth - 76 - 12);
  assert.equal(actions.at(-1).payload.dock, 'right');
  get('.dock-button[data-dock="left"]').click();
  assert.equal(ui.host.style.left, '12px');
  get('.dock-button[data-dock="free"]').click();
  assert.equal(get('.progress').getAttribute('aria-orientation'), 'horizontal');
  assert.equal(actions.at(-1).payload.dock, 'free');
  ui.update({ layout: { x: 700, y: 700, collapsed: true } });
  Object.defineProperty(dom.window, 'innerWidth', { value: 360, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 300, configurable: true });
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(ui.host.style.left, '288px');
  assert.equal(ui.host.style.top, '228px');
});

function pointer(window, type, props) {
  const event = new window.Event(type, { bubbles: true, cancelable: true, composed: true });
  Object.assign(event, { pointerId: 1, button: 0, clientX: 0, clientY: 0, ...props });
  return event;
}

test('pointer dragging persists once, dragging the orb does not expand it, and destroy releases global handlers', t => {
  const { dom, ui, get, actions } = fixture(t, { settings: { layout: { x: 100, y: 100, collapsed: true } } });
  const orb = get('.orb');
  orb.dispatchEvent(pointer(dom.window, 'pointerdown', { clientX: 110, clientY: 110 }));
  dom.window.dispatchEvent(pointer(dom.window, 'pointermove', { clientX: 210, clientY: 230 }));
  assert.equal(ui.host.style.left, '200px');
  assert.equal(ui.host.style.top, '220px');
  assert.equal(actions.length, 0);
  dom.window.dispatchEvent(pointer(dom.window, 'pointerup', { clientX: 210, clientY: 230 }));
  assert.deepEqual(actions, [{ action: 'layout', payload: { dock: 'free', collapsed: true, x: 200, y: 220 } }]);
  orb.click();
  assert.equal(get('.bar').hidden, true);
  orb.click();
  assert.equal(get('.bar').hidden, false);
  get('.drag').dispatchEvent(pointer(dom.window, 'pointerdown', { clientX: 200, clientY: 220 }));
  ui.destroy();
  const left = ui.host.style.left;
  const count = actions.length;
  dom.window.dispatchEvent(pointer(dom.window, 'pointermove', { clientX: 500, clientY: 500 }));
  dom.window.dispatchEvent(pointer(dom.window, 'pointerup', { clientX: 500, clientY: 500 }));
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(ui.host.style.left, left);
  assert.equal(actions.length, count);
});

test('arrow keys move the toolbar without seeking or leaking keyboard shortcuts to the page', t => {
  const { dom, ui, get, actions } = fixture(t, { settings: { layout: { x: 100, y: 100 } } });
  let pageKeys = 0;
  dom.window.document.addEventListener('keydown', () => pageKeys++);
  get('.drag').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true, cancelable: true }));
  assert.equal(ui.host.style.top, '124px');
  assert.equal(actions.at(-1).action, 'layout');
  assert.equal(pageKeys, 0);
});

test('voice instructions survive playback updates, commit once, are bounded, and remain saved for unsupported engines', t => {
  const { ui, get, actions, dispatch } = fixture(t);
  assert.deepEqual(Array.from(get('#reader-voice').options).slice(0, 3).map(option => option.value), ['alloy', 'cedar', 'nova']);
  const input = get('#reader-instructions');
  get('.settings-toggle').click();
  get('.advanced').open = true;
  input.focus();
  input.value = 'This is a biology article. Pronounce gene names carefully.';
  dispatch(input, 'input');
  ui.update({ status: 'playing', wordIndex: 55 });
  assert.equal(input.value, 'This is a biology article. Pronounce gene names carefully.');
  assert.equal(actions.length, 0);
  dispatch(input, 'change');
  assert.equal(actions.at(-1).payload.instructions, input.value);
  dispatch(input, 'change');
  assert.equal(actions.length, 1);
  input.value = 'x'.repeat(1100);
  dispatch(input, 'input');
  dispatch(input, 'change');
  assert.equal(actions.at(-1).payload.instructions.length, 1000);
  assert.equal(get('.prompt-count').textContent, '1000 / 1000');
  get('#reader-model').value = 'tts-1';
  dispatch(get('#reader-model'), 'change');
  assert.equal(input.disabled, true);
  assert.match(get('#reader-instructions-help').textContent, /OpenAI expressive/);
  get('#reader-model').value = 'gpt-4o-mini-tts';
  dispatch(get('#reader-model'), 'change');
  assert.equal(input.disabled, false);
  assert.equal(input.value.length, 1000);
});

test('timing source is explained accurately and precise sync is configurable without changing voice', t => {
  const { ui, get, actions, dispatch } = fixture(t);
  assert.equal(get('#reader-sync').checked, true);
  ui.update({ timingSource: 'aligned' });
  assert.match(get('.timing-hint').textContent, /Words matched to audio/);
  get('#reader-sync').checked = false;
  dispatch(get('#reader-sync'), 'change');
  assert.deepEqual(actions.at(-1), { action: 'settings', payload: { syncMode: 'estimated' } });
  ui.update({ timingSource: 'estimated' });
  assert.match(get('.timing-hint').textContent, /Estimated word timing/);
  ui.update({ model: 'local', timingSource: 'native' });
  assert.equal(get('#reader-sync').disabled, true);
  assert.match(get('#reader-sync-help').textContent, /own word timing/);
});

test('remaining time always uses minutes and seconds, updates with playback and speed, and falls back without measured duration', t => {
  const { ui, get } = fixture(t, { totalWords: 24000 });
  ui.update({ remainingSeconds: 7321, status: 'playing' });
  assert.equal(get('.time').textContent, '122:01');
  ui.update({ remainingSeconds: 7319 });
  assert.equal(get('.time').textContent, '121:59');
  get('[data-speed="2"]').click();
  assert.equal(get('.time').textContent, '61:00');
  ui.update({ remainingSeconds: undefined, wordIndex: 23900 });
  assert.equal(get('.time').textContent, '~0:16');
  ui.update({ status: 'ended', remainingSeconds: 50 });
  assert.equal(get('.time').textContent, '0:00');
});

test('toolbar invocation expands a collapsed player without changing or restarting playback', t => {
  const { ui, get, actions } = fixture(t, { settings: { layout: { collapsed: true } } });
  ui.update({ status: 'playing', wordIndex: 67 });
  ui.expand();
  assert.equal(get('.bar').hidden, false);
  assert.equal(get('.orb').hidden, true);
  assert.equal(get('.primary').getAttribute('aria-label'), 'Pause reading');
  assert.equal(get('.progress').value, '67');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'layout');
  assert.equal(actions[0].payload.collapsed, false);
  ui.expand();
  assert.equal(actions.length, 1);
  ui.destroy();
  ui.expand();
  assert.equal(actions.length, 1);
});

test('all supported voices retain the actual saved selection and legacy models retain their compatible voices', t => {
  const { ui, get, actions, dispatch } = fixture(t, { settings: { voice: 'echo' } });
  assert.equal(get('#reader-voice').options.length, 13);
  assert.equal(get('#reader-voice').value, 'echo');
  get('#reader-model').value = 'tts-1';
  dispatch(get('#reader-model'), 'change');
  assert.deepEqual(actions.at(-1), { action: 'settings', payload: { model: 'tts-1' } });
  assert.equal(get('#reader-voice').value, 'echo');
  assert.equal(get('#reader-voice').options.length, 9);
  ui.update({ model: 'gpt-4o-mini-tts', voice: 'verse' });
  assert.equal(get('#reader-voice').value, 'verse');
});
