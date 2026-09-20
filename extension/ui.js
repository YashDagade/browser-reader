(() => {
  'use strict';

  const ALL_VOICES = ['coral', 'marin', 'cedar', 'ash', 'sage', 'alloy', 'nova'];
  const LEGACY_VOICES = ['coral', 'ash', 'sage', 'alloy', 'nova'];
  const icons = {
    play: '<path d="m9 5 10 7-10 7Z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
    previous: '<path d="M5 5v14m14-14L9 12l10 7Z"/>',
    next: '<path d="M19 5v14M5 5l10 7-10 7Z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.play}</svg>`;
  const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const speedLabel = value => `${Number(value.toFixed(2))}×`;
  const capitalize = value => value.charAt(0).toUpperCase() + value.slice(1);

  function create({ title = 'Your article', totalWords = 0, settings = {}, onAction = () => {} } = {}) {
    document.getElementById('browser-reader-root')?.remove();
    const host = document.createElement('div');
    host.id = 'browser-reader-root';
    // Keep page styles out, including aggressive site-wide resets and transforms.
    host.style.cssText = 'all:initial;position:fixed;inset:auto 12px max(20px, env(safe-area-inset-bottom));z-index:2147483647;display:block;pointer-events:none;color-scheme:dark;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #f4f4f4; font-size: 13px; line-height: 1.4; text-align: left; }
        *, *::before, *::after { box-sizing: border-box; }
        [hidden] { display: none !important; }
        button, select, input, textarea { font: inherit; }
        button, select { -webkit-tap-highlight-color: transparent; }
        button { color: inherit; border: 0; cursor: pointer; }
        button:disabled { cursor: default; opacity: .35; }
        button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #b9c9ff; outline-offset: 4px; }
        button svg { width: 19px; height: 19px; display: block; flex-shrink: 0; }
        .reader { width: min(680px, 100%); margin: 0 auto; pointer-events: auto; color: #f4f4f4; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: left; letter-spacing: 0; }
        .bar { display: flex; align-items: center; gap: 9px; min-height: 76px; padding: 13px 14px; background: #171819; border: 1px solid #3a3b3c; border-radius: 25px; box-shadow: 0 12px 50px #0003, 0 2px 10px #0002; }
        .icon-button { display: flex; justify-content: center; align-items: center; width: 33px; height: 34px; padding: 7px; background: transparent; border-radius: 10px; flex-shrink: 0; color: #a6a7aa; transition: background 120ms, color 120ms; }
        .icon-button:hover { background: #ffffff0d; color: #fff; }
        .primary { min-width: 40px; height: 40px; padding: 0 11px; display: inline-flex; gap: 7px; align-items: center; justify-content: center; background: #f2f2f0; color: #191a1b; border-radius: 50px; flex-shrink: 0; font-size: 12px; font-weight: 600; white-space: nowrap; }
        .primary:hover { background: #fff; }
        .primary svg { width: 18px; height: 18px; }
        .primary.loading svg { animation: breathe 1s ease-in-out infinite alternate; }
        @keyframes breathe { from { opacity: .35; } to { opacity: 1; } }
        .track { min-width: 80px; flex: 1; margin: 0 2px 0 1px; }
        .track-heading { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
        .title { display: block; flex: 1; min-width: 0; color: #e9e9e9; font-weight: 500; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .time { flex-shrink: 0; color: #8e9196; font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .progress-wrap { height: 19px; display: flex; align-items: center; }
        input[type=range] { --fill: 0%; appearance: none; -webkit-appearance: none; display: block; width: 100%; height: 3px; margin: 0; border: 0; border-radius: 4px; cursor: pointer; background: linear-gradient(to right, #e7e8e8 0%, #e7e8e8 var(--fill), #4b4d51 var(--fill), #4b4d51 100%); }
        input[type=range]::-webkit-slider-thumb { appearance: none; width: 9px; height: 9px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 5px transparent; }
        input[type=range]::-moz-range-thumb { width: 9px; height: 9px; border: 0; border-radius: 50%; background: #fff; }
        input[type=range]:hover::-webkit-slider-thumb { box-shadow: 0 0 0 5px #ffffff15; }
        input[type=range]:disabled { cursor: default; opacity: .4; }
        .speed-toggle { width: auto; min-width: 43px; font-size: 12px; font-variant-numeric: tabular-nums; color: #d5d6d7; }
        .icon-button[aria-expanded=true] { color: #fff; background: #ffffff10; }
        .drawer { padding: 19px 21px 17px; margin: 0 0 9px; background: #1d1e20; border: 1px solid #3a3b3c; border-radius: 21px; box-shadow: 0 12px 50px #0003; max-height: min(70vh, 540px); overflow-y: auto; scrollbar-width: thin; }
        .drawer-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 17px; }
        .drawer-title { font-size: 13px; font-weight: 600; color: #eee; margin: 0; }
        .eyebrow { font-size: 10px; color: #8c8f94; letter-spacing: .03em; }
        .speed-heading { display: flex; align-items: center; justify-content: space-between; margin: 0 0 15px; }
        .field-label { color: #b7b9bd; font-size: 12px; display: block; }
        .speed-output { font-size: 15px; color: #f3f3f3; font-weight: 500; font-variant-numeric: tabular-nums; }
        .speed-slider { margin-bottom: 16px !important; height: 4px !important; }
        .speed-slider::-webkit-slider-thumb { width: 13px !important; height: 13px !important; }
        .presets { display: flex; gap: 6px; margin-bottom: 19px; }
        .preset { padding: 5px 0; border-radius: 7px; background: #ffffff06; border: 1px solid #ffffff0b; color: #a6a9ae; font-size: 11px; flex: 1; }
        .preset:hover, .preset[aria-pressed=true] { color: #f5f5f5; background: #ffffff14; border-color: #ffffff1c; }
        .fields { display: grid; grid-template-columns: 1.3fr 1fr; gap: 12px; padding-top: 17px; border-top: 1px solid #ffffff10; }
        .fields label { min-width: 0; }
        select { width: 100%; display: block; margin-top: 7px; padding: 8px 9px; border: 1px solid #414347; border-radius: 8px; color: #e5e6e7; background: #252629; font-size: 12px; }
        .follow { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 17px; cursor: pointer; }
        .follow input { accent-color: #dedede; width: 15px; height: 15px; margin: 0; }
        .hint { color: #8b8e94; font-size: 11px; line-height: 1.5; margin: 12px 0 0; }
        .paste-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; margin-top: 17px; padding: 14px 0 0; background: transparent; border-top: 1px solid #ffffff10; font-size: 12px; color: #c5c7cb; text-align: left; }
        .paste-toggle span:last-child { color: #7e8186; font-size: 17px; }
        textarea { resize: vertical; display: block; width: 100%; min-height: 95px; max-height: 240px; color: #eee; background: #161719; padding: 10px; border: 1px solid #414347; border-radius: 8px; margin: 11px 0 9px; line-height: 1.55; font-size: 12px; }
        textarea::placeholder { color: #70747b; }
        .paste-action { background: #e7e7e5; color: #202123; border-radius: 7px; padding: 8px 12px; font-size: 11px; font-weight: 600; }
        .notice { background: #292725; border: 1px solid #514b42; border-radius: 14px; margin: 0 0 9px; padding: 11px 14px; color: #e2d7c6; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
        @media (max-width: 560px) {
          .bar { gap: 4px; padding: 10px; min-height: 66px; border-radius: 22px; }
          .icon-button { width: 29px; padding: 6px; }
          .speed-toggle { min-width: 39px; }
          .primary-label { display: none; }
          .primary { width: 37px; min-width: 37px; height: 37px; padding: 0; }
          .track { margin-left: 5px; }
          .time { font-size: 10px; }
          .drawer { padding: 17px; }
        }
        @media (max-width: 390px) { .skip-button { display: none; } .fields { grid-template-columns: 1fr; } }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
      </style>
      <section class="reader" aria-label="Article reader">
        <div class="notice" role="alert" hidden></div>
        <div class="drawer" id="reader-settings" hidden>
          <div class="drawer-top"><h2 class="drawer-title">Make it your pace</h2><span class="eyebrow">READER</span></div>
          <div class="speed-heading"><label class="field-label" for="reader-speed">Reading speed</label><output class="speed-output" for="reader-speed">1×</output></div>
          <input class="speed-slider" id="reader-speed" type="range" min="0.75" max="4" step="0.05" aria-label="Reading speed">
          <div class="presets" aria-label="Speed presets">
            <button type="button" class="preset" data-speed="1" aria-pressed="false">1×</button>
            <button type="button" class="preset" data-speed="1.5" aria-pressed="false">1.5×</button>
            <button type="button" class="preset" data-speed="2" aria-pressed="false">2×</button>
            <button type="button" class="preset" data-speed="3" aria-pressed="false">3×</button>
            <button type="button" class="preset" data-speed="4" aria-pressed="false">4×</button>
          </div>
          <div class="fields">
            <label class="field-label" for="reader-model">Voice engine
              <select id="reader-model">
                <option value="gpt-4o-mini-tts">OpenAI · expressive</option>
                <option value="tts-1">OpenAI · classic</option>
                <option value="tts-1-hd">OpenAI · classic HD</option>
                <option value="local">Browser voice · instant</option>
              </select>
            </label>
            <label class="field-label voice-field" for="reader-voice">Voice<select id="reader-voice"></select></label>
          </div>
          <label class="follow field-label" for="reader-follow"><span>Follow words as they’re read</span><input id="reader-follow" type="checkbox"></label>
          <p class="hint timing-hint">AI voice · Word timing is estimated. Click a word in the article to jump there.</p>
          <button type="button" class="paste-toggle" aria-expanded="false" aria-controls="reader-paste"><span>Read your own text</span><span aria-hidden="true">+</span></button>
          <div id="reader-paste" hidden>
            <label class="sr-only" for="reader-text">Text to read</label>
            <textarea id="reader-text" placeholder="Paste an essay, a note, or anything you want to hear…" spellcheck="false"></textarea>
            <button type="button" class="paste-action" disabled>Start reading this text</button>
          </div>
        </div>
        <div class="bar" role="group" aria-label="Reading controls">
          <button type="button" class="primary" aria-label="Start reading">${icon('play')}<span class="primary-label">Start reading</span></button>
          <button type="button" class="icon-button skip-button previous" aria-label="Previous passage" title="Previous passage">${icon('previous')}</button>
          <button type="button" class="icon-button skip-button next" aria-label="Next passage" title="Next passage">${icon('next')}</button>
          <div class="track">
            <div class="track-heading"><span class="title"></span><span class="time"></span></div>
            <div class="progress-wrap"><input class="progress" type="range" min="0" max="1" step="1" value="0" aria-label="Reading position"></div>
          </div>
          <button type="button" class="icon-button speed-toggle" aria-label="Adjust reading speed" aria-expanded="false" aria-controls="reader-settings" title="Adjust reading speed">1×</button>
          <button type="button" class="icon-button stop" aria-label="Stop reading" title="Stop reading">${icon('stop')}</button>
          <button type="button" class="icon-button settings-toggle" aria-label="Reader settings" aria-expanded="false" aria-controls="reader-settings" title="Reader settings">${icon('settings')}</button>
          <button type="button" class="icon-button close" aria-label="Close reader" title="Close reader">${icon('close')}</button>
        </div>
        <div class="sr-only live-status" role="status" aria-live="polite" aria-atomic="true"></div>
      </section>`;

    const get = selector => root.querySelector(selector);
    const elements = {
      title: get('.title'), time: get('.time'), progress: get('.progress'), primary: get('.primary'),
      drawer: get('.drawer'), speed: get('#reader-speed'), speedOutput: get('.speed-output'),
      speedToggle: get('.speed-toggle'), settingsToggle: get('.settings-toggle'),
      voice: get('#reader-voice'), voiceField: get('.voice-field'), model: get('#reader-model'),
      follow: get('#reader-follow'), notice: get('.notice'), live: get('.live-status'),
      previous: get('.previous'), next: get('.next'), stop: get('.stop'), hint: get('.timing-hint'),
      pasteToggle: get('.paste-toggle'), paste: get('#reader-paste'), text: get('#reader-text'), pasteAction: get('.paste-action'),
    };
    let state = {
      title, totalWords, wordIndex: 0, status: 'ready', speed: 1, voice: 'coral',
      model: 'gpt-4o-mini-tts', follow: true, connected: undefined, error: '', ...settings,
    };
    let destroyed = false;
    let seeking = false;
    let drawerOpen = false;
    let lastAnnouncement = '';
    let lastVoiceModel = '';
    const emit = (action, payload) => {
      if (!destroyed) onAction(action, payload);
    };

    function paintRange(input, value, min, max) {
      input.style.setProperty('--fill', `${max > min ? clamp((value - min) / (max - min) * 100, 0, 100) : 0}%`);
    }

    function renderPosition(wordIndex) {
      const count = Math.max(0, number(state.totalWords, 0));
      const index = clamp(number(wordIndex, 0), 0, Math.max(0, count - 1));
      const remaining = state.status === 'ended' ? 0 : Math.ceil(Math.max(0, count - index) / (195 * state.speed) * 60);
      elements.time.textContent = state.status === 'loading' ? 'Preparing…' : count ? `~${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : '';
      elements.time.title = 'Estimated listening time remaining';
      elements.progress.max = String(Math.max(1, count - 1));
      elements.progress.value = String(state.status === 'ended' ? Math.max(0, count - 1) : index);
      elements.progress.disabled = count < 2;
      elements.progress.setAttribute('aria-valuetext', count ? `Word ${Math.min(count, index + 1)} of ${count}` : 'No article text');
      paintRange(elements.progress, state.status === 'ended' ? count - 1 : index, 0, Math.max(1, count - 1));
    }

    function renderVoices() {
      if (lastVoiceModel !== state.model) {
        const voices = state.model.startsWith('tts-1') ? LEGACY_VOICES : ALL_VOICES;
        elements.voice.replaceChildren(...voices.map(voice => {
          const option = document.createElement('option');
          option.value = voice;
          option.textContent = capitalize(voice);
          return option;
        }));
        lastVoiceModel = state.model;
      }
      elements.voice.value = state.voice;
      if (!elements.voice.value) elements.voice.value = 'coral';
      elements.voiceField.hidden = state.model === 'local';
      elements.hint.textContent = state.model === 'local'
        ? 'Your browser’s voice · Click a word in the article to jump there.'
        : 'AI voice · Word timing is estimated. Click a word in the article to jump there.';
    }

    function render() {
      state.speed = clamp(number(state.speed, 1), 0.75, 4);
      state.model = String(state.model || 'gpt-4o-mini-tts');
      const playing = state.status === 'playing';
      const loading = state.status === 'loading';
      const active = playing || loading || state.status === 'paused';
      const label = playing ? 'Pause reading' : loading ? 'Pause reading' : state.status === 'paused' ? 'Resume reading' : state.status === 'ended' ? 'Read again' : 'Start reading';
      const buttonIcon = playing || loading ? 'pause' : 'play';
      if (elements.primary.dataset.icon !== buttonIcon) {
        elements.primary.innerHTML = `${icon(buttonIcon)}<span class="primary-label"></span>`;
        elements.primary.dataset.icon = buttonIcon;
      }
      elements.primary.querySelector('.primary-label').textContent = label;
      elements.primary.querySelector('.primary-label').hidden = active;
      elements.primary.setAttribute('aria-label', label);
      elements.primary.title = label;
      elements.primary.classList.toggle('loading', loading);
      elements.title.textContent = state.title || title || 'Your article';
      elements.title.title = state.title || title || 'Your article';
      if (!seeking) renderPosition(state.wordIndex);
      const speedText = speedLabel(state.speed);
      elements.speed.value = String(state.speed);
      elements.speed.setAttribute('aria-valuetext', `${Number(state.speed.toFixed(2))} times normal speed`);
      elements.speedOutput.textContent = speedText;
      elements.speedToggle.textContent = speedText;
      elements.speedToggle.setAttribute('aria-label', `Reading speed ${speedText}. Adjust speed`);
      paintRange(elements.speed, state.speed, 0.75, 4);
      root.querySelectorAll('.preset').forEach(button => button.setAttribute('aria-pressed', String(Math.abs(Number(button.dataset.speed) - state.speed) < 0.005)));
      elements.model.value = state.model;
      elements.follow.checked = Boolean(state.follow);
      renderVoices();
      elements.previous.disabled = !state.totalWords;
      elements.next.disabled = !state.totalWords;
      elements.stop.disabled = !active && state.status !== 'error';
      const connectionHint = state.connected === false && state.model !== 'local'
        ? 'OpenAI isn’t connected. Choose Browser voice in settings to listen immediately.' : '';
      const error = state.error ? String(state.error.message || state.error) : '';
      const notice = [error, connectionHint].filter(Boolean).join(' ');
      elements.notice.hidden = !notice;
      elements.notice.textContent = notice;
      const announcement = error || (loading ? 'Preparing audio' : state.status === 'playing' ? 'Reading' : state.status === 'paused' ? 'Reading paused' : state.status === 'ended' ? 'Finished reading' : state.status === 'stopped' ? 'Reading stopped' : 'Ready to read');
      if (announcement !== lastAnnouncement) {
        elements.live.textContent = announcement;
        lastAnnouncement = announcement;
      }
    }

    function setDrawer(open, focusSpeed = false) {
      drawerOpen = open;
      elements.drawer.hidden = !open;
      elements.settingsToggle.setAttribute('aria-expanded', String(open));
      elements.speedToggle.setAttribute('aria-expanded', String(open));
      if (open && focusSpeed) elements.speed.focus();
    }

    function changeSettings(changes) {
      state = { ...state, ...changes };
      render();
      emit('settings', changes);
    }

    elements.primary.addEventListener('click', () => emit(state.status === 'playing' || state.status === 'loading' ? 'pause' : 'play'));
    elements.previous.addEventListener('click', () => emit('previous'));
    elements.next.addEventListener('click', () => emit('next'));
    elements.stop.addEventListener('click', () => emit('stop'));
    get('.close').addEventListener('click', () => emit('close'));
    elements.settingsToggle.addEventListener('click', () => setDrawer(!drawerOpen));
    elements.speedToggle.addEventListener('click', () => setDrawer(!drawerOpen, true));
    elements.speed.addEventListener('input', () => changeSettings({ speed: Number(elements.speed.value) }));
    root.querySelectorAll('.preset').forEach(button => button.addEventListener('click', () => changeSettings({ speed: Number(button.dataset.speed) })));
    elements.model.addEventListener('change', () => {
      const model = elements.model.value;
      const changes = { model };
      if (model.startsWith('tts-1') && !LEGACY_VOICES.includes(state.voice)) changes.voice = 'coral';
      changeSettings(changes);
    });
    elements.voice.addEventListener('change', () => changeSettings({ voice: elements.voice.value }));
    elements.follow.addEventListener('change', () => changeSettings({ follow: elements.follow.checked }));
    elements.progress.addEventListener('pointerdown', () => { seeking = true; });
    elements.progress.addEventListener('pointerup', () => { seeking = false; });
    elements.progress.addEventListener('input', () => {
      seeking = true;
      renderPosition(Number(elements.progress.value));
    });
    elements.progress.addEventListener('change', () => {
      const wordIndex = Number(elements.progress.value);
      seeking = false;
      state.wordIndex = wordIndex;
      renderPosition(wordIndex);
      emit('seek', { wordIndex });
    });
    elements.progress.addEventListener('pointercancel', () => { seeking = false; renderPosition(state.wordIndex); });
    elements.progress.addEventListener('blur', () => { seeking = false; });
    elements.pasteToggle.addEventListener('click', () => {
      const open = elements.paste.hidden;
      elements.paste.hidden = !open;
      elements.pasteToggle.setAttribute('aria-expanded', String(open));
      elements.pasteToggle.lastElementChild.textContent = open ? '−' : '+';
      if (open) elements.text.focus();
    });
    elements.text.addEventListener('input', () => { elements.pasteAction.disabled = !elements.text.value.trim(); });
    elements.pasteAction.addEventListener('click', () => {
      const text = elements.text.value.trim();
      if (!text) return;
      emit('paste', { text });
      setDrawer(false);
    });
    root.addEventListener('keydown', event => {
      // Website shortcuts must not capture typing or arrow keys inside the player.
      event.stopPropagation();
      if (event.key === 'Escape' && drawerOpen) {
        event.preventDefault();
        setDrawer(false);
        elements.settingsToggle.focus();
      }
    });
    // Avoid page click-to-seek handlers interpreting clicks in this shadow root.
    host.addEventListener('click', event => event.stopPropagation());
    render();
    document.documentElement.appendChild(host);

    return {
      host,
      update(nextState = {}) {
        if (destroyed) return;
        state = { ...state, ...nextState };
        render();
      },
      destroy() {
        destroyed = true;
        host.remove();
      },
    };
  }

  globalThis.ReaderUI = { create };
})();
