(() => {
  'use strict';

  const ALL_VOICES = ['alloy', 'cedar', 'nova', 'coral', 'marin', 'ash', 'ballad', 'echo', 'fable', 'onyx', 'sage', 'shimmer', 'verse'];
  const LEGACY_VOICES = ['alloy', 'nova', 'coral', 'ash', 'echo', 'fable', 'onyx', 'sage', 'shimmer'];
  const icons = {
    play: '<path d="m9 5 10 7-10 7Z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
    previous: '<path d="M5 5v14m14-14L9 12l10 7Z"/>',
    next: '<path d="M19 5v14M5 5l10 7-10 7Z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    collapse: '<path d="m5 9 7 7 7-7"/>',
    drag: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3"/>',
    hermes: '<path d="M4 12h3l3-6 4 12 3-6h3" stroke-width="2"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.play}</svg>`;
  const number = (value, fallback) => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.min(Math.max(min, max), Math.max(min, value));
  const speedLabel = value => `${Number(value.toFixed(2))}×`;
  const nextSpeed = speed => [1, 1.5, 2, 4].find(value => value > speed + 0.005) || 1;
  const capitalize = value => value.charAt(0).toUpperCase() + value.slice(1);

  function create({ title = 'Your article', totalWords = 0, settings = {}, onAction = () => {} } = {}) {
    const previous = document.getElementById('browser-reader-root');
    if (previous?._readerDestroy) previous._readerDestroy();
    else previous?.remove();
    const host = document.createElement('div');
    host.id = 'browser-reader-root';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;display:block;pointer-events:none;color-scheme:dark;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing: border-box; }
        [hidden] { display: none !important; }
        button, select, input, textarea { font: inherit; }
        button, select { -webkit-tap-highlight-color: transparent; }
        button { color: inherit; border: 0; cursor: pointer; }
        button:disabled { cursor: default; opacity: .4; }
        button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid #d9c69a; outline-offset: 3px; }
        button svg { width: 21px; height: 21px; display: block; flex-shrink: 0; }
        .reader { width: 100%; position: relative; pointer-events: auto; color: #f5f4f0; font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: left; letter-spacing: 0; }
        .bar { display: flex; align-items: center; gap: 5px; min-height: 76px; padding: 12px; background: #1b1c1e; border: 1px solid #414142; border-radius: 24px; box-shadow: 0 8px 32px #0003; }
        .icon-button { display: flex; justify-content: center; align-items: center; width: 44px; height: 44px; padding: 10px; background: transparent; border-radius: 12px; flex-shrink: 0; color: #c5c5c8; }
        .icon-button:hover { background: #ffffff10; color: #fff; }
        .drag { width: 40px; padding: 8px; cursor: grab; touch-action: none; color: #909094; }
        .drag:active, .reader.dragging .orb { cursor: grabbing; }
        .reader.dragging { user-select: none; }
        .primary { min-width: 46px; min-height: 46px; padding: 0 15px; display: inline-flex; gap: 9px; align-items: center; justify-content: center; background: #ebe4d4; color: #23221f; border-radius: 50px; flex-shrink: 0; font-size: 15px; font-weight: 600; white-space: nowrap; }
        .primary:hover { background: #fff5df; }
        .primary.loading svg { animation: breathe 1s ease-in-out infinite alternate; }
        @keyframes breathe { from { opacity: .35; } to { opacity: 1; } }
        .track { min-width: 65px; flex: 1; margin: 0 7px; }
        .track-heading { display: flex; gap: 10px; align-items: baseline; min-width: 0; }
        .title { display: block; flex: 1; min-width: 0; color: #f3f1ea; font-weight: 500; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .time { flex-shrink: 0; color: #b9b9bb; font-size: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .progress-wrap { height: 24px; display: flex; align-items: center; }
        input[type=range] { --fill: 0%; appearance: none; -webkit-appearance: none; display: block; width: 100%; height: 5px; margin: 0; border: 0; border-radius: 5px; cursor: pointer; background: linear-gradient(to right, #e6d7b7 0%, #e6d7b7 var(--fill), #555559 var(--fill), #555559 100%); }
        input[type=range]::-webkit-slider-thumb { appearance: none; width: 13px; height: 13px; border-radius: 50%; background: #f6efe0; }
        input[type=range]::-moz-range-thumb { width: 13px; height: 13px; border: 0; border-radius: 50%; background: #f6efe0; }
        input[type=range]:disabled { cursor: default; opacity: .4; }
        .speed-toggle { width: 56px; font-size: 16px; font-variant-numeric: tabular-nums; color: #f0ece3; }
        .icon-button[aria-expanded=true] { color: #fff; background: #ffffff10; }
        .orb { width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; background: #1b1c1e; color: #eddfbd; border: 1px solid #55504a; border-radius: 50%; box-shadow: 0 6px 22px #0003; touch-action: none; cursor: grab; }
        .orb svg { width: 31px; height: 31px; }
        .orb[data-playing=true] { border: 2px solid #d0b87e; }
        .reader[data-dock=left] .bar, .reader[data-dock=right] .bar { flex-direction: column; gap: 5px; padding: 10px 8px; border-radius: 25px; max-height: calc(100vh - 24px); overflow-y: auto; scrollbar-width: none; }
        .reader[data-dock=left] .drag, .reader[data-dock=right] .drag { width: 44px; height: 40px; transform: rotate(90deg); }
        .reader[data-dock=left] .primary, .reader[data-dock=right] .primary { width: 46px; padding: 0; }
        .reader[data-dock=left] .primary-label, .reader[data-dock=right] .primary-label,
        .reader[data-dock=left] .title, .reader[data-dock=right] .title { display: none; }
        .reader[data-dock=left] .track, .reader[data-dock=right] .track { flex: none; width: 52px; min-width: 0; margin: 3px 0; }
        .reader[data-dock=left] .track-heading, .reader[data-dock=right] .track-heading { justify-content: center; }
        .reader[data-dock=left] .progress-wrap, .reader[data-dock=right] .progress-wrap { justify-content: center; height: 104px; padding: 12px 0; }
        .reader[data-dock=left] .progress, .reader[data-dock=right] .progress { writing-mode: vertical-lr; direction: rtl; width: 5px; height: 80px; background: linear-gradient(to top, #e6d7b7 0%, #e6d7b7 var(--fill), #555559 var(--fill), #555559 100%); }
        .drawer { position: fixed; width: min(420px, calc(100vw - 24px)); padding: 20px; background: #202123; border: 1px solid #434345; border-radius: 22px; box-shadow: 0 8px 32px #0003; max-height: min(75vh, 690px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
        .drawer-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .drawer-title { font-size: 19px; font-weight: 600; color: #f0e7d5; margin: 0; }
        .bar > * { flex-shrink: 0; }
        .bar > .track { flex-shrink: 1; }
        .drawer-dismiss { margin: -8px -8px -8px 0; }
        .speed-heading { display: flex; align-items: center; justify-content: space-between; margin: 0 0 16px; }
        .field-label { color: #d1d1d3; font-size: 15px; display: block; }
        .speed-output { font-size: 18px; color: #f4eee0; font-weight: 500; font-variant-numeric: tabular-nums; }
        .speed-slider { margin-bottom: 18px !important; }
        select, input[type=number] { width: 100%; display: block; margin-top: 7px; min-height: 44px; padding: 9px 11px; border: 1px solid #4b4c50; border-radius: 11px; color: #efeff0; background: #292a2d; font-size: 16px; }
        .follow { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; margin-top: 8px; cursor: pointer; }
        .follow input { accent-color: #ded1b3; width: 19px; height: 19px; margin: 0; }
        .hint { color: #aaabae; font-size: 14px; line-height: 1.5; margin: 8px 0 0; }
        .timing-hint { margin-top: 4px; }
        details { border-top: 1px solid #ffffff15; margin-top: 15px; padding-top: 5px; }
        summary { min-height: 44px; padding: 11px 0; color: #dededc; cursor: pointer; font-size: 15px; }
        .advanced .field-label + .field-label { margin-top: 14px; }
        .prompt-label { margin-top: 16px; }
        textarea { resize: vertical; display: block; width: 100%; min-height: 100px; max-height: 220px; color: #eee; background: #18191b; padding: 12px; border: 1px solid #4b4c50; border-radius: 11px; margin: 8px 0; line-height: 1.5; font-size: 16px; }
        textarea:disabled { opacity: .5; }
        textarea::placeholder { color: #95969b; }
        .prompt-count { text-align: right; color: #a9aaae; font-size: 13px; margin: 4px 0 0; }
        .paste-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 48px; margin-top: 12px; padding: 10px 0 0; background: transparent; border-top: 1px solid #ffffff15; font-size: 15px; color: #dededc; text-align: left; }
        .paste-toggle span:last-child { color: #b1b2b7; font-size: 22px; }
        .paste-action { background: #ebe4d4; color: #23221f; border-radius: 10px; padding: 10px 15px; min-height: 44px; font-size: 15px; font-weight: 600; }
        .dock-controls { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 8px; }
        .dock-button { border: 1px solid #4b4c50; background: transparent; min-height: 42px; flex: 1; border-radius: 10px; font-size: 14px; }
        .dock-button[aria-pressed=true] { background: #ddc79418; border-color: #ddc79466; }
        .utility { display: flex; gap: 12px; justify-content: space-between; margin-top: 12px; padding-top: 8px; border-top: 1px solid #ffffff15; }
        .utility button { background: transparent; display: flex; gap: 8px; align-items: center; padding: 8px 0; min-height: 44px; color: #c2c2c5; font-size: 14px; }
        .utility button svg { width: 17px; height: 17px; }
        .connect { display: block; margin-top: 10px; background: #ebe4d4; color: #23221f; border-radius: 9px; padding: 9px 13px; font-size: 15px; font-weight: 600; }
        .notice { position: fixed; width: min(400px, calc(100vw - 24px)); background: #302b24; border: 1px solid #62523b; border-radius: 14px; padding: 12px 15px; color: #f0e0c4; font-size: 15px; overflow-wrap: anywhere; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
        @media (max-width: 660px) { .primary-label { display: none; } .primary { width: 46px; padding: 0; } .bar { gap: 2px; padding: 9px; } .track-heading { flex-direction: column; gap: 0; } .title { max-width: 100%; width: 100%; } .progress-wrap { height: 18px; } }
        @media (max-width: 440px) { .skip-button { display: none; } .bar { gap: 0; } .track { margin: 0 3px; min-width: 40px; } .speed-toggle { width: 47px; font-size: 15px; } .drawer { padding: 17px; } .reader[data-dock=left] .skip-button, .reader[data-dock=right] .skip-button { display: flex; } }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; } }
      </style>
      <section class="reader" aria-label="Hermes article reader">
        <div class="notice" role="alert" hidden><span class="notice-message"></span><button type="button" class="connect" hidden>Connect OpenAI</button></div>
        <div class="drawer" id="reader-settings" hidden>
          <div class="drawer-top"><h2 class="drawer-title">Hermes</h2><button type="button" class="icon-button drawer-dismiss" aria-label="Close settings">${icon('close')}</button></div>
          <div class="speed-heading"><label class="field-label" for="reader-speed">Reading speed</label><output class="speed-output" for="reader-speed">1×</output></div>
          <input class="speed-slider" id="reader-speed" type="range" min="0.75" max="4" step="0.05" aria-label="Reading speed">
          <label class="field-label voice-field" for="reader-voice">Voice<select id="reader-voice"></select></label>
          <label class="follow field-label" for="reader-follow"><span>Auto-scroll with the voice</span><input id="reader-follow" type="checkbox"></label>
          <p class="hint timing-hint"></p>
          <details class="advanced">
            <summary>Voice &amp; reading preferences</summary>
            <label class="field-label" for="reader-generation-speed">Default narration speed (×)
              <input id="reader-generation-speed" type="number" min="0.75" max="4" step="0.05" value="2.3" aria-describedby="reader-generation-speed-help">
            </label>
            <p class="hint" id="reader-generation-speed-help">OpenAI generates at this speed; new articles start here. Changes apply when you leave this field and may generate new audio. The reading-speed slider reuses audio at no extra cost.</p>
            <label class="field-label" for="reader-model">Voice engine
              <select id="reader-model">
                <option value="gpt-4o-mini-tts">OpenAI · expressive</option>
                <option value="tts-1">OpenAI · classic</option>
                <option value="tts-1-hd">OpenAI · classic HD</option>
              </select>
            </label>
            <label class="follow field-label" for="reader-sync"><span>Tighter word sync</span><input id="reader-sync" type="checkbox" aria-describedby="reader-sync-help"></label>
            <p class="hint" id="reader-sync-help">Adds a small transcription request to match words to the audio.</p>
            <label class="field-label prompt-label" for="reader-instructions">Voice instructions</label>
            <textarea id="reader-instructions" maxlength="1000" placeholder="This is a physics article. Pronounce technical terms carefully; keep a clear, natural pace." aria-describedby="reader-instructions-help" spellcheck="false"></textarea>
            <p class="hint" id="reader-instructions-help"></p>
            <p class="prompt-count" aria-live="off">0 / 1000</p>
            <p class="field-label">Toolbar position</p>
            <div class="dock-controls" role="group" aria-label="Toolbar position">
              <button class="dock-button" type="button" data-dock="left" aria-pressed="false">Left</button>
              <button class="dock-button" type="button" data-dock="free" aria-pressed="true">Floating</button>
              <button class="dock-button" type="button" data-dock="right" aria-pressed="false">Right</button>
              <button class="dock-button" type="button" data-dock="top" aria-pressed="false">Top</button>
              <button class="dock-button" type="button" data-dock="bottom" aria-pressed="false">Bottom</button>
            </div>
          </details>
          <button type="button" class="paste-toggle" aria-expanded="false" aria-controls="reader-paste"><span>Read your own text</span><span aria-hidden="true">+</span></button>
          <div id="reader-paste" hidden>
            <label class="sr-only" for="reader-text">Text to read</label>
            <textarea id="reader-text" placeholder="Paste an essay, a note, or anything you want to hear…" spellcheck="false"></textarea>
            <button type="button" class="paste-action" disabled>Start reading this text</button>
          </div>
          <div class="utility"><button type="button" class="stop" aria-label="Stop reading">${icon('stop')}Stop reading</button><button type="button" class="close" aria-label="Close reader">${icon('close')}Close Hermes</button></div>
        </div>
        <div class="bar" role="group" aria-label="Reading controls">
          <button type="button" class="icon-button drag" aria-label="Move Hermes" title="Drag near an edge to dock; arrow keys also move the toolbar">${icon('drag')}</button>
          <button type="button" class="primary" aria-label="Start reading">${icon('play')}<span class="primary-label">Start reading</span></button>
          <button type="button" class="icon-button skip-button previous" aria-label="Previous passage" title="Previous passage">${icon('previous')}</button>
          <button type="button" class="icon-button skip-button next" aria-label="Next passage" title="Next passage">${icon('next')}</button>
          <div class="track"><div class="track-heading"><span class="title"></span><span class="time"></span></div><div class="progress-wrap"><input class="progress" type="range" min="0" max="1" step="1" value="0" aria-label="Reading position"></div></div>
          <button type="button" class="icon-button speed-toggle" aria-label="Reading speed 1×. Change to 1.5×" title="Change speed to 1.5×">1×</button>
          <button type="button" class="icon-button settings-toggle" aria-label="Reader settings" aria-expanded="false" aria-controls="reader-settings" title="Reader settings">${icon('settings')}</button>
          <button type="button" class="icon-button collapse" aria-label="Collapse Hermes" title="Collapse Hermes">${icon('collapse')}</button>
        </div>
        <button type="button" class="orb" aria-label="Expand Hermes" title="Expand Hermes · drag to move" hidden>${icon('hermes')}</button>
        <div class="sr-only live-status" role="status" aria-live="polite" aria-atomic="true"></div>
      </section>`;

    const get = selector => root.querySelector(selector);
    const elements = {
      reader: get('.reader'), bar: get('.bar'), orb: get('.orb'), title: get('.title'), time: get('.time'), progress: get('.progress'), primary: get('.primary'),
      drawer: get('.drawer'), speed: get('#reader-speed'), speedOutput: get('.speed-output'),
      speedToggle: get('.speed-toggle'), settingsToggle: get('.settings-toggle'),
      voice: get('#reader-voice'), voiceField: get('.voice-field'), model: get('#reader-model'), generationSpeed: get('#reader-generation-speed'),
      follow: get('#reader-follow'), sync: get('#reader-sync'), syncHelp: get('#reader-sync-help'), instructions: get('#reader-instructions'), instructionsHelp: get('#reader-instructions-help'), promptCount: get('.prompt-count'),
      notice: get('.notice'), noticeMessage: get('.notice-message'), connect: get('.connect'), live: get('.live-status'), previous: get('.previous'), next: get('.next'), stop: get('.stop'), hint: get('.timing-hint'),
      pasteToggle: get('.paste-toggle'), paste: get('#reader-paste'), text: get('#reader-text'), pasteAction: get('.paste-action'),
    };
    let state = {
      title, totalWords, wordIndex: 0, status: 'ready', speed: 2.3, generationSpeed: 2.3, voice: 'alloy', instructions: '', syncMode: 'precise',
      model: 'gpt-4o-mini-tts', follow: true, connected: undefined, error: '', ...settings,
    };
    let layout = { dock: 'free', collapsed: false, ...settings.layout };
    let destroyed = false, seeking = false, drawerOpen = false, drag = null, suppressOrbClick = false;
    let lastAnnouncement = '', lastVoiceModel = '', suppressPointerClickUntil = 0;
    const isVertical = () => layout.dock === 'left' || layout.dock === 'right';
    const emit = (action, payload) => { if (!destroyed) onAction(action, payload); };
    // Guard every action independently of shadow encapsulation. Browser-owned
    // trust cannot be forged with click() or dispatchEvent().
    const listen = (target, type, handler, options) => target.addEventListener(type, event => {
      if (!event.isTrusted || destroyed) return;
      handler(event);
    }, options);

    function panelPosition() {
      const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
      const width = Math.min(420, Math.max(0, viewportWidth - 24));
      const barHeight = (layout.collapsed ? 60 : elements.bar.getBoundingClientRect().height) || (isVertical() ? 430 : 76);
      const anchorX = number(layout.x, 12), anchorY = number(layout.y, 12);
      const panelHeight = elements.drawer.getBoundingClientRect().height || Math.min(540, viewportHeight * .75);
      let x = layout.dock === 'left' ? anchorX + 84 : layout.dock === 'right' ? anchorX - width - 12 : anchorX;
      let y = isVertical() ? anchorY : anchorY >= panelHeight + 24 ? anchorY - panelHeight - 12 : anchorY + barHeight + 12;
      elements.drawer.style.left = `${clamp(x, 12, viewportWidth - width - 12)}px`;
      elements.drawer.style.top = `${clamp(y, 12, viewportHeight - panelHeight - 12)}px`;
      const noticeHeight = elements.notice.getBoundingClientRect().height || 85;
      elements.notice.style.left = `${clamp(anchorX, 12, viewportWidth - Math.min(400, viewportWidth - 24) - 12)}px`;
      elements.notice.style.top = `${clamp(anchorY > noticeHeight + 24 ? anchorY - noticeHeight - 12 : anchorY + barHeight + 12, 12, viewportHeight - noticeHeight - 12)}px`;
    }

    function applyLayout() {
      layout.dock = ['left', 'right', 'top', 'bottom'].includes(layout.dock) ? layout.dock : 'free';
      layout.collapsed = Boolean(layout.collapsed);
      elements.reader.dataset.dock = layout.dock;
      elements.bar.hidden = layout.collapsed;
      elements.orb.hidden = !layout.collapsed;
      const width = layout.collapsed ? 60 : isVertical() ? 76 : Math.min(760, window.innerWidth - 24);
      host.style.width = `${Math.max(60, width)}px`;
      const measured = elements.bar.getBoundingClientRect().height;
      const height = layout.collapsed ? 60 : measured || (isVertical() ? 430 : 76);
      layout.x = clamp(number(layout.x, (window.innerWidth - width) / 2), 12, window.innerWidth - width - 12);
      layout.y = clamp(number(layout.y, window.innerHeight - height - 24), 12, window.innerHeight - height - 12);
      if (layout.dock === 'left') layout.x = 12;
      if (layout.dock === 'right') layout.x = Math.max(12, window.innerWidth - width - 12);
      if (layout.dock === 'top') layout.y = 12;
      if (layout.dock === 'bottom') layout.y = Math.max(12, window.innerHeight - height - 12);
      host.style.left = `${layout.x}px`;
      host.style.top = `${layout.y}px`;
      elements.progress.setAttribute('aria-orientation', isVertical() ? 'vertical' : 'horizontal');
      root.querySelectorAll('.dock-button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.dock === layout.dock)));
      panelPosition();
    }

    function changeLayout(changes) {
      layout = { ...layout, ...changes };
      applyLayout();
      emit('layout', { ...layout });
    }

    function paintRange(input, value, min, max) {
      input.style.setProperty('--fill', `${max > min ? clamp((value - min) / (max - min) * 100, 0, 100) : 0}%`);
    }

    function renderPosition(wordIndex, preview = false) {
      const count = Math.max(0, number(state.totalWords, 0));
      const index = clamp(number(wordIndex, 0), 0, Math.max(0, count - 1));
      const measured = !preview && Number.isFinite(state.remainingSeconds);
      const remaining = state.status === 'ended' ? 0 : Math.ceil(Math.max(0, measured ? state.remainingSeconds : (count - index) / (195 * state.speed) * 60));
      elements.time.textContent = state.status === 'loading' ? 'Preparing…' : count ? `${measured ? '' : '~'}${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : '';
      elements.time.title = `${measured ? '' : 'Estimated '}listening time remaining (minutes:seconds)`;
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
      if (!elements.voice.value) elements.voice.value = 'alloy';
      elements.voiceField.hidden = false;
      elements.hint.textContent = state.timingSource === 'aligned' ? 'AI voice · Words matched to audio. Double-click a word to jump there.'
          : state.syncMode === 'precise' ? 'AI voice · Word sync improves when audio is matched. Double-click a word to jump there.'
            : 'AI voice · Estimated word timing. Double-click a word to jump there.';
      elements.sync.checked = state.syncMode !== 'estimated';
      elements.sync.disabled = false;
      elements.syncHelp.textContent = 'Adds a small transcription request to match words to the audio.';
      elements.instructions.disabled = state.model !== 'gpt-4o-mini-tts';
      // Do not overwrite an in-progress edit when playback publishes new words.
      if (root.activeElement !== elements.instructions) elements.instructions.value = String(state.instructions || '').slice(0, 1000);
      if (root.activeElement !== elements.generationSpeed) elements.generationSpeed.value = String(state.generationSpeed);
      elements.promptCount.textContent = `${elements.instructions.value.length} / 1000`;
      elements.instructionsHelp.textContent = state.model === 'gpt-4o-mini-tts'
        ? 'Add subject, pronunciation, or delivery guidance. Hermes still reads the source verbatim. Saved when you leave this field.'
        : 'Voice instructions work with OpenAI expressive. Your saved instructions stay available when you switch back.';
    }

    function render() {
      state.speed = clamp(number(state.speed, 1), 0.75, 4);
      state.generationSpeed = clamp(number(state.generationSpeed, 2.3), 0.75, 4);
      state.model = ['gpt-4o-mini-tts','tts-1','tts-1-hd'].includes(state.model) ? state.model : 'gpt-4o-mini-tts';
      const playing = state.status === 'playing', loading = state.status === 'loading';
      const active = playing || loading || state.status === 'paused';
      const label = playing || loading ? 'Pause reading' : state.status === 'paused' ? 'Resume reading' : state.status === 'ended' ? 'Read again' : 'Start reading';
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
      elements.orb.dataset.playing = String(playing || loading);
      elements.orb.title = `Expand Hermes · ${playing ? 'reading' : loading ? 'preparing audio' : state.status === 'paused' ? 'paused' : 'drag to move'}`;
      elements.title.textContent = state.title || title || 'Your article';
      elements.title.title = state.title || title || 'Your article';
      if (!seeking) renderPosition(state.wordIndex);
      const speedText = speedLabel(state.speed);
      elements.speed.value = String(state.speed);
      elements.speed.setAttribute('aria-valuetext', `${Number(state.speed.toFixed(2))} times normal speed`);
      elements.speedOutput.textContent = speedText;
      elements.speedToggle.textContent = speedText;
      elements.speedToggle.setAttribute('aria-label', `Reading speed ${speedText}. Change to ${speedLabel(nextSpeed(state.speed))}`);
      elements.speedToggle.title = `Change speed to ${speedLabel(nextSpeed(state.speed))}`;
      paintRange(elements.speed, state.speed, 0.75, 4);
      elements.model.value = state.model;
      elements.follow.checked = Boolean(state.follow);
      renderVoices();
      elements.previous.disabled = !state.totalWords;
      elements.next.disabled = !state.totalWords;
      elements.stop.disabled = !active && state.status !== 'error';
      const connectionHint = state.connected === false
        ? 'OpenAI isn’t connected. Add your API key in Hermes Options to start reading.' : '';
      const error = state.error ? String(state.error.message || state.error) : '';
      const notice = [error, connectionHint].filter(Boolean).join(' ');
      const noticeChanged = elements.noticeMessage.textContent !== notice;
      elements.notice.hidden = !notice;
      elements.noticeMessage.textContent = notice;
      elements.connect.hidden = state.connected !== false;
      if (noticeChanged && host.isConnected) panelPosition();
      const announcement = error || (loading ? 'Preparing audio' : playing ? 'Reading' : state.status === 'paused' ? 'Reading paused' : state.status === 'ended' ? 'Finished reading' : state.status === 'stopped' ? 'Reading stopped' : 'Ready to read');
      if (announcement !== lastAnnouncement) {
        elements.live.textContent = announcement;
        lastAnnouncement = announcement;
      }
    }

    function setDrawer(open) {
      drawerOpen = open;
      elements.drawer.hidden = !open;
      elements.settingsToggle.setAttribute('aria-expanded', String(open));
      if (open) panelPosition();
    }

    function changeSettings(changes) {
      if (Object.hasOwn(changes, 'speed') && Number.isFinite(state.remainingSeconds)) state.remainingSeconds *= state.speed / changes.speed;
      state = { ...state, ...changes };
      render();
      emit('settings', changes);
    }

    function endDrag(event) {
      if (event && !event.isTrusted) return;
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      const moved = drag.moved;
      const wasOrb = drag.target === elements.orb;
      if (drag.target.hasPointerCapture?.(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
      drag = null;
      elements.reader.classList.remove('dragging');
      window.removeEventListener('pointermove', moveDrag);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      if (moved) {
        suppressOrbClick = wasOrb;
        suppressPointerClickUntil = performance.now() + 300;
        if (event?.type === 'pointerup') {
          // Use the drop point, not the far end of the wide toolbar, to choose an edge.
          const edges = [
            ['left', event.clientX], ['right', window.innerWidth - event.clientX],
            ['top', event.clientY], ['bottom', window.innerHeight - event.clientY],
          ].sort((a, b) => a[1] - b[1]);
          layout.dock = edges[0][1] <= 48 ? edges[0][0] : 'free';
          applyLayout();
        }
        emit('layout', { ...layout });
      }
    }

    function moveDrag(event) {
      if (!event.isTrusted || !drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      event.preventDefault();
      if (!drag.moved) setDrawer(false);
      drag.moved = true;
      layout = { ...layout, dock: 'free', x: drag.x + dx, y: drag.y + dy };
      applyLayout();
    }

    function beginDrag(event) {
      if (!event.isTrusted || event.button !== 0 || destroyed) return;
      suppressOrbClick = false;
      drag = { pointerId: event.pointerId, target: event.currentTarget, startX: event.clientX, startY: event.clientY, x: layout.x, y: layout.y, moved: false };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      elements.reader.classList.add('dragging');
      window.addEventListener('pointermove', moveDrag, { passive: false });
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    }

    listen(elements.connect, 'click', () => emit('setup'));
    listen(elements.primary, 'click', () => emit(state.status === 'playing' || state.status === 'loading' ? 'pause' : 'play'));
    listen(elements.previous, 'click', () => emit('previous'));
    listen(elements.next, 'click', () => emit('next'));
    listen(elements.stop, 'click', () => emit('stop'));
    listen(get('.close'), 'click', () => emit('close'));
    listen(get('.collapse'), 'click', () => { setDrawer(false); changeLayout({ collapsed: true }); elements.orb.focus(); });
    listen(elements.orb, 'click', () => {
      if (suppressOrbClick) { suppressOrbClick = false; return; }
      changeLayout({ collapsed: false });
      elements.primary.focus();
    });
    for (const handle of [get('.drag'), elements.orb]) {
      listen(handle, 'pointerdown', beginDrag);
      listen(handle, 'keydown', event => {
        const directions = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        changeLayout({ dock: 'free', x: layout.x + direction[0], y: layout.y + direction[1] });
      });
    }
    root.querySelectorAll('.dock-button').forEach(button => listen(button, 'click', () => {
      const dock = button.dataset.dock;
      changeLayout(dock === 'left' || dock === 'right' ? { dock, y: 80 } : { dock, x: undefined, y: undefined });
    }));
    listen(elements.settingsToggle, 'click', () => setDrawer(!drawerOpen));
    listen(elements.speedToggle, 'click', () => changeSettings({ speed: nextSpeed(state.speed) }));
    listen(get('.drawer-dismiss'), 'click', () => { setDrawer(false); elements.settingsToggle.focus(); });
    listen(get('.advanced'), 'toggle', () => { if (drawerOpen) panelPosition(); });
    listen(elements.speed, 'input', () => changeSettings({ speed: Number(elements.speed.value) }));
    listen(elements.generationSpeed, 'change', () => {
      const value = elements.generationSpeed.valueAsNumber;
      if (!Number.isFinite(value) || !elements.generationSpeed.checkValidity()) {
        elements.generationSpeed.reportValidity();
        return;
      }
      if (value !== state.generationSpeed) changeSettings({ generationSpeed: value, speed: value });
    });
    listen(elements.model, 'change', () => {
      const model = elements.model.value;
      const changes = { model };
      if (model.startsWith('tts-1') && !LEGACY_VOICES.includes(state.voice)) changes.voice = 'alloy';
      changeSettings(changes);
      panelPosition();
    });
    listen(elements.voice, 'change', () => changeSettings({ voice: elements.voice.value }));
    listen(elements.follow, 'change', () => changeSettings({ follow: elements.follow.checked }));
    listen(elements.sync, 'change', () => changeSettings({ syncMode: elements.sync.checked ? 'precise' : 'estimated' }));
    listen(elements.instructions, 'input', () => {
      elements.instructions.value = elements.instructions.value.slice(0, 1000);
      elements.promptCount.textContent = `${elements.instructions.value.length} / 1000`;
    });
    listen(elements.instructions, 'change', () => {
      const instructions = elements.instructions.value.slice(0, 1000);
      if (instructions !== state.instructions) changeSettings({ instructions });
    });
    listen(elements.progress, 'pointerdown', () => { seeking = true; });
    listen(elements.progress, 'pointerup', () => { seeking = false; });
    listen(elements.progress, 'input', () => { seeking = true; renderPosition(Number(elements.progress.value), true); });
    listen(elements.progress, 'change', () => {
      const wordIndex = Number(elements.progress.value);
      seeking = false;
      state.wordIndex = wordIndex;
      state.remainingSeconds = undefined;
      renderPosition(wordIndex);
      emit('seek', { wordIndex });
    });
    listen(elements.progress, 'pointercancel', () => { seeking = false; renderPosition(state.wordIndex); });
    listen(elements.progress, 'blur', () => { seeking = false; });
    listen(elements.pasteToggle, 'click', () => {
      const open = elements.paste.hidden;
      elements.paste.hidden = !open;
      elements.pasteToggle.setAttribute('aria-expanded', String(open));
      elements.pasteToggle.lastElementChild.textContent = open ? '−' : '+';
      panelPosition();
      if (open) elements.text.focus();
    });
    listen(elements.text, 'input', () => { elements.pasteAction.disabled = !elements.text.value.trim(); });
    listen(elements.pasteAction, 'click', () => {
      const text = elements.text.value.trim();
      if (!text) return;
      emit('paste', { text });
      setDrawer(false);
    });
    listen(root, 'keydown', event => {
      // Website shortcuts must not capture typing or arrow keys inside the player.
      event.stopPropagation();
      if (event.key === 'Escape' && drawerOpen) {
        event.preventDefault();
        setDrawer(false);
        elements.settingsToggle.focus();
      }
    });
    listen(root, 'click', event => {
      // A drop must not activate a control that moved beneath the pointer.
      if (event.detail > 0 && performance.now() < suppressPointerClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressOrbClick = false;
      }
    }, true);
    listen(host, 'click', event => event.stopPropagation());
    const resize = event => { if (event.isTrusted && !destroyed) applyLayout(); };
    window.addEventListener('resize', resize, { passive: true });
    render();
    document.documentElement.appendChild(host);
    applyLayout();

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      endDrag();
      window.removeEventListener('resize', resize);
      host.remove();
    }
    host._readerDestroy = destroy;
    return {
      host,
      expand() {
        if (destroyed) return;
        if (layout.collapsed) changeLayout({ collapsed: false });
        elements.primary.focus();
      },
      update(nextState = {}) {
        if (destroyed) return;
        state = { ...state, ...nextState };
        if (nextState.layout) { layout = { ...layout, ...nextState.layout }; applyLayout(); }
        render();
      },
      destroy,
    };
  }

  globalThis.ReaderUI = { create };
})();
