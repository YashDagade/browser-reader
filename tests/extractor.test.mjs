import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('../extension/extractor.js', import.meta.url), 'utf8');
function fixture(body) {
  const dom = new JSDOM(`<!doctype html><html lang="en"><head><title>Test essay</title></head><body>${body}</body></html>`, { runScripts: 'outside-only' });
  dom.window.eval(script);
  return dom;
}
function texts(result) { return Array.from(result.words, word => word.text).join(' '); }

test('extracts essay headings and prose, without menus, advertisements, captions, or hidden content', () => {
  const dom = fixture(`<header><h1>Website name</h1>Site navigation</header><main><article><h1>Scientific essay</h1><section id="contents"><h2>Table of Contents</h2><a href="#intro">Introduction repeated</a></section><aside>Chapter links</aside><section><header><small>Intro</small><h2>Introduction</h2></header><p>Polygenic prediction is distinct from Mendelian inheritance. We preserve technical terminology and read this entire paragraph in its original order.</p><div class="ad-container">Buy now</div><p>The second paragraph explains the central limit theorem, followed by a careful discussion of genomic variance and its relationship to measured outcomes.</p><figcaption>A caption to skip.</figcaption><p hidden>Hidden copy</p><div style="display:none">Invisible copy</div><div aria-hidden="true">Accessible duplicate</div><div class="newsletter">Subscribe now</div><footer>Copyright boilerplate</footer></section></article></main>`);
  const before = dom.window.document.body.innerHTML;
  const result = dom.window.ReaderExtract.extract();
  assert.match(texts(result), /^Scientific essay Introduction Polygenic prediction/);
  assert.doesNotMatch(texts(result), /Buy now|Contents|repeated|Site navigation|Chapter links|caption|Hidden|Invisible|duplicate|Subscribe|Copyright|Website name/);
  assert.equal(result.title, 'Scientific essay');
  assert.equal(dom.window.document.body.innerHTML, before);
  for (const word of result.words) assert.equal(word.range.toString(), word.text);
  dom.window.close();
});

test('maps a word split across inline markup to one exact DOM range', () => {
  const dom = fixture('<main><p>Poly<em>genic</em> prediction with <a href="#research">scientific references</a> remains unchanged. The paragraphs are read verbatim even when authors use emphasis inside specialized terminology.</p></main>');
  const result = dom.window.ReaderExtract.extract();
  assert.equal(result.words[0].text, 'Polygenic');
  assert.equal(result.words[0].range.toString(), 'Polygenic');
  assert.match(texts(result), /with scientific references remains/);
  dom.window.close();
});

test('preserves inline glossary vocabulary and attached punctuation with exact DOM ranges', () => {
  const dom = fixture('<article><p>We study <button type="button" class="glossary-term" data-term="Genomics" data-definition="The study of genomes." aria-expanded="false" aria-label="genomics: show glossary definition" style="display:inline-block">genomics</button>, <span role="button" data-definition="A technical definition."><em>polygenic</em> prediction</span>, and Mendelian inheritance.</p></article>');
  const result = dom.window.ReaderExtract.extract();
  assert.equal(texts(result), 'We study genomics, polygenic prediction, and Mendelian inheritance.');
  assert.doesNotMatch(texts(result), /definition|genomes|show glossary/);
  const term = result.words.find(word => word.text === 'genomics,');
  assert.equal(term.range.startContainer.parentElement.tagName, 'BUTTON');
  assert.equal(term.range.endContainer.nodeValue, ', ');
  for (const word of result.words) assert.equal(word.range.toString(), word.text);
  dom.window.close();
});

test('glossary support does not narrate ordinary buttons or glossary controls outside prose', () => {
  const dom = fixture('<main><button class="glossary-term" data-definition="Terms">Open glossary</button><article><p>Science remains readable. <button>Subscribe now</button> <span role="button">Share article</span> <button class="glossary-term" hidden>Hidden term</button> A <button class="glossary-term">Hamiltonian</button> describes energy.</p><aside><p><button class="glossary-term">Sidebar glossary</button></p></aside></article></main>');
  const result = dom.window.ReaderExtract.extract();
  assert.equal(texts(result), 'Science remains readable. A Hamiltonian describes energy.');
  for (const word of result.words) assert.equal(word.range.toString(), word.text);
  dom.window.close();
});

test('preserves spaces between inline nodes and separates line breaks', () => {
  const dom = fixture('<main><p><span>Alpha</span> <em>beta</em><br><span>gamma</span> delta.</p></main>');
  const result = dom.window.ReaderExtract.extract();
  assert.equal(texts(result), 'Alpha beta gamma delta.');
  for (const word of result.words) assert.equal(word.range.toString(), word.text);
  dom.window.close();
});

test('selection clips partial text nodes and crosses paragraph boundaries exactly', () => {
  const dom = fixture('<article><p>Before alpha <em>beta</em> gamma.</p><p>Delta epsilon after.</p></article>');
  const doc = dom.window.document;
  const range = doc.createRange();
  range.setStart(doc.querySelector('p').firstChild, 7);
  range.setEnd(doc.querySelectorAll('p')[1].firstChild, 13);
  doc.getSelection().addRange(range);
  const result = dom.window.ReaderExtract.extract({ selectionOnly: true });
  assert.equal(result.source, 'selection');
  assert.equal(texts(result), 'alpha beta gamma. Delta epsilon');
  assert.equal(texts(dom.window.ReaderExtract.extract()), 'alpha beta gamma. Delta epsilon');
  assert.notEqual(result.words[0].block, result.words.at(-1).block);
  for (const word of result.words) assert.equal(word.range.toString(), word.text);
  dom.window.close();
});

test('empty selection does not unexpectedly read the full page', () => {
  const dom = fixture('<article><p>Do not start the article when there is no selected text.</p></article>');
  assert.equal(dom.window.ReaderExtract.extract({ selectionOnly: true }).words.length, 0);
  dom.window.close();
});

test('finds a personal essay in div layouts and excludes a large linked menu', () => {
  const menu = Array.from({ length: 100 }, (_, i) => `<a href="/${i}">Navigation entry ${i}</a>`).join(' ');
  const essay = 'The structure of scientific explanation is a central problem in philosophy. '.repeat(15);
  const dom = fixture(`<div class="menu">${menu}</div><div class="post-content"><h1>A personal essay</h1><p>${essay}</p></div>`);
  const result = dom.window.ReaderExtract.extract();
  assert.match(texts(result), /^A personal essay/);
  assert.doesNotMatch(texts(result), /Navigation/);
  dom.window.close();
});

test('chunks cover all words once, start small, preserve jargon, and stay within API limits', () => {
  const dom = fixture('');
  const source = 'An eigenvalue decomposition of the Hamiltonian preserves self-adjointness and noncommutativity. '.repeat(55);
  const result = dom.window.ReaderExtract.fromText(source, 'Technical notes');
  assert.equal(result.source, 'text');
  assert.equal(result.title, 'Technical notes');
  assert.ok(result.chunks[0].end <= 38);
  let position = 0;
  for (const chunk of result.chunks) {
    assert.equal(chunk.start, position);
    assert.ok(chunk.end > chunk.start);
    assert.ok(chunk.end - chunk.start <= 120);
    assert.ok(chunk.text.length <= 1450);
    assert.equal(chunk.text, Array.from(result.words.slice(chunk.start, chunk.end), word => word.text).join(' '));
    position = chunk.end;
  }
  assert.equal(position, result.words.length);
  assert.equal(result.chunks.map(chunk => chunk.text).join(' '), source.trim());
  dom.window.close();
});
