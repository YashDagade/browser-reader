import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
const extractor = await readFile(new URL('../extension/extractor.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

async function harness(t) {
  const dom = new JSDOM('<!doctype html><html><body><article><p>These are <em>neuro</em>science words for reading.</p></article></body></html>', {pretendToBeVisual:true, runScripts: 'outside-only', url: 'https://article.example/' });
  t.after(() => dom.window.close());
  const window = dom.window, commands = [], highlights = new Map(), views = [];
  let listener,respond=()=>({ok:true,configured:true});
  window.CSS = { highlights };
  window.Highlight = class { constructor(range) { this.range = range; } };
  window.Range.prototype.getBoundingClientRect = () => ({ top: 120, bottom: 150 });
  window.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: {
      onMessage: { addListener: callback => { listener = callback; } },
      sendMessage: async message => { commands.push(message); return respond(message); },
    },
  };
  window.ReaderUI = {
    create(options) {
      const host = window.document.createElement('div');
      window.document.body.append(host);
      const view = { ...options, host, updates: [], update: value => view.updates.push(value), destroy: () => host.remove() };
      views.push(view);
      return view;
    },
  };
  window.eval(extractor);
  window.eval(source);
  await flush();
  const state = value => listener({ type: 'hermes-state', sessionId: commands.findLast(command => command.action === 'load').sessionId, state: value }, {}, () => {});
  return { window, commands, highlights, views, state, setResponder:fn=>{respond=fn;}, probe:()=>new Promise(resolve=>listener({type:'hermes-probe'}, {},resolve)) };
}

test('double-clicking either inline fragment of a word seeks to that complete word', async t => {
  const app = await harness(t);
  const em = app.window.document.querySelector('em');
  const caret = app.window.document.createRange();
  caret.setStart(em.nextSibling, 3);
  caret.collapse(true);
  app.window.document.caretRangeFromPoint = () => caret;
  app.window.document.querySelector('p').dispatchEvent(new app.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
  await flush();
  assert.equal(app.commands.at(-1).action, 'seek');
  assert.equal(app.commands.at(-1).wordIndex, 2);
});

test('cloud Stop clears its old word highlight and preserves the player', async t => {
  const app = await harness(t);
  app.state({ status: 'playing', wordIndex: 2 });
  assert.equal(app.highlights.get('hermes-word').range.toString(), 'neuroscience');
  app.state({ status: 'idle', wordIndex: 0 });
  assert.equal(app.highlights.size, 0);
  assert.equal(app.views[0].host.isConnected, true);
});

test('pasting a new article releases old page highlights, and close removes player and styles', async t => {
  const app = await harness(t);
  app.state({ status: 'paused', wordIndex: 2 });
  assert.equal(app.highlights.size, 1);
  await app.views[0].onAction('paste', { text: 'An entirely different passage.' });
  assert.equal(app.highlights.size, 0);
  assert.equal(app.commands.at(-1).action, 'play');
  await app.views.at(-1).onAction('close');
  assert.equal(app.views.at(-1).host.isConnected, false);
  assert.equal(app.highlights.size, 0);
  assert.equal(app.window.document.querySelector('style'), null);
});


test('close releases source ranges and layout persists without an audio command',async t=>{
  const app=await harness(t);const before=app.commands.length;
  await app.views[0].onAction('layout',{x:50,y:80,dock:'right',collapsed:true});
  assert.equal(app.commands.length,before+1);assert.equal(app.commands.at(-1).type,'layout');
  await app.views[0].onAction('close');assert.equal(app.commands.at(-1).action,'close');
});

test('follow scrolls the current word in a tall paragraph and yields to manual scrolling',async t=>{
  const app=await harness(t);const scrolls=[];
  app.window.scrollBy=options=>scrolls.push(options);
  app.window.Range.prototype.getBoundingClientRect=()=>({top:900,bottom:925,left:100,right:150});
  app.state({status:'playing',wordIndex:2});
  assert.equal(scrolls.length,1);assert.ok(scrolls[0].top>0);
  app.window.document.dispatchEvent(new app.window.WheelEvent('wheel'));
  app.state({status:'playing',wordIndex:3});assert.equal(scrolls.length,1);
});

test('follow scrolls a nested article pane when the word is clipped inside it',async t=>{
  const app=await harness(t);const pane=app.window.document.querySelector('article');const scrolls=[];
  pane.style.overflowY='auto';Object.defineProperties(pane,{scrollHeight:{value:1800},clientHeight:{value:300}});
  pane.getBoundingClientRect=()=>({top:100,bottom:400});pane.scrollBy=options=>scrolls.push(options);
  app.window.Range.prototype.getBoundingClientRect=()=>({top:450,bottom:475,left:100,right:150});
  app.state({status:'playing',wordIndex:2});assert.equal(scrolls.length,1);assert.equal(scrolls[0].top,230);
});

test('pagehide clears the player and a restored page can reopen with a fresh article',async t=>{
  const app=await harness(t);
  app.window.dispatchEvent(new app.window.PageTransitionEvent('pagehide',{persisted:true}));
  assert.equal(app.views[0].host.isConnected,false);
  assert.equal(app.commands.at(-1).action,'close');
  app.window.eval(source);await flush();
  assert.equal(app.views.length,2);
  assert.equal(app.commands.filter(message=>message.action==='load').length,2);
});


test('ordinary clicks cannot seek but an intentional double-click can',async t=>{
  const app=await harness(t);const p=app.window.document.querySelector('p');
  const caret=app.window.document.createRange();caret.setStart(p.firstChild,2);caret.collapse(true);
  app.window.document.caretRangeFromPoint=()=>caret;
  p.dispatchEvent(new app.window.MouseEvent('click',{bubbles:true,button:0}));await flush();
  assert.equal(app.commands.filter(m=>m.action==='seek').length,0);
  p.dispatchEvent(new app.window.MouseEvent('dblclick',{bubbles:true,button:0}));await flush();
  assert.equal(app.commands.filter(m=>m.action==='seek').length,1);
});

test('Start Reading reconnects a stale session once and preserves its last word',async t=>{
  const app=await harness(t);app.state({status:'paused',wordIndex:4});
  let stale=true;
  app.setResponder(message=>{
    if(message.action==='load'){stale=false;return {ok:true,configured:true};}
    if(stale)return {code:'STALE_SESSION',error:'Reconnect'};
    return {ok:true};
  });
  await app.views[0].onAction('play');
  const reconnect=app.commands.findLast(m=>m.action==='load');
  assert.equal(reconnect.wordIndex,4);assert.equal(app.commands.at(-1).action,'play');
  assert.equal(app.views.length,1);assert.equal(app.views[0].updates.at(-1).error,'');
  assert.equal((await app.probe()).sessionId,reconnect.sessionId);
});

test('follow scrolls before the word reaches the bottom and resumes after manual scrolling',async t=>{
  const app=await harness(t),scrolls=[];let now=10000;
  app.window.Date.now=()=>now;app.window.scrollBy=value=>scrolls.push(value);
  app.window.Range.prototype.getBoundingClientRect=()=>({top:590,bottom:610,left:100,right:150});
  app.state({status:'playing',wordIndex:2});assert.equal(scrolls.length,1);
  app.window.document.dispatchEvent(new app.window.WheelEvent('wheel'));
  now+=500;app.state({status:'playing',wordIndex:2});assert.equal(scrolls.length,1);
  now+=800;app.state({status:'playing',wordIndex:2});assert.equal(scrolls.length,2);
});


test('a late stale reply from an old article cannot reload or restart the newly pasted text',async t=>{
  const app=await harness(t);let answer;
  app.setResponder(message=>message.action==='play'&&!answer?new Promise(resolve=>{answer=resolve;}):{ok:true,configured:true});
  const oldPlay=app.views[0].onAction('play');await flush();
  await app.views[0].onAction('paste',{text:'A replacement article for this reader.'});
  const count=app.commands.length;
  answer({code:'STALE_SESSION',error:'Reconnect'});await oldPlay;
  assert.equal(app.commands.length,count);assert.equal(app.views.length,2);
});


test('a nested pane at its scroll limit does not prevent scrolling the outer page',async t=>{
  const app=await harness(t),outer=[],inner=[];const pane=app.window.document.querySelector('article');
  pane.style.overflowY='auto';Object.defineProperties(pane,{scrollHeight:{value:1800},clientHeight:{value:400}});pane.scrollTop=1400;
  pane.getBoundingClientRect=()=>({top:600,bottom:1000});pane.scrollBy=value=>inner.push(value);
  app.window.scrollBy=value=>outer.push(value);
  app.window.Range.prototype.getBoundingClientRect=()=>({top:960,bottom:985,left:100,right:150});
  app.state({status:'playing',wordIndex:2});assert.equal(inner.length,0);assert.equal(outer.length,1);
});
