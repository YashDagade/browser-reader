importScripts('credential-vault.js', 'session-data.js', 'speech-client.js');
const DEFAULTS = {speed:2.3, generationSpeed:2.3, voice:'alloy', model:'gpt-4o-mini-tts', follow:true, instructions:'', syncMode:'precise'};
const IDLE_ALARM = 'hermes-release-audio';
let current = null, creating = null, saveAt = 0, lastStatus = '';
let commandQueue = Promise.resolve();
const storageReady = HermesSession.initialize();
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
function enqueue(operation) {const result=commandQueue.then(operation);commandQueue=result.catch(()=>{});return result;}
function settingsOnly(value={}) {
  const result = {};
  if(Number.isFinite(Number(value.speed)))result.speed=clamp(Number(value.speed),.75,4);
  if(typeof value.generationSpeed==='number' && Number.isFinite(value.generationSpeed))result.generationSpeed=clamp(value.generationSpeed,.75,4);
  if(value.model==='local')result.model=DEFAULTS.model;
  else if(['gpt-4o-mini-tts','tts-1','tts-1-hd'].includes(value.model))result.model=value.model;
  if(['alloy','cedar','nova','marin','coral','ash','sage','ballad','echo','fable','onyx','shimmer','verse'].includes(value.voice))result.voice=value.voice;
  if(typeof value.follow==='boolean')result.follow=value.follow;
  if(typeof value.instructions==='string')result.instructions=value.instructions.slice(0,1000);
  if(['precise','estimated'].includes(value.syncMode))result.syncMode=value.syncMode;
  if(value.layout && typeof value.layout==='object') {
    const layout=value.layout;
    result.layout={dock:['free','left','right','top','bottom'].includes(layout.dock)?layout.dock:'free',collapsed:!!layout.collapsed};
    for(const k of ['x','y'])if(Number.isFinite(layout[k]))result.layout[k]=clamp(layout[k],0,100000);
  }
  return result;
}
async function preferences() {
  await storageReady;
  const settings=await HermesSession.preferences();
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
async function health() {
  await storageReady;
  const [state,connection]=await Promise.all([HermesSpeech.health(),HermesSession.connection()]);
  return {...state,configured:state.configured&&connection.consent===true};
}
async function requireConnection() {
  const state=await health();
  if(!state.configured) {
    const error='Connect OpenAI in Hermes Options before reading.';
    await emit({status:'error',error,connected:false});
    throw Error(error);
  }
  await emit({error:'',connected:true});
}
async function stopCurrent(release=false) {
  await chrome.alarms.clear(IDLE_ALARM);
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
    current.settings={...DEFAULTS,...settingsOnly(current.settings)};
    if(saved.playback?.sessionId===current.sessionId) {
      current.state={...current.state,...saved.playback.state};
      if(current.state.settings)current.settings={...current.settings,...settingsOnly(current.state.settings)};
    }
  }
}
async function control(message,sender) {
  await storageReady;await restore();
  if(message.action==='load') {
    const a=message.article;
    if(!sender.tab?.id||!a||!Array.isArray(a.chunks)||a.chunks.length>20000)throw Error('Invalid article.');
    await stopCurrent(true);
    if(current&&current.sessionId!==message.sessionId)await emit({status:'stopped'});
    const index=clamp(Math.floor(Number(message.wordIndex)||0),0,Math.max(0,a.totalWords-1));
    current={sessionId:message.sessionId,tabId:sender.tab.id,documentId:sender.documentId,url:sender.url||sender.tab.url||'',chunks:a.chunks,title:a.title,lang:a.lang,totalWords:a.totalWords,settings:{...DEFAULTS,...settingsOnly(message.settings)},state:{status:index?'paused':'ready',wordIndex:index,totalWords:a.totalWords}};
    lastStatus='';
    await chrome.storage.session.set({current});await chrome.storage.session.remove('playback');
    return {ok:true,...await health()};
  }
  if(!current||message.sessionId!==current.sessionId||sender.tab?.id!==current.tabId||(current.documentId&&sender.documentId&&sender.documentId!==current.documentId))return {code:'STALE_SESSION',error:'The reading session needs to reconnect.'};
  const action=message.action;
  if(action==='close') {
    await stopCurrent(true);await emit({status:'stopped'});current=null;
    await chrome.storage.session.remove(['current','playback']);return {ok:true};
  }
  if(action==='stop') {await stopCurrent(true);await emit({status:'stopped',wordIndex:0,remainingSeconds:undefined});return {ok:true};}
  if(action==='settings') {
    const previous=current.settings;
    current.settings={...previous,...settingsOnly(message.settings)};
    await HermesSession.savePreferences(current.settings);
    const wasPlaying=['playing','loading'].includes(current.state.status), index=current.state.wordIndex||0;
    const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
    if(previous.model!==current.settings.model) {
      await stopCurrent(true);
      if(wasPlaying) {await requireConnection();await prepareAudio();await audio('play');}
      else await emit({status:'paused',wordIndex:index,remainingSeconds:undefined,timingSource:'estimated'});
    } else if(contexts.length)await audio('settings',{settings:current.settings});
    if(!contexts.length)current.state.remainingSeconds=undefined;
    await emit({settings:current.settings});return {ok:true};
  }
  if(action==='setup') {await chrome.runtime.openOptionsPage();return {ok:true};}
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
  if(!contexts.length&&action==='pause')return {ok:true};
  if(!contexts.length&&action==='seek') {await emit({status:'paused',wordIndex:clamp(Math.floor(message.wordIndex||0),0,Math.max(0,current.totalWords-1)),remainingSeconds:undefined});return {ok:true};}
  if(action==='play')await requireConnection();
  await prepareAudio();await audio(action,{wordIndex:message.wordIndex});
  return {ok:true};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message.target!=='background')return;
  const internal=sender.url===chrome.runtime.getURL('offscreen.html')&&!sender.tab;
  const options=sender.url?.split('?')[0]===chrome.runtime.getURL('options.html');
  if(message.type==='connection-internal') {
    if(!internal&&!options){reply({error:'Not permitted.'});return;}
    storageReady.then(async()=>{
      const connection=await HermesSession.connection();
      const permission=await chrome.permissions.contains({origins:['https://api.openai.com/*']});
      reply({connection,permission});
    }).catch(()=>reply({error:'Connection unavailable.'}));return true;
  }
  if(message.type==='audio-key-internal') {
    if(!internal&&!options){reply({error:'Not permitted.'});return;}
    enqueue(async()=>reply({cipher:await HermesSession.audioCipher()})).catch(()=>reply({error:'Audio cache unavailable.'}));return true;
  }
  if(message.type==='connection-manage') {
    if(!options){reply({error:'Not permitted.'});return;}
    enqueue(async()=>{
      const value=message.action==='save'?await HermesSession.saveConnection(message.connection||{}):
        message.action==='forget'?await HermesSession.forgetConnection():await HermesSession.connection();
      reply({connection:{mode:value.mode,consent:value.consent,hasKey:Boolean(value.apiKey),rememberKey:value.rememberKey,keyError:value.keyError}});
    }).catch(error=>reply({error:error.message}));return true;
  }
  if(message.type==='preferences-save') {
    if(!options){reply({error:'Not permitted.'});return;}
    enqueue(async()=>{await HermesSession.savePreferences({...await preferences(),...settingsOnly(message.settings)});reply({ok:true});}).catch(()=>reply({error:'Preferences could not be saved.'}));return true;
  }
  if(message.type==='preferences') {
    if(!sender.tab&&!options){reply({error:'Not permitted.'});return;}
    preferences().then(settings=>reply({settings}));return true;
  }
  if(message.type==='layout') {
    if(!sender.tab)return;
    enqueue(async()=>{
      await restore();
      const settings=await preferences();Object.assign(settings,settingsOnly({layout:message.layout}));
      await HermesSession.savePreferences(settings);
      if(current?.tabId===sender.tab.id&&(!current.documentId||!sender.documentId||current.documentId===sender.documentId)) {
        current.settings.layout=settings.layout;await emit({settings:current.settings});
      }
      reply({ok:true});
    });return true;
  }
  if(message.type==='state') {
    if(internal)enqueue(async()=>{await restore();if(current?.sessionId===message.sessionId)await emit(message.state);});
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
  await HermesSession.savePreferences(settings);chrome.action.setBadgeBackgroundColor({color:'#242424'});
});
chrome.contextMenus.onClicked.addListener((_info,tab)=>activate(tab));
chrome.alarms.onAlarm.addListener(alarm=>enqueue(async()=>{
  if(alarm.name!==IDLE_ALARM)return;await restore();
  if(current&&!['playing','loading'].includes(current.state.status))await stopCurrent(true);
}));
chrome.tabs.onRemoved.addListener(id=>enqueue(async()=>{await restore();if(current?.tabId===id){await stopCurrent(true);current=null;await chrome.storage.session.remove(['current','playback']);}}));
// Fragment navigation and same-document load notifications must not end narration.
// A reply from the original document proves that its reader is still alive.
chrome.tabs.onUpdated.addListener((id,change)=>enqueue(async()=>{
  if(change.status!=='complete')return;
  await restore();if(current?.tabId!==id)return;
  const session=current;
  try {
    const options=session.documentId?{documentId:session.documentId}:undefined;
    const response=await chrome.tabs.sendMessage(id,{type:'hermes-probe',sessionId:session.sessionId},options);
    if(response?.sessionId===session.sessionId)return;
  } catch { /* The original document was replaced or discarded. */ }
  if(current!==session)return;
  await stopCurrent(true);current=null;
  await chrome.storage.session.remove(['current','playback']);
}));
