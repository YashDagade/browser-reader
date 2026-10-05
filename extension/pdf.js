import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';
import {extractPDFDocument} from './pdf-text.mjs';
import {buildNarration,PDF_DEFAULTS} from './pdf-narration.mjs';
import {PDFView} from './pdf-view.mjs';
const $=selector=>document.querySelector(selector);
let active,model,view,loadingTask,words=[],contentLoaded=false,title='PDF',filters={...PDF_DEFAULTS};
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs',import.meta.url).href;
const status=(message,error=false)=>{$('#status').textContent=message;$('#status').classList.toggle('error',error);};
const controls={'skip-citations':'skipCitations','read-captions':'captions','read-footnotes':'footnotes','read-references':'references'};
const preferencesReady=(async()=>{
  try{const saved=(await chrome.storage.local.get('hermesPDFSettings')).hermesPDFSettings||{};for(const key of Object.keys(filters))if(typeof saved[key]==='boolean')filters[key]=saved[key];}catch{}
  for(const [id,key] of Object.entries(controls))$('#'+id).checked=filters[key];
})();
async function fetchPDF(url,signal) {
  const source=new URL(url);
  if(!['http:','https:'].includes(source.protocol)||source.username||source.password)throw Error('Open a local PDF using the Open PDF button.');
  const response=await fetch(source.href,{signal,credentials:'include',referrerPolicy:'no-referrer'});
  if(!response.ok)throw Error(`Could not open this PDF (${response.status}). Download it and choose Open PDF.`);
  if(Number(response.headers.get('content-length'))>50*1024*1024){await response.body?.cancel();throw Error('This PDF exceeds the 50 MiB limit.');}
  const reader=response.body.getReader(),parts=[];let size=0;
  try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>50*1024*1024){await reader.cancel();throw Error('This PDF exceeds the 50 MiB limit.');}parts.push(value);}}
  finally {reader.releaseLock();}
  const result=new Uint8Array(size);let at=0;for(const part of parts){result.set(part,at);at+=part.length;}
  return result;
}
async function load(input,name,url) {
  active?.abort();const controller=new AbortController();active=controller;
  await globalThis.__hermesReader?.close();
  if(controller.signal.aborted)return;
  view?.destroy();view=null;model=null;words=[];delete globalThis.HermesPDF;
  await loadingTask?.destroy();loadingTask=null;
  if(controller.signal.aborted)return;
  document.body.classList.remove('loaded');$('#page-controls').hidden=true;$('#original').hidden=true;$('#progress').hidden=false;$('#progress').removeAttribute('value');
  $('#pdf-article').replaceChildren();status('Opening PDF…');
  let task;
  try {
    await preferencesReady;
    const bytes=typeof input==='string'?await fetchPDF(input,controller.signal):new Uint8Array(await input.arrayBuffer());
    if(controller.signal.aborted)return;
    if(bytes.byteLength>50*1024*1024)throw Error('This PDF exceeds the 50 MiB limit.');
    task=pdfjs.getDocument({data:bytes,isEvalSupported:false,useWasm:false,enableXfa:false,
      cMapUrl:new URL('./vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,
      standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href,
      wasmUrl:new URL('./vendor/pdfjs/wasm/',import.meta.url).href});
    loadingTask=task;controller.signal.addEventListener('abort',()=>void task.destroy(),{once:true});
    const pdf=await task.promise;
    const extracted=await extractPDFDocument(pdf,{signal:controller.signal,onProgress:(current,total)=>{
      if(active!==controller)return;status(`Preparing page ${current} of ${total}…`);$('#progress').max=total;$('#progress').value=current;
    }});
    if(controller.signal.aborted)return;
    model=extracted;
    let metadata;try{metadata=await pdf.getMetadata();}catch{}
    if(controller.signal.aborted)return;
    title=metadata?.info?.Title?.trim()||name||'Your PDF';
    words=buildNarration(model,filters);
    view=new PDFView({pdfjs,document:pdf,model,container:$('#pdf-article'),
      onPage:number=>{if(document.activeElement!==$('#page-number'))$('#page-number').value=number;},
      onSeek:index=>globalThis.__hermesReader?.seekTo(index)});
    view.setWords(words);
    globalThis.HermesPDF={extract:()=>({title,lang:'en',words,chunks:ReaderExtract.makeChunks(words),source:'pdf'}),highlight:index=>view?.highlight(index),clear:()=>view?.clear()};
    $('#document-title').textContent=title;document.title=title+' · Hermes';
    $('#page-number').replaceChildren(...model.pages.map(page=>{const option=document.createElement('option');option.value=page.number;option.textContent=page.number;return option;}));
    $('#page-number').value=1;$('#page-count').textContent=`/ ${model.pages.length}`;$('#page-controls').hidden=false;$('#original').hidden=!url;
    if(url)$('#original').href=url;
    document.body.classList.add('loaded');$('#zoom').value='fit';view.layout(false);
    status(words.length?'Original pages · Double-click a word to jump · Citations skipped by default':'Pages are visible, but no readable text was found. Scanned PDFs need OCR before narration.');
    if(words.length){if(!contentLoaded){await import('./content.js');await globalThis.__hermesReader.ready;contentLoaded=true;}else await globalThis.__hermesReader.open();}
  } catch(error) {
    if(controller.signal.aborted)return;
    view?.destroy();view=null;model=null;delete globalThis.HermesPDF;await task?.destroy();if(loadingTask===task)loadingTask=null;
    const message=error.name==='PasswordException'?'This PDF is password protected. Open an unlocked copy.':error instanceof TypeError?'Chrome could not open this PDF. Download it and choose Open PDF here.':error.message;
    status(message||'Could not open this PDF. Try downloading a copy.',true);
  } finally {if(active===controller)$('#progress').hidden=true;}
}
let preferenceChange=Promise.resolve();
for(const [id,key] of Object.entries(controls))$('#'+id).addEventListener('change',event=>{
  if(!event.isTrusted)return;filters[key]=event.target.checked;
  void chrome.storage.local.set({hermesPDFSettings:filters}).catch(()=>{});
  preferenceChange=preferenceChange.then(async()=>{
    if(!model||!view)return;words=buildNarration(model,filters);view.setWords(words);await globalThis.__hermesReader?.refresh();
    status('Narration updated. The PDF stays unchanged.');
  }).catch(()=>status('Could not update narration. Close and reopen the player.',true));
});
$('#pdf-file').addEventListener('change',event=>{
  if(!event.isTrusted)return;const file=event.target.files?.[0];event.target.value='';
  if(!file)return;if(file.size>50*1024*1024){status('This PDF exceeds the 50 MiB limit.',true);return;}
  void load(file,file.name);
});
$('#page-number').addEventListener('change',event=>{view?.jump(Number(event.target.value));});
for(const [id,delta] of [['previous-page',-1],['next-page',1]])$('#'+id).addEventListener('click',event=>{if(event.isTrusted&&view)view.jump(Math.max(1,Math.min(model.pages.length,view.current+delta)));});
$('#zoom').addEventListener('change',event=>{view?.setZoom(event.target.value);});
$('#read-page').addEventListener('click',event=>{if(event.isTrusted)void globalThis.__hermesReader?.readFrom(document.getElementById(`page-${$('#page-number').value}`));});
$('#show-reader').addEventListener('click',event=>{if(event.isTrusted)void globalThis.__hermesReader?.open();});
$('#setup').addEventListener('click',event=>{if(event.isTrusted)void chrome.runtime.openOptionsPage();});
addEventListener('pagehide',()=>{active?.abort();view?.destroy();});
try {
  const source=new URLSearchParams(location.search).get('source');
  if(source){const url=new URL(source);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password){
    const name=decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1)||'Your PDF');void load(url.href,name,url.href);
  }else status('Choose Open PDF to read a local document.',true);}
}catch {status('This PDF address is invalid. Choose Open PDF instead.',true);}
