(() => {
  if (globalThis.__tempoReader) { globalThis.__tempoReader.open(); return; }
  let article, ui, settings = {speed: 1.5, voice: 'coral', model: 'local', follow: true};
  let sessionId = null, state = {status:'ready',wordIndex:0}, lastWord=-1, closed=true;
  let lastScroll=0;
  const highlightStyle = document.createElement('style');
  highlightStyle.textContent = '::highlight(tempo-word){background:#f2cf69;color:#111;text-decoration:underline;text-decoration-color:#aa8321}::highlight(tempo-context){background:rgba(242,207,105,.12)}';
  const send = (action, payload={}) => chrome.runtime.sendMessage({target:'background', type:'control', action, sessionId, ...payload});
  function clearHighlight() {
    globalThis.CSS?.highlights?.delete('tempo-word');
    globalThis.CSS?.highlights?.delete('tempo-context');
    lastWord=-1;
  }
  function highlight(index) {
    if (index===lastWord || !article) return;
    lastWord=index;
    const range=article.words[index]?.range;
    if (!range?.startContainer?.isConnected) return;
    if (globalThis.CSS?.highlights && globalThis.Highlight) CSS.highlights.set('tempo-word',new Highlight(range));
    const rect=range.getBoundingClientRect();
    if (settings.follow && Date.now()-lastScroll>900 && (rect.top<80 || rect.bottom>innerHeight-160)) {
      range.startContainer.parentElement?.scrollIntoView({block:'center',behavior:'smooth'});
      lastScroll=Date.now();
    }
  }
  function update(next) {
    state={...state,...next};
    ui?.update({...state,...settings,totalWords:article?.words.length||0});
    if (['playing','paused','loading'].includes(state.status)) highlight(state.wordIndex||0);
    else if (['stopped','ended','idle','ready','error'].includes(state.status)) clearHighlight();
  }
  async function load(nextArticle) {
    clearHighlight();
    if (sessionId) await send('stop').catch(()=>{});
    article=nextArticle; sessionId=crypto.randomUUID();
    state={status:'ready',wordIndex:0};
    ui?.destroy();
    ui=ReaderUI.create({title:article.title,totalWords:article.words.length,settings,onAction});
    if (!highlightStyle.isConnected) document.documentElement.append(highlightStyle);
    closed=false;
    const result=await send('load',{article:{title:article.title,lang:article.lang,chunks:article.chunks,totalWords:article.words.length},settings});
    if (result?.error) update({status:'error',error:result.error});
    else update({status:'ready',connected:result?.configured});
  }
  async function open({selectionOnly=false}={}) {
    if (!closed && ui) { ui.host.style.display=''; return; }
    try {
      const stored=await chrome.storage.local.get('settings');
      settings={...settings,...stored.settings};
      await load(ReaderExtract.extract({selectionOnly}));
    } catch(error) {
      article={title:document.title,words:[],chunks:[]};
      ui?.destroy();ui=ReaderUI.create({title:document.title,totalWords:0,settings,onAction});closed=false;
      update({status:'error',error:error.message||'This page cannot be read. Try selecting text or pasting it in settings.'});
    }
  }
  async function onAction(action,payload={}) {
    try {
      if (action==='close') {
        try {await send('stop');} finally {ui?.destroy();ui=null;closed=true;clearHighlight();highlightStyle.remove();}return;
      }
      if (action==='paste') { await load(ReaderExtract.fromText(payload.text,'Your text'));await send('play');return; }
      if (action==='settings') {
        settings={...settings,...payload};await chrome.storage.local.set({settings});
        update({error:''}); await send('settings',{settings}); return;
      }
      if (action==='previous' || action==='next') {
        const current=article.chunks.findIndex(c=>state.wordIndex>=c.start && state.wordIndex<c.end);
        const idx=Math.max(0,Math.min(article.chunks.length-1,current+(action==='next'?1:-1)));
        action='seek';payload={wordIndex:article.chunks[idx]?.start||0};
      }
      if (action==='play' && !article.words.length) throw Error('Select some article text, or paste text in the reader settings.');
      const result=await send(action,payload);
      if (result?.error) throw Error(result.error);
    } catch(error) { update({status:'error',error:error.message||'Reader connection failed. Reload this page and try again.'}); }
  }
  chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
    if (message.type==='tempo-open') { open(message).then(()=>reply({ok:true}));return true; }
    if (message.type==='tempo-state' && message.sessionId===sessionId) {
      if (message.state.settings) settings={...settings,...message.state.settings};
      update(message.state);
    }
  });
  document.addEventListener('click',event=>{
    if(closed || !article || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey) return;
    if(event.composedPath().includes(ui?.host) || event.target.closest?.('a,button,input,textarea,select,[contenteditable=true]')) return;
    const point=document.caretRangeFromPoint?.(event.clientX,event.clientY);
    if(!point) return;
    const index=article.words.findIndex(w=>{
      if(!w.range?.startContainer?.isConnected) return false;
      try {return w.range.comparePoint(point.startContainer,point.startOffset)===0;}catch{return false;}
    });
    if(index>=0) { event.preventDefault();onAction('seek',{wordIndex:index}); }
  });
  document.addEventListener('keydown',event=>{
    if(closed || event.target.closest?.('input,textarea,select,[contenteditable=true]') || event.composedPath().includes(ui?.host)) return;
    if(event.altKey && event.code==='Space') { event.preventDefault();onAction(state.status==='playing'?'pause':'play'); }
    if(event.key==='Escape' && !event.ctrlKey && !event.metaKey) onAction('pause');
  });
  addEventListener('pagehide',()=>{send('stop').catch(()=>{});});
  globalThis.__tempoReader={open};
  open();
})();
