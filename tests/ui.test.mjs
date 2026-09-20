import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('../extension/ui.js', import.meta.url), 'utf8');

// JSDOM cannot produce trusted user events. This harness-only adapter presents
// browser-trusted delivery to unchanged production listeners; raw-event tests
// disable it. No production trust checks or source text are rewritten.
function trustedEventHarness(window, enabled = true) {
  const control = { enabled };
  const add = window.EventTarget.prototype.addEventListener;
  const remove = window.EventTarget.prototype.removeEventListener;
  const listeners = new WeakMap();
  const events = new WeakMap();
  window.EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (!listener) return add.call(this, type, listener, options);
    if (!listeners.has(listener)) listeners.set(listener, function(event) {
      let delivered = event;
      if (control.enabled) {
        if (!events.has(event)) events.set(event, new Proxy(event, {
          get(target, property) {
            if (property === 'isTrusted') return true;
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }));
        delivered = events.get(event);
      }
      return typeof listener === 'function' ? listener.call(this, delivered) : listener.handleEvent(delivered);
    });
    return add.call(this, type, listeners.get(listener), options);
  };
  window.EventTarget.prototype.removeEventListener = function(type, listener, options) {
    return remove.call(this, type, listeners.get(listener) || listener, options);
  };
  return control;
}

function fixture(t, options = {}, { trustedEvents = true } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><article>Original page text.</article></body></html>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const trust = trustedEventHarness(dom.window, trustedEvents);
  const roots = new WeakMap();
  const attachShadow = dom.window.Element.prototype.attachShadow;
  dom.window.Element.prototype.attachShadow = function(options) {
    const root = attachShadow.call(this, options);
    roots.set(this, root);
    return root;
  };
  dom.window.eval(script);
  const actions = [];
  const ui = dom.window.ReaderUI.create({
    title: 'A scientific essay', totalWords: 240, ...options,
    onAction(action, payload) {
      // Copy payloads across realms so assertions inspect public values.
      actions.push({ action, payload: payload === undefined ? undefined : JSON.parse(JSON.stringify(payload)) });
    },
  });
  const root = roots.get(ui.host);
  const get = selector => root.querySelector(selector);
  const dispatch = (element, event) => element.dispatchEvent(new dom.window.Event(event, { bubbles: true, composed: true }));
  return { dom, ui, root, get, actions, dispatch, trust };
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

test('toolbar speed cycles without opening preferences and the menu slider supports intermediate speeds', t => {
  const { get, actions, dispatch } = fixture(t);
  const button = get('.speed-toggle');
  for (const speed of [1.5, 2, 4, 1]) {
    assert.match(button.getAttribute('aria-label'), new RegExp(`Change to ${speed}×`));
    button.click();
    assert.deepEqual(actions.at(-1), { action: 'settings', payload: { speed } });
    assert.equal(button.textContent, `${speed}×`);
    assert.equal(get('.drawer').hidden, true);
  }
  assert.equal(button.hasAttribute('aria-controls'), false);
  assert.equal(get('.preset'), null);
  get('.settings-toggle').click();
  assert.equal(get('.drawer').hidden, false);
  const speed = get('#reader-speed');
  assert.equal(speed.min, '0.75');
  assert.equal(speed.max, '4');
  speed.value = '2.75';
  dispatch(speed, 'input');
  assert.deepEqual(actions.at(-1), { action: 'settings', payload: { speed: 2.75 } });
  assert.equal(get('.speed-output').textContent, '2.75×');
  assert.equal(speed.getAttribute('aria-valuetext'), '2.75 times normal speed');
  assert.match(button.getAttribute('aria-label'), /Change to 4×/);
  button.click();
  assert.equal(speed.value, '4');
  assert.equal(get('.drawer').hidden, false);
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
  const { dom, ui, root, get, actions } = fixture(t);
  let pageKeys = 0;
  dom.window.document.addEventListener('keydown', () => pageKeys++);
  get('.settings-toggle').click();
  get('#reader-speed').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }));
  assert.equal(get('.drawer').hidden, true);
  assert.equal(pageKeys, 0);
  assert.equal(root.activeElement, get('.settings-toggle'));
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
  get('.speed-toggle').click();
  get('.speed-toggle').click();
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

