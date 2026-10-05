import {readPDF} from './pdf-text.mjs';
const $=selector=>document.querySelector(selector);
let active, pages=[], contentLoaded=false, sourceURL;
const status=(message,error=false)=>{$('#status').textContent=message;$('#status').classList.toggle('error',error);};
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
  $('#page-controls').hidden=true;$('#progress').hidden=false;$('#progress').removeAttribute('value');
  $('#pdf-article').replaceChildren();status('Opening PDF…');
  try {
    const bytes=typeof input==='string'?await fetchPDF(input,controller.signal):new Uint8Array(await input.arrayBuffer());
    if(controller.signal.aborted)return;
    pages=await readPDF(bytes,{signal:controller.signal,onProgress:(current,total)=>{
      if(active!==controller)return;status(`Extracting page ${current} of ${total}…`);$('#progress').max=total;$('#progress').value=current;
    }});
    if(controller.signal.aborted)return;
    const fragment=document.createDocumentFragment();
    for(const page of pages) {
      const section=document.createElement('section');section.className='pdf-page';section.id=`page-${page.number}`;
      const label=document.createElement('div');label.className='page-label';label.textContent=`PAGE ${page.number}`;label.setAttribute('aria-hidden','true');section.append(label);
      for(const paragraph of page.paragraphs){const p=document.createElement(paragraph.heading?'h2':'p');p.textContent=paragraph.text;section.append(p);}
      if(!page.paragraphs.length){const empty=document.createElement('p');empty.textContent='No selectable text on this page.';empty.setAttribute('aria-hidden','true');section.append(empty);}
      fragment.append(section);
    }
    $('#pdf-article').append(fragment);
    $('#document-title').textContent=name||'Your PDF';document.title=(name||'PDF')+' · Hermes';
    $('#page-number').replaceChildren(...pages.map(page=>{const option=document.createElement('option');option.value=page.number;option.textContent=page.number;return option;}));
    $('#page-controls').hidden=false;$('#original').hidden=!url;
    if(url)$('#original').href=url;
    status(`${pages.length} pages ready. Press Start reading, or choose a page to begin there.`);
    if(!contentLoaded){await import('./content.js');await globalThis.__hermesReader.ready;contentLoaded=true;}else await globalThis.__hermesReader.open();
  } catch(error) {
    if(controller.signal.aborted)return;
    const message=error.name==='PasswordException'?'This PDF is password protected. Open an unlocked copy.':error instanceof TypeError?'Chrome could not fetch this PDF. Keep the original tab open, or download the PDF and choose Open PDF here.':error.message;
    status(message||'Could not extract this PDF. Try a copy with selectable text.',true);
  } finally {if(active===controller)$('#progress').hidden=true;}
}
$('#pdf-file').addEventListener('change',event=>{
  if(!event.isTrusted)return;const file=event.target.files?.[0];event.target.value='';
  if(!file)return;if(file.size>50*1024*1024){status('This PDF exceeds the 50 MiB limit.',true);return;}
  void load(file,file.name);
});
$('#page-number').addEventListener('change',event=>{if(event.isTrusted)document.getElementById(`page-${event.target.value}`)?.scrollIntoView({behavior:'smooth',block:'start'});});
$('#read-page').addEventListener('click',event=>{if(event.isTrusted)void globalThis.__hermesReader?.readFrom(document.getElementById(`page-${$('#page-number').value}`));});
$('#show-reader').addEventListener('click',event=>{if(event.isTrusted)void globalThis.__hermesReader?.open();});
$('#setup').addEventListener('click',event=>{if(event.isTrusted)void chrome.runtime.openOptionsPage();});
addEventListener('pagehide',()=>active?.abort());
try {
  const source=new URLSearchParams(location.search).get('source');
  if(source){sourceURL=new URL(source);if(['https:','http:'].includes(sourceURL.protocol)&&!sourceURL.username&&!sourceURL.password){
    const name=decodeURIComponent(sourceURL.pathname.split('/').filter(Boolean).at(-1)||'Your PDF');
    void load(sourceURL.href,name,sourceURL.href);
  }else status('Choose Open PDF to read a local document.',true);}
}catch {status('This PDF address is invalid. Choose Open PDF instead.',true);}
