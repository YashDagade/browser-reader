const DEFAULTS={speed:1.5,voice:'coral',model:'local',follow:true};
let current=null,creating=null,localEpoch=0,localPaused=false,localTimer=null,saveAt=0;
let commandQueue=Promise.resolve();
function enqueue(operation) {const result=commandQueue.then(operation);commandQueue=result.catch(()=>{});return result;}
const stopTimer=()=>{clearInterval(localTimer);localTimer=null;};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
async function emit(state) {
  if(!current) return;
  current.state={...current.state,...state};
  chrome.tabs.sendMessage(current.tabId,{type:'tempo-state',sessionId:current.sessionId,state:current.state}).catch(()=>{});
  chrome.action.setBadgeText({text:state.status==='playing'?'▶':state.status==='paused'?'Ⅱ':''}).catch(()=>{});
  if(Date.now()-saveAt>1200 || state.status!=='playing') { saveAt=Date.now();await chrome.storage.session.set({current}); }
}
async function offscreen() {
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
  if(contexts.length) return;
  if(!creating) creating=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['AUDIO_PLAYBACK','BLOBS'],justification:'Play article audio and retain short cached audio blobs for pause and seeking.'}).finally(()=>{creating=null;});
  await creating;
}
async function audio(action,data={}) {
  await offscreen();
  return chrome.runtime.sendMessage({target:'offscreen',action,...data});
}
async function health() {
  try { const response=await fetch('http://127.0.0.1:43123/health',{headers:{'X-Reader-Client':'browser-reader-v1'},signal:AbortSignal.timeout(900)});return await response.json(); }
  catch {return {configured:false,running:false};}
}
function haltLocal() {localEpoch++;stopTimer();chrome.tts.stop();localPaused=false;}
function speakLocal(wordIndex=current?.state.wordIndex||0) {
  haltLocal();
  const session=current;
  if(!session) return;
  const epoch=localEpoch;
  if(wordIndex>=session.totalWords) {emit({status:'ended',wordIndex:session.totalWords});return;}
  const chunk=session.chunks.find(c=>wordIndex>=c.start && wordIndex<c.end)||session.chunks[0];
  if(!chunk) {emit({status:'error',error:'No readable text found.'});return;}
  const tokens=[...chunk.text.matchAll(/\S+/g)];
  const offset=clamp(wordIndex-chunk.start,0,tokens.length-1);
  const text=chunk.text.slice(tokens[offset].index);
  const spokenTokens=[...text.matchAll(/\S+/g)];
  emit({status:'loading',wordIndex,error:''});
  chrome.tts.getVoices(voices=>{
    if(epoch!==localEpoch) return;
    const english=voices.filter(v=>!v.remote && /^en[-_]/i.test(v.lang||''));
    const voice=english.find(v=>/Samantha|Ava|Serena/.test(v.voiceName))||english[0]||voices.find(v=>!v.remote);
    if(!voice) {emit({status:'error',error:'No on-device voice is installed. Install a system voice or choose OpenAI in settings.'});return;}
    const opts={rate:clamp(session.settings.speed,.75,4),enqueue:false,lang:session.lang||'en-US',onEvent(event){
      if(epoch!==localEpoch || current!==session) return;
      if(event.type==='start'||event.type==='resume') {localPaused=false;emit({status:'playing'});}
      if(event.type==='word') {
        let i=spokenTokens.findIndex((t,j)=>event.charIndex>=t.index && event.charIndex<(spokenTokens[j+1]?.index??Infinity));
        if(i<0)i=0; emit({status:'playing',wordIndex:wordIndex+i});
      }
      if(event.type==='end') {stopTimer();speakLocal(chunk.end);}
      if(event.type==='error') {stopTimer();emit({status:'error',error:event.errorMessage||'The system voice could not start.'});}
    }};
    if(voice) {opts.voiceName=voice.voiceName;opts.lang=voice.lang;}
    chrome.tts.speak(text,opts,()=>{if(chrome.runtime.lastError && epoch===localEpoch) emit({status:'error',error:chrome.runtime.lastError.message});});
  });
}
async function stopCurrent() {
  haltLocal();
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
  if(contexts.length) await chrome.runtime.sendMessage({target:'offscreen',action:'stop'}).catch(()=>{});
}
async function restore() {
  if(current) return;
  const saved=await chrome.storage.session.get('current');
  if(saved.current) current=saved.current;
}
async function control(message,sender) {
  await restore();
  if(message.action==='load') {
    await stopCurrent();
    if(current && current.sessionId!==message.sessionId) await emit({status:'stopped'});
    const a=message.article;
    if(!sender.tab?.id || !a || !Array.isArray(a.chunks)) throw Error('Invalid article.');
    current={sessionId:message.sessionId,tabId:sender.tab.id,chunks:a.chunks,title:a.title,lang:a.lang,totalWords:a.totalWords,settings:{...DEFAULTS,...message.settings},state:{status:'ready',wordIndex:0,totalWords:a.totalWords}};
    await chrome.storage.session.set({current});
    if(current.settings.model!=='local') await audio('load',current);
    return {ok:true,...await health()};
  }
  if(!current || message.sessionId!==current.sessionId || sender.tab?.id!==current.tabId) return {error:'This reader is no longer active. Close and reopen Tempo on this page.'};
  let action=message.action;
  if(action==='settings') {
    const previous=current.settings;
    current.settings={...previous,...message.settings,speed:clamp(Number(message.settings.speed??previous.speed),.75,4)};
    const wasPlaying=['playing','loading'].includes(current.state.status),index=current.state.wordIndex||0;
    if(previous.model!==current.settings.model) {
      await stopCurrent();
      if(current.settings.model==='local') {
        if(wasPlaying) speakLocal(index);else await emit({status:'paused',wordIndex:index});
      } else {await audio('load',current);await audio('seek',{wordIndex:index});if(wasPlaying) await audio('play');}
    } else if(current.settings.model==='local') {
      if(wasPlaying) speakLocal(index);
    } else await audio('settings',{settings:current.settings});
    await emit({settings:current.settings});return {ok:true};
  }
  if(current.settings.model==='local') {
    if(action==='play') {
      if(current.state.status==='playing') return {ok:true};
      if(localPaused) {localPaused=false;chrome.tts.resume();await emit({status:'playing'});}
      else speakLocal(current.state.status==='ended'?0:current.state.wordIndex||0);
    }
    if(action==='pause') {localEpoch++;chrome.tts.stop();localPaused=false;await emit({status:'paused'});}
    if(action==='stop') {haltLocal();await emit({status:'stopped',wordIndex:0});}
    if(action==='seek') {
      const index=clamp(Math.floor(message.wordIndex||0),0,Math.max(0,current.totalWords-1));
      const wasPlaying=['playing','loading'].includes(current.state.status);
      haltLocal();if(wasPlaying)speakLocal(index);else await emit({status:'paused',wordIndex:index});
    }
  } else {
    const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
    if(!contexts.length) {await audio('load',current);await audio('seek',{wordIndex:current.state.wordIndex||0});}
    await audio(action, {wordIndex:message.wordIndex});
  }
  return {ok:true};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message.target!=='background')return;
  if(message.type==='state') {
    if(sender.url===chrome.runtime.getURL('offscreen.html')) enqueue(async()=>{await restore();
      if(current?.sessionId===message.sessionId && current.settings.model!=='local') emit(message.state);
    });
    return;
  }
  if(message.type==='health') {health().then(reply);return true;}
  if(message.type==='control') {enqueue(()=>control(message,sender)).then(reply).catch(e=>reply({error:e.message}));return true;}
});
async function activate(tab) {
  if(!tab?.id) return;
  try {
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['extractor.js','ui.js','content.js']});
  }catch {
    await chrome.tabs.create({url:chrome.runtime.getURL('options.html')+'?restricted=1'});
  }
}
chrome.action.onClicked.addListener(activate);
chrome.commands.onCommand.addListener(async command=>{
  if(command==='_execute_action') { const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await activate(tab); }
});
chrome.runtime.onInstalled.addListener(()=>{
  chrome.contextMenus.removeAll(()=>chrome.contextMenus.create({id:'tempo-read',title:'Read with Tempo',contexts:['selection','page']}));
  chrome.storage.local.get('settings').then(({settings})=>{if(!settings)chrome.storage.local.set({settings:DEFAULTS});});
  chrome.action.setBadgeBackgroundColor({color:'#242424'});
});
chrome.contextMenus.onClicked.addListener((_info,tab)=>activate(tab));
chrome.tabs.onRemoved.addListener(id=>enqueue(async()=>{await restore();if(current?.tabId===id){await stopCurrent();current=null;await chrome.storage.session.remove('current');}}));
chrome.tabs.onUpdated.addListener((id,change)=>enqueue(async()=>{
  if(change.status==='loading') {await restore();if(current?.tabId===id){await stopCurrent();await emit({status:'stopped'});current=null;await chrome.storage.session.remove('current');}}
}));
