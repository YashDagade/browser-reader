(() => {
  if (globalThis.__hermesReader) { globalThis.__hermesReader.open(); return; }
  let article, ui, settings = {speed: 1.5, voice: 'alloy', model: 'local', follow: true, instructions:'', syncMode:'precise'};
  let sessionId = null, state = {status:'ready',wordIndex:0}, lastWord=-1, closed=true;
  let lastScroll=0, manualScrollUntil=0;
  const scrollParents=new WeakMap();
  const highlightStyle = document.createElement('style');
  highlightStyle.textContent = '::highlight(hermes-word){background:#f2cf69;color:#111;text-decoration:underline;text-decoration-color:#aa8321}::highlight(hermes-context){background:rgba(242,207,105,.12)}';
  const send = (action, payload={}) => chrome.runtime.sendMessage({target:'background', type:'control', action, sessionId, ...payload});
  function clearHighlight() {
    globalThis.CSS?.highlights?.delete('hermes-word');
    globalThis.CSS?.highlights?.delete('hermes-context');
    lastWord=-1;
  }
  function scrollTargets(element) {
    if(scrollParents.has(element))return scrollParents.get(element);
    const targets=[];
    for(let parent=element?.parentElement;parent&&parent!==document.body;parent=parent.parentElement) {
      if(parent.scrollHeight>parent.clientHeight+2&&/(auto|scroll)/.test(getComputedStyle(parent).overflowY))targets.push(parent);
    }
    scrollParents.set(element,targets);return targets;
  }
  function followWord(range,force=false) {
    if(!settings.follow||document.hidden||(!force&&Date.now()<manualScrollUntil))return;
    if(!force&&Date.now()-lastScroll<250)return;
    const element=range.startContainer.parentElement;
    const behavior=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
    // Scroll the word itself, rather than centering a potentially very tall paragraph.
    for(const parent of scrollTargets(element)) {
      const rect=range.getBoundingClientRect(), box=parent.getBoundingClientRect();
      if(rect.top<box.top+24||rect.bottom>box.bottom-40) {
        parent.scrollBy({top:rect.top-box.top-parent.clientHeight*.4,behavior});lastScroll=Date.now();return;
      }
    }
    const rect=range.getBoundingClientRect();
    let bottom=innerHeight-60;
    const widget=ui?.host.getBoundingClientRect();
    if(widget&&widget.width<innerWidth&&widget.left<rect.right&&widget.right>rect.left&&widget.top>innerHeight*.5)bottom=Math.min(bottom,widget.top-24);
    if(rect.top<60||rect.bottom>bottom) {
      globalThis.scrollBy({top:rect.top-Math.max(80,bottom*.4),behavior});lastScroll=Date.now();
    }
  }
  function highlight(index,force=false) {
    if(!article||document.hidden)return;
    const range=article.words[index]?.range;
    if(!range?.startContainer?.isConnected)return;
    if(index!==lastWord||force) {
      lastWord=index;
      if(globalThis.CSS?.highlights&&globalThis.Highlight)CSS.highlights.set('hermes-word',new Highlight(range));
      followWord(range,force);
    }
  }
  function update(next) {
    state={...state,...next};
    if(document.hidden)return;
    ui?.update({...state,...settings,totalWords:article?.words.length||0});
    if(['playing','paused','loading'].includes(state.status))highlight(state.wordIndex||0);
    else if(['stopped','ended','idle','ready','error'].includes(state.status))clearHighlight();
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
    if (!closed && ui) { ui.host.style.display=''; ui.expand?.(); return; }
    try {
      const stored=await chrome.runtime.sendMessage({target:'background',type:'preferences'});
      settings={...settings,...stored?.settings};
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
        try {await send('close');} finally {ui?.destroy();ui=null;article=null;sessionId=null;closed=true;clearHighlight();highlightStyle.remove();}return;
      }
      if (action==='paste') { await load(ReaderExtract.fromText(payload.text,'Your text'));await send('play');return; }
      if(action==='layout') {settings.layout=payload;await chrome.runtime.sendMessage({target:'background',type:'layout',layout:payload});return;}
      if (action==='settings') {
        settings={...settings,...payload};
        const result=await send('settings',{settings});if(result?.error)throw Error(result.error);
        update({error:''});if(payload.follow)highlight(state.wordIndex||0,true);return;
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
    if (message.type==='hermes-open') { open(message).then(()=>reply({ok:true}));return true; }
    if (message.type==='hermes-state' && message.sessionId===sessionId) {
      if (message.state.settings) settings={...settings,...message.state.settings};
      update(message.state);
    }
  });
  document.addEventListener('click',event=>{
    if(closed || !article || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey) return;
    if(event.composedPath().includes(ui?.host) || event.target.closest?.('a,button,input,textarea,select,[contenteditable=true]')) return;
    const point=document.caretRangeFromPoint?.(event.clientX,event.clientY);
    if(!point) return;
    let low=0, high=article.words.length-1, index=-1;
    while(low<=high) {
      const middle=(low+high)>>1, range=article.words[middle].range;
      if(!range?.startContainer?.isConnected)break;
      let order;try{order=range.comparePoint(point.startContainer,point.startOffset);}catch{break;}
      if(order===0){index=middle;break;}
      if(order>0)low=middle+1;else high=middle-1;
    }
    if(index>=0) {event.preventDefault();manualScrollUntil=0;onAction('seek',{wordIndex:index});}
  });
  document.addEventListener('keydown',event=>{
    if(closed || event.target.closest?.('input,textarea,select,[contenteditable=true]') || event.composedPath().includes(ui?.host)) return;
    if(event.altKey && event.code==='Space') { event.preventDefault();onAction(state.status==='playing'?'pause':'play'); }
    if(event.key==='Escape' && !event.ctrlKey && !event.metaKey) onAction('pause');
  });
  addEventListener('pagehide',()=>{if(sessionId)send('close').catch(()=>{});ui?.destroy();ui=null;closed=true;sessionId=null;article=null;clearHighlight();});
  const userScrolled=()=>{manualScrollUntil=Date.now()+5000;};
  document.addEventListener('wheel',userScrolled,{passive:true});
  document.addEventListener('touchmove',userScrolled,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!closed){lastWord=-1;update({});}});
  globalThis.__hermesReader={open};
  open();
})();