test('dropping near any viewport edge docks in the correct orientation and only persists the final position', t => {
  for (const [dock, x, y, orientation] of [
    ['left', 20, 300, 'vertical'], ['right', 1004, 200, 'vertical'],
    ['top', 500, 20, 'horizontal'], ['bottom', 500, 748, 'horizontal'],
    ['free', 500, 300, 'horizontal'],
  ]) {
    const { dom, ui, get, actions } = fixture(t, { settings: { layout: { x: 150, y: 200 } } });
    get('.drag').dispatchEvent(pointer(dom.window, 'pointerdown', { clientX: 160, clientY: 210 }));
    dom.window.dispatchEvent(pointer(dom.window, 'pointermove', { clientX: x, clientY: y }));
    assert.equal(actions.length, 0);
    dom.window.dispatchEvent(pointer(dom.window, 'pointerup', { clientX: x, clientY: y }));
    assert.equal(actions.length, 1);
    assert.equal(actions[0].payload.dock, dock);
    assert.equal(get('.reader').dataset.dock, dock);
    assert.equal(get('.progress').getAttribute('aria-orientation'), orientation);
    assert.equal(ui.host.style.width, orientation === 'vertical' ? '76px' : '760px');
    if (dock === 'left') assert.equal(ui.host.style.left, '12px');
    if (dock === 'right') assert.equal(ui.host.style.left, '936px');
    if (dock === 'top') assert.equal(ui.host.style.top, '12px');
    if (dock === 'bottom') assert.equal(ui.host.style.top, '680px');
    assert.equal(get('.drawer').hidden, true);
  }
});

test('corner drops choose the nearest edge, a docked orb stays collapsed, and resizing retains its edge', t => {
  const { dom, ui, get, actions } = fixture(t, { settings: { layout: { x: 150, y: 200, collapsed: true } } });
  get('.orb').dispatchEvent(pointer(dom.window, 'pointerdown', { clientX: 160, clientY: 210 }));
  dom.window.dispatchEvent(pointer(dom.window, 'pointermove', { clientX: 1008, clientY: 25 }));
  dom.window.dispatchEvent(pointer(dom.window, 'pointerup', { clientX: 1008, clientY: 25 }));
  assert.equal(actions.at(-1).payload.dock, 'right');
  assert.equal(actions.at(-1).payload.collapsed, true);
  assert.equal(ui.host.style.width, '60px');
  assert.equal(ui.host.style.left, '952px');
  assert.equal(get('.bar').hidden, true);
  Object.defineProperty(dom.window, 'innerWidth', { value: 800, configurable: true });
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(ui.host.style.left, '728px');
  ui.expand();
  assert.equal(get('.reader').dataset.dock, 'right');
  assert.equal(ui.host.style.width, '76px');
  assert.equal(ui.host.style.left, '712px');
});

test('dragging dismisses preferences and the drop click cannot accidentally open them', t => {
  const { dom, ui, get } = fixture(t, { settings: { layout: { x: 150, y: 200 } } });
  get('.settings-toggle').click();
  assert.equal(get('.drawer').hidden, false);
  get('.drag').dispatchEvent(pointer(dom.window, 'pointerdown', { clientX: 160, clientY: 210 }));
  dom.window.dispatchEvent(pointer(dom.window, 'pointermove', { clientX: 500, clientY: 20 }));
  assert.equal(get('.drawer').hidden, true);
  dom.window.dispatchEvent(pointer(dom.window, 'pointerup', { clientX: 500, clientY: 20 }));
  get('.settings-toggle').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true, detail: 1 }));
  assert.equal(get('.drawer').hidden, true);
  ui.update({ status: 'playing', wordIndex: 25, layout: { dock: 'bottom' } });
  assert.equal(get('.drawer').hidden, true);
  get('.speed-toggle').click();
  assert.equal(get('.drawer').hidden, true);
  // Keyboard activation remains available immediately after a drag.
  get('.settings-toggle').click();
  assert.equal(get('.drawer').hidden, false);
});

