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
  let listener;
  window.CSS = { highlights };
  window.Highlight = class { constructor(range) { this.range = range; } };
  window.Range.prototype.getBoundingClientRect = () => ({ top: 120, bottom: 150 });
  window.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: {
      onMessage: { addListener: callback => { listener = callback; } },
      sendMessage: async message => { commands.push(message); return { ok: true, configured: true }; },
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
  return { window, commands, highlights, views, state };
}

test('clicking either inline fragment of a word seeks to that complete word', async t => {
  const app = await harness(t);
  const em = app.window.document.querySelector('em');
  const caret = app.window.document.createRange();
  caret.setStart(em.nextSibling, 3);
  caret.collapse(true);
  app.window.document.caretRangeFromPoint = () => caret;
  app.window.document.querySelector('p').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
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
