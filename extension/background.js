importScripts('speech-client.js');
const DEFAULTS = {speed:1.5, voice:'alloy', model:'local', follow:true, instructions:'', syncMode:'precise'};
const IDLE_ALARM = 'hermes-release-audio';
let current = null, creating = null, localEpoch = 0, saveAt = 0, lastStatus = '';
let commandQueue = Promise.resolve();
const storageReady = chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
function enqueue(operation) {const result=commandQueue.then(operation);commandQueue=result.catch(()=>{});return result;}
function settingsOnly(value={}) {
  const result = {};
  if(Number.isFinite(Number(value.speed)))result.speed=clamp(Number(value.speed),.75,4);
  if(['local','gpt-4o-mini-tts','tts-1','tts-1-hd'].includes(value.model))result.model=value.model;
  if(['alloy','cedar','nova','marin','coral','ash','sage','ballad','echo','fable','onyx','shimmer','verse'].includes(value.voice))result.voice=value.voice;
  if(typeof value.follow==='boolean')result.follow=value.follow;
  if(typeof value.instructions==='string')result.instructions=value.instructions.slice(0,1000);
  if(['precise','estimated'].includes(value.syncMode))result.syncMode=value.syncMode;
  if(value.layout && typeof value.layout==='object') {
    const layout=value.layout;
    result.layout={dock:['free','left','right'].includes(layout.dock)?layout.dock:'free',collapsed:!!layout.collapsed};
    for(const k of ['x','y'])if(Number.isFinite(layout[k]))result.layout[k]=clamp(layout[k],0,100000);
  }
  return result;
}
async function preferences() {
  await storageReady;
  const {settings}=await chrome.storage.local.get('settings');
  return {...DEFAULTS,...settingsOnly(settings)};
}
async function emit(state) {
  if(!current)return;
  current.state={...current.state,...state};
  chrome.tabs.sendMessage(current.tabId,{type:'hermes-state',sessionId:current.sessionId,state:current.state}).catch(()=>{});
  const status=current.state.status;
  if(status!==lastStatus) {
    lastStatus=status;
    chrome.action.setBadgeText({text:status==='playing'?'▶':status==='paused'?'Ⅱ':''}).catch(()=>{});
    if(status==='playing'||status==='loading')chrome.alarms.clear(IDLE_ALARM);
    else if(status==='paused'||status==='ended'||status==='error')chrome.alarms.create(IDLE_ALARM,{delayInMinutes:3});
  }
  // Source text is saved once on load. Word ticks write only compact playback state.
  if(Date.now()-saveAt>2500 || status!=='playing') {
    saveAt=Date.now();await chrome.storage.session.set({playback:{sessionId:current.sessionId,state:current.state}});
  }
}
async function offscreen() {
  if((await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length)return;
  if(!creating)creating=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['AUDIO_PLAYBACK','BLOBS'],justification:'Play article audio and retain a bounded cache for pause and seeking.'}).finally(()=>{creating=null;});
  await creating;
}
async function audio(action,data={}) {await offscreen();return chrome.runtime.sendMessage({target:'offscreen',action,...data});}
async function prepareAudio() {
  await offscreen();
  const state=await chrome.runtime.sendMessage({target:'offscreen',action:'get-state'});
  if(state?.state?.sessionId!==current.sessionId) {
    await audio('load',current);
    if(current.state.wordIndex&&current.state.status!=='ended')await audio('seek',{wordIndex:current.state.wordIndex});
  }
}
async function health() {await storageReady;return HermesSpeech.health();}
function haltLocal() {localEpoch++;chrome.tts.stop();}
function speakLocal(wordIndex=current?.state.wordIndex||0) {
  haltLocal();const session=current;if(!session)return;
  const epoch=localEpoch;
  if(wordIndex>=session.totalWords){emit({status:'ended',wordIndex:session.totalWords,remainingSeconds:0});return;}
  const chunk=session.chunks.find(c=>wordIndex>=c.start&&wordIndex<c.end)||session.chunks[0];
  if(!chunk){emit({status:'error',error:'No readable text found.'});return;}
  const tokens=[...chunk.text.matchAll(/\S+/g)];
  const offset=clamp(wordIndex-chunk.start,0,tokens.length-1);
  const text=chunk.text.slice(tokens[offset].index), spokenTokens=[...text.matchAll(/\S+/g)];
  emit({status:'loading',wordIndex,error:'',timingSource:'native'});
  chrome.tts.getVoices(voices=>{
    if(epoch!==localEpoch)return;
    const local=voices.filter(v=>!v.remote), language=(session.lang||'en').split('-')[0];
    const matching=local.filter(v=>(v.lang||'').split(/[-_]/)[0]===language);
    const voice=matching.find(v=>/Samantha|Ava|Serena/.test(v.voiceName))||matching[0]||local[0];
    if(!voice){emit({status:'error',error:'No on-device voice is installed. Install a system voice or choose OpenAI in settings.'});return;}
    chrome.tts.speak(text,{rate:clamp(session.settings.speed,.75,4),enqueue:false,voiceName:voice.voiceName,lang:voice.lang,onEvent(event){
      if(epoch!==localEpoch||current!==session)return;
      if(event.type==='start'||event.type==='resume')emit({status:'playing'});
      if(event.type==='word') {
        let i=spokenTokens.findIndex((t,j)=>event.charIndex>=t.index&&event.charIndex<(spokenTokens[j+1]?.index??Infinity));
        if(i<0)i=0;
        emit({status:'playing',wordIndex:wordIndex+i,remainingSeconds:(session.totalWords-wordIndex-i)/(195*session.settings.speed)*60});
      }
      if(event.type==='end')speakLocal(chunk.end);
      if(event.type==='error')emit({status:'error',error:event.errorMessage||'The system voice could not start.'});
    }},()=>{if(chrome.runtime.lastError&&epoch===localEpoch)emit({status:'error',error:chrome.runtime.lastError.message});});
  });
}
async function stopCurrent(release=false) {
  haltLocal();await chrome.alarms.clear(IDLE_ALARM);
  if((await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length) {
    await chrome.runtime.sendMessage({target:'offscreen',action:release?'unload':'stop'}).catch(()=>{});
    if(release)await chrome.offscreen.closeDocument().catch(()=>{});
  }
}
async function restore() {
  if(current)return;
  const saved=await chrome.storage.session.get(['current','playback']);
  if(saved.current) {
    current=saved.current;
    if(saved.playback?.sessionId===current.sessionId)current.state={...current.state,...saved.playback.state};
  }
}
async function control(message,sender) {
  await storageReady;await restore();
  if(message.action==='load') {
    const a=message.article;
    if(!sender.tab?.id||!a||!Array.isArray(a.chunks)||a.chunks.length>20000)throw Error('Invalid article.');
    await stopCurrent(true);
    if(current&&current.sessionId!==message.sessionId)await emit({status:'stopped'});
    current={sessionId:message.sessionId,tabId:sender.tab.id,chunks:a.chunks,title:a.title,lang:a.lang,totalWords:a.totalWords,settings:{...DEFAULTS,...settingsOnly(message.settings)},state:{status:'ready',wordIndex:0,totalWords:a.totalWords}};
    await chrome.storage.session.set({current});await chrome.storage.session.remove('playback');
    return {ok:true,...await health()};
  }
  if(!current||message.sessionId!==current.sessionId||sender.tab?.id!==current.tabId)return {error:'This reader is no longer active. Close and reopen Hermes on this page.'};
  const action=message.action;
  if(action==='close') {
    await stopCurrent(true);await emit({status:'stopped'});current=null;
    await chrome.storage.session.remove(['current','playback']);return {ok:true};
  }
  if(action==='stop') {await stopCurrent(true);await emit({status:'stopped',wordIndex:0,remainingSeconds:undefined});return {ok:true};}
  if(action==='settings') {
    const previous=current.settings;
    current.settings={...previous,...settingsOnly(message.settings)};
    await chrome.storage.local.set({settings:current.settings});await chrome.storage.session.set({current});
    const wasPlaying=['playing','loading'].includes(current.state.status), index=current.state.wordIndex||0;
    const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
    if(previous.model!==current.settings.model) {
      await stopCurrent(true);
      if(current.settings.model==='local') {
        if(wasPlaying)speakLocal(index);else await emit({status:'paused',wordIndex:index,remainingSeconds:undefined,timingSource:'native'});
      } else if(wasPlaying) {await prepareAudio();await audio('play');}
      else await emit({status:'paused',wordIndex:index,remainingSeconds:undefined,timingSource:'estimated'});
    } else if(current.settings.model==='local') {
      if(wasPlaying&&previous.speed!==current.settings.speed)speakLocal(index);
    } else if(contexts.length)await audio('settings',{settings:current.settings});
    if(current.settings.model==='local'||!contexts.length)current.state.remainingSeconds=undefined;
    await emit({settings:current.settings});return {ok:true};
  }
  if(current.settings.model==='local') {
    if(action==='play'&&current.state.status!=='playing')speakLocal(current.state.status==='ended'?0:current.state.wordIndex||0);
    if(action==='pause'){haltLocal();await emit({status:'paused'});}
    if(action==='seek') {
      const index=clamp(Math.floor(message.wordIndex||0),0,Math.max(0,current.totalWords-1));
      const wasPlaying=['playing','loading'].includes(current.state.status);haltLocal();
      if(wasPlaying)speakLocal(index);else await emit({status:'paused',wordIndex:index,remainingSeconds:undefined});
    }
  } else {
    const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
    if(!contexts.length&&action==='pause')return {ok:true};
    if(!contexts.length&&action==='seek') {await emit({status:'paused',wordIndex:clamp(Math.floor(message.wordIndex||0),0,Math.max(0,current.totalWords-1)),remainingSeconds:undefined});return {ok:true};}
    await prepareAudio();await audio(action,{wordIndex:message.wordIndex});
  }
  return {ok:true};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message.target!=='background')return;
  const internal=sender.url===chrome.runtime.getURL('offscreen.html')&&!sender.tab;
  if(message.type==='connection-internal') {
    if(!internal){reply({error:'Not permitted.'});return;}
    storageReady.then(async()=>{
      const {hermesConnection}=await chrome.storage.local.get('hermesConnection');
      const permission=await chrome.permissions.contains({origins:['https://api.openai.com/*']});
      reply({connection:hermesConnection||{mode:'local'},permission});
    }).catch(()=>reply({error:'Connection unavailable.'}));return true;
  }
  if(message.type==='preferences') {
    if(!sender.tab&&sender.url!==chrome.runtime.getURL('options.html'))return;
    preferences().then(settings=>reply({settings}));return true;
  }
  if(message.type==='layout') {
    if(!sender.tab)return;
    enqueue(async()=>{
      const settings=await preferences();Object.assign(settings,settingsOnly({layout:message.layout}));
      await chrome.storage.local.set({settings});if(current?.tabId===sender.tab.id)current.settings.layout=settings.layout;
      reply({ok:true});
    });return true;
  }
  if(message.type==='state') {
    if(internal)enqueue(async()=>{await restore();if(current?.sessionId===message.sessionId&&current.settings.model!=='local')await emit(message.state);});
    return;
  }
  if(message.type==='health'){health().then(reply);return true;}
  if(message.type==='control'){enqueue(()=>control(message,sender)).then(reply).catch(e=>reply({error:e.message}));return true;}
});
async function activate(tab) {
  if(!tab?.id)return;
  try{await chrome.scripting.executeScript({target:{tabId:tab.id},files:['extractor.js','ui.js','content.js']});}
  catch{await chrome.tabs.create({url:chrome.runtime.getURL('options.html')+'?restricted=1'});}
}
chrome.action.onClicked.addListener(activate);
chrome.commands.onCommand.addListener(async command=>{if(command==='_execute_action'){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await activate(tab);}});
chrome.runtime.onInstalled.addListener(async details=>{
  chrome.contextMenus.removeAll(()=>chrome.contextMenus.create({id:'hermes-read',title:'Read with Hermes',contexts:['selection','page']}));
  const settings=await preferences();if(details?.previousVersion==='0.1.0')settings.voice='alloy';
  await chrome.storage.local.set({settings});chrome.action.setBadgeBackgroundColor({color:'#242424'});
});
chrome.contextMenus.onClicked.addListener((_info,tab)=>activate(tab));
chrome.alarms.onAlarm.addListener(alarm=>enqueue(async()=>{
  if(alarm.name!==IDLE_ALARM)return;await restore();
  if(current&&!['playing','loading'].includes(current.state.status))await stopCurrent(true);
}));
chrome.tabs.onRemoved.addListener(id=>enqueue(async()=>{await restore();if(current?.tabId===id){await stopCurrent(true);current=null;await chrome.storage.session.remove(['current','playback']);}}));
chrome.tabs.onUpdated.addListener((id,change)=>enqueue(async()=>{
  if(change.status==='loading'){await restore();if(current?.tabId===id){await stopCurrent(true);await emit({status:'stopped'});current=null;await chrome.storage.session.remove(['current','playback']);}}
}));
