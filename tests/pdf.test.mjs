import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {readPDF,bodyFont,pageLines,cleanPages} from '../extension/pdf-text.mjs';

const item=(str,x,y,width=220,height=10)=>({str,width,height,transform:[height,0,0,height,x,y]});
const page=(number,items)=>({number,font:10,width:600,height:800,lines:pageLines(items,600,800,10)});
test('PDF layout reads columns in order and skips repeated headers, page numbers, and rotated watermarks',()=>{
  const columns=[item('A paper title',40,730,500,16)];
  for(let n=0;n<5;n++)columns.push(item(`Left ${n} scientific sentence.`,40,650-n*12),item(`Right ${n} scientific sentence.`,330,650-n*12));
  columns.push(item('Running header',40,780),item('arXiv watermark',10,400,20,10));columns.at(-1).transform=[0,10,-10,0,10,400];
  columns.push(item('1',300,20,5));
  const cleaned=cleanPages([page(1,columns),page(2,[item('Running header',40,780),item('Another page of readable scientific prose.',40,600)])]);
  const text=cleaned[0].paragraphs.map(p=>p.text).join(' ');
  assert.ok(text.indexOf('Left 4')<text.indexOf('Right 0'));assert.ok(text.includes('Right 4'));
  assert.doesNotMatch(text,/Running header|watermark/);assert.notEqual(cleaned[0].paragraphs.at(-1).text,'1');
});

test('PDF paragraphs rejoin typesetting breaks while retaining attested and common technical compounds',()=>{
  const cleaned=cleanPages([page(1,[item('The mod-',40,650),item('els provide human-',40,638),item('like responses to queries.',40,626),item('We study expert-level outputs.',40,590),item('These expert-',40,578),item('level outputs matter.',40,566)])]);
  assert.equal(cleaned[0].paragraphs[0].text,'The models provide human-like responses to queries.');
  assert.equal(cleaned[0].paragraphs[1].text,'We study expert-level outputs. These expert-level outputs matter.');
  assert.equal(bodyFont([item('Short title',40,750,250,24),item('A long paragraph of scientific writing used to estimate the body font.',40,600)]),10);
});

test('a narrow caption gutter does not interrupt a neighboring body sentence',()=>{
  const p=page(1,[item('A full width paragraph before the figure.',108,330,396),item('The extent of these mod-',108,281,208),item('els understanding.',108,271,80),item('Figure 5:',326,281,36),item('A caption begins here.',365,281,139,9),item('A second line of caption content.',326,271,178,9),item('The following full width section.',108,243,396)]);
  const paragraphs=cleanPages([p])[0].paragraphs.map(p=>p.text);
  assert.ok(paragraphs.includes('The extent of these models understanding.'));
  assert.ok(paragraphs.includes('Figure 5: A caption begins here. A second line of caption content.'));
});

// A small original PDF makes this a real parser test without bundling a paper.
function pdfFixture() {
  const stream='BT /F1 12 Tf 50 740 Td (A locally extracted scientific document.) Tj 0 -16 Td (Second line with readable research prose.) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let value='%PDF-1.4\n';const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(value.length);value+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=value.length;value+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
  value+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(value);
}
test('bundled PDF.js version parses a real PDF and reports progress',async()=>{
  const progress=[];const pages=await readPDF(pdfFixture(),{getDocument,onProgress:(...p)=>progress.push(p)});
  assert.equal(pages.length,1);assert.match(pages[0].paragraphs.map(p=>p.text).join(' '),/locally extracted scientific document/);
  assert.deepEqual(progress,[[1,1]]);
  const vendor=await readFile(new URL('../extension/vendor/pdfjs/pdf.min.mjs',import.meta.url));
  assert.deepEqual(vendor,await readFile(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.min.mjs',import.meta.url)));
  assert.deepEqual(await readFile(new URL('../extension/vendor/pdfjs/pdf.worker.min.mjs',import.meta.url)),await readFile(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',import.meta.url)));
});

test('PDF limits, scanned documents, cancellation, and parser errors always release the worker',async()=>{
  let destroyed=0;const parser=(numPages,items=[])=>()=>({promise:Promise.resolve({numPages,getPage:async()=>({view:[0,0,600,800],getTextContent:async()=>({items})})}),destroy:async()=>{destroyed++;}});
  await assert.rejects(readPDF(new Uint8Array(1),{getDocument:parser(501)}),/500-page/);assert.equal(destroyed,1);
  await assert.rejects(readPDF(new Uint8Array(1),{getDocument:parser(1)}),/scanned/);assert.equal(destroyed,2);
  const abort=new AbortController();abort.abort();
  await assert.rejects(readPDF(new Uint8Array(1),{getDocument:parser(1),signal:abort.signal}),{name:'AbortError'});assert.equal(destroyed,3);
  await assert.rejects(readPDF({byteLength:51*1024*1024},{getDocument:parser(1)}),/50 MiB/);assert.equal(destroyed,3);
  await assert.rejects(readPDF(new Uint8Array(1),{getDocument:()=>({promise:Promise.reject(Error('Malformed PDF')),destroy:async()=>{destroyed++;}})}),/Malformed PDF/);assert.equal(destroyed,4);
});
