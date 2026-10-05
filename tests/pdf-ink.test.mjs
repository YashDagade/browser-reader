import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {InkStore,InkDocument,documentFingerprint,validStroke} from '../extension/pdf-ink-store.mjs';
import {strokeHit} from '../extension/pdf-ink.mjs';
import {annotatedPDF} from '../extension/pdf-export.mjs';
import {documentTitle,downloadName} from '../extension/pdf-title.mjs';
import * as lib from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const mark=(id='one',page=1)=>({id,page,color:'#2457d6',width:2,createdAt:1,points:[[40,80],[80,90],[120,100]]});
test('pen strokes persist across reopening and remain isolated by document fingerprint',async()=>{
 const factory=new IDBFactory(),store=new InkStore(factory),first=new InkDocument({document:'paper-a',store});await first.load();first.add(mark());await first.flush();await first.close();
 const second=new InkDocument({document:'paper-a',store:new InkStore(factory)});await second.load();assert.deepEqual(second.values(),[mark()]);assert.deepEqual(await second.store.read('paper-b'),[]);await second.close();
 assert.equal(await documentFingerprint(new Uint8Array([1,2,3])),await documentFingerprint(new Uint8Array([1,2,3])));
 assert.notEqual(await documentFingerprint(new Uint8Array([1,2,3])),await documentFingerprint(new Uint8Array([1,2,4])));
});
test('undo, redo, erasure, and a new branch of edits save the visible result',async()=>{
 const doc=new InkDocument({document:'paper',store:new InkStore(new IDBFactory())});await doc.load();doc.add(mark());await doc.flush();doc.erase('one');doc.undo();await doc.flush();assert.equal(doc.values().length,1);assert.equal((await doc.store.read('paper')).length,1);
 doc.redo();await doc.flush();assert.equal(doc.values().length,0);assert.equal((await doc.store.read('paper')).length,0);doc.undo();doc.add(mark('two'));assert.equal(doc.redoStack.length,0);await doc.close();
});
test('rapid undo while a stroke is being written commits the latest intent',async()=>{
 let release;const stored=new Map(),statuses=[];const store={read:async()=>[],put:async(_doc,s)=>{await new Promise(resolve=>{release=resolve;});stored.set(s.id,s);},remove:async(_doc,id)=>stored.delete(id),close(){}};
 const doc=new InkDocument({document:'paper',store,onStatus:s=>statuses.push(s)});await doc.load();doc.add(mark());await Promise.resolve();doc.undo();release();await doc.flush();assert.equal(stored.size,0);assert.equal(doc.pending.size,0);assert.equal(statuses.at(-1),'saved');
});
test('save failures retain pending marks and can be retried without falsely reporting success',async()=>{
 let fail=true;const statuses=[];const store={read:async()=>[],put:async()=>{if(fail)throw Error('Disk full');},close(){}};
 const doc=new InkDocument({document:'paper',store,onStatus:s=>statuses.push(s)});await doc.load();doc.add(mark());await doc.flush();assert.equal(doc.pending.size,1);assert.equal(statuses.at(-1),'error');fail=false;await doc.flush();assert.equal(doc.pending.size,0);assert.equal(statuses.at(-1),'saved');await doc.close();
});
test('failed reads prevent new marks from hiding inaccessible existing annotations',async()=>{
 const doc=new InkDocument({document:'paper',store:{read:async()=>{throw Error('Unavailable');}}});await doc.load();assert.throws(()=>doc.add(mark()),/protect existing/);assert.equal(doc.pending.size,0);
});
test('eraser tests the path rather than only its vertices, and invalid coordinates are rejected',()=>{
 assert.equal(strokeHit(mark(),[60,85],2),true);assert.equal(strokeHit(mark(),[70,130],2),false);assert.equal(validStroke({...mark(),points:[[Infinity,0]]}),false);assert.equal(validStroke({...mark(),color:'url(bad)'}),false);
});
test('two tabs add independent strokes without replacing one another',async()=>{
 const factory=new IDBFactory(),a=new InkStore(factory),b=new InkStore(factory);await Promise.all([a.put('paper',mark('a')),b.put('paper',mark('b'))]);assert.equal((await a.read('paper')).length,2);a.close();b.close();
});
test('PDF titles prefer meaningful metadata and infer the actual title when an arXiv filename is all that is available',()=>{
 const model={pages:[{paragraphs:[{text:'THE GENERATIVE AI PARADOX:',heading:true},{text:'“What It Can Create, It May Not Understand”',heading:true},{text:'Abstract',heading:true},{text:'Other text',heading:false}]}]};
 assert.equal(documentTitle({},model,'2311.00059.pdf'),'The Generative AI Paradox: “What It Can Create, It May Not Understand”');
 assert.equal(documentTitle({info:{Title:'2311.00059.pdf'}},model,'2311.00059.pdf'),documentTitle({},model,''));
 assert.equal(documentTitle({info:{Title:'Energy-Based Transformers are Scalable Learners and Thinkers'}},model),'Energy-Based Transformers are Scalable Learners and Thinkers');
 assert.equal(documentTitle({},null,'useful_paper.pdf'),'useful paper');assert.doesNotMatch(downloadName('../A: test/paper'),/[/:]/);
});
test('annotated export preserves page rotation, crop, content and vector geometry',async()=>{
 const doc=await lib.PDFDocument.create();const page=doc.addPage([600,800]);page.drawText('Original page content',{x:40,y:700});page.setCropBox(20,30,560,740);page.setRotation(lib.degrees(90));
 const bytes=await annotatedPDF(await doc.save(),[mark()],'Readable title',lib);const reloaded=await lib.PDFDocument.load(bytes);assert.equal(reloaded.getTitle(),'Readable title');assert.equal(reloaded.getPage(0).getRotation().angle,90);assert.equal(reloaded.getPage(0).getCropBox().x,20);
 const task=getDocument({data:bytes,useSystemFonts:true});const pdf=await task.promise;try{const p=await pdf.getPage(1);assert.match((await p.getTextContent()).items.map(i=>i.str).join(' '),/Original page content/);const operators=await p.getOperatorList();assert.ok(operators.fnArray.length>10);}finally{await task.destroy();}
});
test('drawing maps viewport positions to the same PDF coordinates after rotation and zoom',async()=>{
 const {InkDrawing}=await import('../extension/pdf-ink.mjs');
 const doc=await lib.PDFDocument.create();const page=doc.addPage([600,800]);page.setCropBox(20,30,560,740);page.setRotation(lib.degrees(90));
 const task=getDocument({data:await doc.save(),useSystemFonts:true});const pdf=await task.promise;
 try{const p=await pdf.getPage(1);for(const scale of [0.7,1.5,2.3]){const viewport=p.getViewport({scale}),[x,y]=viewport.convertToViewportPoint(140,620);const point=InkDrawing.prototype.point({clientX:x+60,clientY:y+130},{viewport,surface:{getBoundingClientRect:()=>({left:60,top:130})}});assert.deepEqual(point,[140,620]);}}finally{await task.destroy();}
});
test('PDF exporter and all bundled dependency notices match pinned local packages',async()=>{
 const {readFile}=await import('node:fs/promises');
 for(const [source,destination] of [['pdf-lib/dist/pdf-lib.esm.min.js','pdf-lib.min.mjs'],['pdf-lib/LICENSE.md','LICENSE.txt'],['@pdf-lib/standard-fonts/LICENSE.md','LICENSE_STANDARD_FONTS.txt'],['@pdf-lib/upng/LICENSE','LICENSE_UPNG.txt'],['pako/LICENSE','LICENSE_PAKO.txt'],['tslib/LICENSE.txt','LICENSE_TSLIB.txt']])assert.deepEqual(await readFile(new URL('../node_modules/'+source,import.meta.url)),await readFile(new URL('../extension/vendor/pdf-lib/'+destination,import.meta.url)));
});
