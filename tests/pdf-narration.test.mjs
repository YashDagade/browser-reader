import test from 'node:test';
import assert from 'node:assert/strict';
import {withoutCitations,buildNarration,sourceRefs,booleanTables} from '../extension/pdf-narration.mjs';
import {pageLines,cleanPages} from '../extension/pdf-text.mjs';
const compact=s=>s.replace(/\s+/g,' ').replace(/\s+([,.;])/g,'$1').trim();
const item=(str,x=40,y=600,width=250,height=10)=>({str,width,height,transform:[height,0,0,height,x,y]});
function model(rawPages){const sourcePages=rawPages.map((items,n)=>({number:n+1,width:600,height:800,font:10,content:{items},lines:pageLines(items,600,800,10)}));return {sourcePages,pages:cleanPages(sourcePages)};}
const spoken=(m,options)=>buildNarration(m,options).map(w=>w.text).join(' ');
test('author-year citations in the supplied Paradox example disappear without removing model names',()=>{
  const text='We use Midjourney (Inc., 2023) to generate, CLIP (Radford et al., 2021) and OpenCLIP (Ilharco et al., 2021) as understanding models, and BLIP-2 (Li et al., 2023), BingChat (Microsoft, 2023), and Bard (Google, 2023).';
  assert.equal(compact(withoutCitations(text)),'We use Midjourney to generate, CLIP and OpenCLIP as understanding models, and BLIP-2, BingChat, and Bard.');
  assert.equal(withoutCitations(text).length,text.length);
  assert.equal(compact(withoutCitations('Results (Gobet, 2017; Alexander, 2003; Berliner, 1994).')),'Results.');
});
test('numeric citations and ranges are silent while reasoning-model versions and meaningful numbers survive',()=>{
  assert.equal(compact(withoutCitations('System 2 uses O1 [11], R1 [12], Grok3 [13], and Claude 3.7 Sonnet [14]. Writing [15–17] and exploration [18].')),'System 2 uses O1, R1, Grok3, and Claude 3.7 Sonnet. Writing and exploration.');
  for(const text of ['A vector [1, 2, 3].','The interval [1, 4].','x ∈ [1, 3].','The range [0, 1].','Results improved 14 percent (in 2023).','Definitions (Reinforcement Learning).','Equation (14).'])assert.equal(withoutCitations(text),text);
});
test('source coordinates survive citation omission, NFKC ligatures, and line-end dehyphenation',()=>{
  const m=model([[item('The mod-',40,650),item('els use ﬁne features [14].',40,638)]]),words=buildNarration(m);
  assert.equal(words.map(w=>w.text).join(' '),'The models use fine features.');
  const joined=words.find(w=>w.text==='models');assert.equal(joined.refs.length,2);
  assert.equal(joined.refs.map(r=>m.sourcePages[0].content.items[r.item].str.slice(r.start,r.end)).join(''),'models');
  const fine=words.find(w=>w.text==='fine'),r=fine.refs[0];assert.equal(m.sourcePages[0].content.items[r.item].str.slice(r.start,r.end),'ﬁne');
  assert.ok(words.every(w=>w.refs.length&&w.refs.every(r=>r.end>r.start)));
  assert.match(spoken(m,{skipCitations:false}),/\[14\]/);
});
test('linked superscript footnote markers are removed without removing ordinary numbers',()=>{
  const items=[item('RNNs generally',40,600,70),item('2',111,604,3,7),item('have 2 states.',115,600,70)];
  const lines=pageLines(items,600,800,10,[{dest:'Hfootnote.2',rect:[110,601,116,612]}]);
  assert.equal(lines.map(l=>l.text).join(' '),'RNNs generally have 2 states.');
});
test('footnotes and bibliography can be included explicitly while captions and appendices remain available',()=>{
  const m=model([[item('A main paragraph.',40,600),item('Figure 1: Important result.',40,450,250,9),item('Footnote detail.',40,100,200,9)],
    [item('References',40,730,200,16),item('An author and their work, 2023.',40,700)],
    [item('A Additional experiments',40,730,300,16),item('Appendix results.',40,700)]]);
  const normal=spoken(m);assert.match(normal,/main paragraph/);assert.match(normal,/Figure 1/);assert.match(normal,/Appendix results/);assert.doesNotMatch(normal,/Footnote detail|An author/);
  assert.match(spoken(m,{footnotes:true,references:true}),/Footnote detail/);assert.match(spoken(m,{references:true}),/An author/);assert.doesNotMatch(spoken(m,{captions:false}),/Figure 1/);
});
test('a comparison table reads row labels and column labels with yes/no and preserves symbol coordinates',()=>{
  const items=[item('Architecture',40,660,80),item('Dynamic compute',220,660,90),item('Verification',390,660,80)];
  for(const [n,label,a,b] of [[0,'FF Transformers','✗','✗'],[1,'EBTs','✓','✓']])items.push(item(label,40,640-n*14,90),item(a,263,640-n*14,5),item(b,428,640-n*14,5));
  const m=model([items]),tables=booleanTables(m.sourcePages[0]);assert.equal(tables.length,1);
  const words=buildNarration(m);assert.equal(words.map(w=>w.text).join(' '),'FF Transformers. Dynamic compute: No. Verification: No. EBTs. Dynamic compute: Yes. Verification: Yes.');
  for(const word of words.filter(w=>/^(Yes|No)\./.test(w.text))){const r=word.refs[0];assert.match(items[r.item].str,/^[✓✗]$/);}
});
test('isolated equation multiplication signs are not classified as a comparison table',()=>{
  assert.equal(booleanTables(model([[item('x',40),item('×',60,600,6),item('y',75,600,6)]]).sourcePages[0]).length,0);
});
test('source mapping does not include whitespace inserted between PDF items',()=>{
  assert.deepEqual(sourceRefs({segments:[{start:0,end:3,item:0,original:'one',offset:0},{start:4,end:7,item:1,original:'two',offset:0}]},0,7,3),[{page:3,item:0,start:0,end:3},{page:3,item:1,start:0,end:3}]);
});