test('all word-seeking hints describe the double-click gesture', t => {
  const { ui, get } = fixture(t);
  for (const state of [{ model: 'local' }, { model: 'gpt-4o-mini-tts', timingSource: 'aligned' }, { timingSource: 'estimated', syncMode: 'precise' }, { syncMode: 'estimated' }]) {
    ui.update(state);
    assert.match(get('.timing-hint').textContent, /Double-click a word/);
  }
});

test('closed controls reject raw page-synthesized play, paste, settings, seek, keyboard, and pointer actions', t => {
  const { dom, ui, root, get, actions, dispatch } = fixture(t, {}, { trustedEvents: false });
  assert.equal(ui.host.shadowRoot, null);
  assert.equal(root.mode, 'closed');
  assert.equal(new dom.window.Event('click').isTrusted, false);
  get('#reader-model').value = 'gpt-4o-mini-tts';
  get('#reader-voice').value = 'nova';
  get('#reader-instructions').value = 'Synthetic instructions';
  get('#reader-text').value = 'Synthetic article that must never trigger a paid request.';
  get('#reader-speed').value = '4';
  get('.progress').value = '100';
  for (const selector of ['#reader-model', '#reader-voice', '#reader-instructions', '#reader-follow', '#reader-sync', '#reader-speed', '#reader-text', '.progress']) {
    dispatch(get(selector), 'input');
    dispatch(get(selector), 'change');
  }
  // Dispatch directly even through a disabled control, which hostile JS can do.
  for (const button of root.querySelectorAll('button')) dispatch(button, 'click');
  get('.primary').click();
  get('.drag').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }));
  get('.drag').dispatchEvent(pointer(dom.window, 'pointerdown', { clientX: 100, clientY: 100 }));
  dom.window.dispatchEvent(pointer(dom.window, 'pointermove', { clientX: 20, clientY: 20 }));
  dom.window.dispatchEvent(pointer(dom.window, 'pointerup', { clientX: 20, clientY: 20 }));
  assert.deepEqual(actions, []);
  assert.equal(get('.drawer').hidden, true);
  assert.equal(get('.reader').classList.contains('dragging'), false);
  // Internal state messages still work; guarding DOM input must not disable updates.
  ui.update({ status: 'playing', wordIndex: 22, remainingSeconds: 41 });
  assert.equal(get('.primary').getAttribute('aria-label'), 'Pause reading');
  assert.equal(get('.progress').value, '22');
  assert.equal(get('.time').textContent, '0:41');
  assert.deepEqual(actions, []);
});

test('a control detached from its protected tree still rejects untrusted activation', t => {
  const { dom, get, actions } = fixture(t, {}, { trustedEvents: false });
  // The harness retains a private reference only to exercise defense in depth.
  const play = get('.primary');
  dom.window.document.body.append(play);
  play.click();
  play.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true }));
  assert.deepEqual(actions, []);
});

test('synthetic window events cannot hijack or finish a genuine drag', t => {
  const { dom, ui, get, actions, trust } = fixture(t, { settings: { layout: { x: 100, y: 100, collapsed: true } } });
  get('.orb').dispatchEvent(pointer(dom.window, 'pointerdown', { clientX: 110, clientY: 110 }));
  trust.enabled = false;
  dom.window.dispatchEvent(pointer(dom.window, 'pointermove', { clientX: 400, clientY: 400 }));
  dom.window.dispatchEvent(pointer(dom.window, 'pointerup', { clientX: 400, clientY: 400 }));
  dom.window.dispatchEvent(pointer(dom.window, 'pointercancel', { clientX: 400, clientY: 400 }));
  assert.equal(ui.host.style.left, '100px');
  assert.equal(ui.host.style.top, '100px');
  assert.equal(get('.reader').classList.contains('dragging'), true);
  assert.deepEqual(actions, []);
  trust.enabled = true;
  dom.window.dispatchEvent(pointer(dom.window, 'pointermove', { clientX: 250, clientY: 250 }));
  dom.window.dispatchEvent(pointer(dom.window, 'pointerup', { clientX: 250, clientY: 250 }));
  assert.equal(ui.host.style.left, '240px');
  assert.equal(ui.host.style.top, '240px');
  assert.equal(actions.length, 1);
});
