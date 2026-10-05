import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {PDFView} from '../extension/pdf-view.mjs';
const settle=async()=>{for(let n=0;n<12;n++)await new Promise(resolve=>setImmediate(resolve));};
function harness(t){
 const dom=new JSDOM('<header></header><article></article>',{pretendToBeVisual:true});const w=dom.window;
 const original=new Map();for(const key of ['document','Node','devicePixelRatio','innerHeight','requestAnimationFrame','cancelAnimationFrame','addEventListener','removeEventListener','scrollBy']){original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value:key==='devicePixelRatio'?2:key==='innerHeight'?800:key==='scrollBy'?()=>{}:typeof w[key]==='function'?w[key].bind(w):w[key],configurable:true});}
 let view; t.after(()=>{view?.destroy();dom.window.close();for(const [key,value] of original)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 w.HTMLCanvasElement.prototype.getContext=()=>({});let scrolled=0;
 w.Element.prototype.getBoundingClientRect=function(){if(this.tagName==='HEADER')return {top:0,bottom:64};const number=Number(this.closest('[data-page]')?.dataset.page||1);const top=100+(number-1)*1060-scrolled;return {top,bottom:top+1040,left:0,right:800,width:800,height:1040};};
 w.Element.prototype.scrollIntoView=function(){scrolled=100+(Number(this.dataset.page)-1)*1060-90;};
 const viewport={width:600,height:780,scale:1,clone({scale}){return {...this,width:600*scale,height:780*scale,scale};},convertToViewportPoint(x,y){return [x*this.scale,(780-y)*this.scale];}};
 const sourcePages=Array.from({length:12},(_,n)=>({number:n+1,viewport,content:{items:[{str:'Printed words',width:100,height:10,transform:[10,0,0,10,50,700]}]}}));
 const model={sourcePages};let cleanups=0;
 const pdf={getPage:async()=>({render:()=>({promise:Promise.resolve(),cancel(){}}),cleanup(){cleanups++;}})};
 class TextLayer{constructor({container,textContentSource}){this.textDivs=textContentSource.items.map(i=>{const div=w.document.createElement('span');div.textContent=i.str;container.append(div);return div;});}async render(){}cancel(){}}
 const container=w.document.querySelector('article');Object.defineProperty(container,'clientWidth',{value:832});
 view=new PDFView({pdfjs:{TextLayer},document:pdf,model,container});
 return {view,w,container,cleanups:()=>cleanups};
}
test('PDF working set stays bounded while page jumps update the current page and release old canvases',async t=>{
 const app=harness(t);await settle();assert.equal(app.view.current,1);assert.equal(app.container.querySelectorAll('canvas').length,2);
 app.view.jump(3);await settle();assert.equal(app.view.current,3);assert.equal(app.container.querySelectorAll('canvas').length,3);
 const old=[...app.container.querySelectorAll('canvas')];app.view.jump(10);await settle();assert.equal(app.view.current,10);
 assert.equal(app.container.querySelectorAll('canvas').length,3);assert.ok(old.every(canvas=>canvas.width===0&&canvas.height===0));assert.ok(app.cleanups()>=3);
 const totalPixels=[...app.container.querySelectorAll('canvas')].reduce((sum,c)=>sum+c.width*c.height,0);assert.ok(totalPixels<9050000);
});
test('offscreen narration gets a usable viewport rectangle and zoom preserves the selected page',async t=>{
 const app=harness(t);await settle();app.view.setWords([{page:10,refs:[{page:10,item:0,start:0,end:7}]}]);
 const virtual=app.view.highlight(0),rect=virtual.getBoundingClientRect();assert.ok(virtual.startContainer.isConnected);assert.ok(rect.top>800);assert.ok(rect.right>rect.left);
 app.view.jump(10);await settle();app.view.setZoom('1.5');await settle();assert.equal(app.view.current,10);assert.ok(app.container.querySelectorAll('canvas').length<=3);
 app.view.destroy();assert.equal(app.container.childElementCount,0);
});
