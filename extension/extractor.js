(function (global) {
  'use strict';

  const EXCLUDED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'NAV', 'FOOTER', 'ASIDE', 'BUTTON', 'FORM', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'FIGCAPTION', 'IMG', 'SVG', 'CANVAS', 'IFRAME', 'VIDEO', 'AUDIO', 'DIALOG']);
  const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'DT', 'DD', 'DIV', 'SECTION', 'ARTICLE', 'MAIN']);
  const NOISE = /(?:^|[\s_-])(?:ads?|advert(?:isement|ising)?|adverts?|sponsored|cookie(?:s|banner|consent)?|consent|newsletter|subscribe|subscription|navigation|navbar|sidebar|social|share(?:buttons|tools)?|sharing|related(?:posts|articles)?|recommended|recommendations|comments?|disqus|pagination|paywall|modal|popup|pop-up|toc|table-of-contents|chapter-rail|sr-only|visually-hidden)(?:$|[\s_-])/i;
  const CONTENT = /(?:article|essay|post|entry|story)[-_ ]?(?:body|content|text)|(?:^|\s)prose(?:$|\s)/i;
  const SENTENCE_END = /[.!?。！？][”’"')\]]*$/u;

  // Speech is chunked locally. No language model rewrites the source article.
  function makeChunks(words) {
    const chunks = [];
    let start = 0;
    while (start < words.length) {
      const first = start === 0;
      const target = first ? 25 : 85;
      const maximum = first ? 38 : 120;
      const minimum = first ? 12 : 40;
      let end = start;
      let characters = 0;
      let lastBoundary = -1;
      while (end < words.length && end - start < maximum) {
        const nextLength = words[end].text.length + (end === start ? 0 : 1);
        if (characters + nextLength > 1450 && end > start) break;
        characters += nextLength;
        end += 1;
        const boundary = SENTENCE_END.test(words[end - 1].text) || (end < words.length && words[end].block !== words[end - 1].block);
        if (boundary && end - start >= minimum) {
          lastBoundary = end;
          if (end - start >= target) break;
        }
      }
      if (end < words.length && end - start >= target && lastBoundary > start && lastBoundary - start >= minimum) end = lastBoundary;
      // A single enormous URL/token must still fit the API input budget. Normal
      // words are never altered; exceptionally long tokens are split at ingest.
      chunks.push({ text: words.slice(start, end).map(word => word.text).join(' '), start, end });
      start = end;
    }
    return chunks;
  }

  function tokenSpans(text) {
    const matches = [];
    for (const match of text.matchAll(/\S+/gu)) {
      // Only pathological tokens exceed this limit (usually tracking URLs).
      for (let offset = 0; offset < match[0].length; offset += 1400) {
        matches.push({ text: match[0].slice(offset, offset + 1400), start: match.index + offset, end: match.index + Math.min(offset + 1400, match[0].length) });
      }
    }
    return matches;
  }

  function fromText(text, title = 'Selected text') {
    const words = [];
    String(text || '').split(/\n\s*\n|\r\n\s*\r\n/).forEach((paragraph, block) => {
      for (const token of tokenSpans(paragraph)) words.push({ text: token.text, range: null, block });
    });
    return { title: String(title || 'Selected text'), lang: global.document?.documentElement.lang || 'en', words, chunks: makeChunks(words), source: 'text' };
  }

  function extract({ selectionOnly = false } = {}) {
    const doc = global.document;
    if (!doc?.body) return fromText('');
    const selection = doc.getSelection();
    const selectedRange = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    if (selectionOnly && !selectedRange) return { title: doc.title || 'Selected text', lang: doc.documentElement.lang || 'en', words: [], chunks: [], source: 'selection' };

    const eligible = new WeakMap();
    const styleCache = new WeakMap();
    function styleHidden(element) {
      if (styleCache.has(element)) return styleCache.get(element);
      let hidden = false;
      try {
        const style = global.getComputedStyle(element);
        hidden = style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0';
      } catch (_) { /* Detached nodes may have no computed style. */ }
      styleCache.set(element, hidden);
      return hidden;
    }
    function allowed(element) {
      if (!element || element === doc.documentElement) return true;
      if (eligible.has(element)) return eligible.get(element);
      if (!allowed(element.parentElement)) {
        eligible.set(element, false);
        return false;
      }
      const identity = `${element.id || ''} ${typeof element.className === 'string' ? element.className : ''}`;
      const role = element.getAttribute('role');
      const editable = element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false';
      // Some essays turn vocabulary into inline buttons that open a glossary.
      // Keep their visible term in the sentence; definition/ARIA attributes are
      // never narration. Ordinary controls remain excluded, including glossary
      // launchers outside prose and descendants of excluded UI containers.
      const glossaryTerm = (element.classList.contains('glossary-term') || element.hasAttribute('data-definition')) &&
        !!element.parentElement?.closest('p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,dt,dd') &&
        !!element.textContent.trim() && element.textContent.trim().length <= 120;
      const excludedTag = EXCLUDED_TAGS.has(element.tagName) && !(element.tagName === 'BUTTON' && glossaryTerm);
      const excludedRole = ['navigation', 'banner', 'complementary', 'contentinfo', 'dialog'].includes(role) || (role === 'button' && !glossaryTerm);
      let result = !excludedTag && !element.hidden && !element.hasAttribute('inert') && element.getAttribute('aria-hidden') !== 'true' && !editable && !excludedRole && !NOISE.test(identity) && !styleHidden(element);
      if (result && /^(?:contents|table-of-contents)$/i.test(element.id || '')) result = false;
      eligible.set(element, result);
      return result;
    }

    function readableNode(node) {
      const parent = node.parentElement;
      if (!parent || !allowed(parent) || !node.nodeValue) return false;
      const header = parent.closest('header');
      if (header && !(parent.closest('h1,h2,h3,h4,h5,h6') && header.closest('article,main,[role="main"],section,[itemprop="articleBody"],.post,.entry,.post-content,.entry-content,.article-content,.essay-body'))) return false;
      return true;
    }

    // First pass visits each text node once; cached ancestor checks keep long
    // scientific essays responsive even when the page contains large menus.
    const allNodes = [];
    const breaksBefore = new WeakSet();
    let lineBreak = false;
    const walker = doc.createTreeWalker(doc.body, global.NodeFilter.SHOW_TEXT | global.NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === 1) {
        if (node.tagName === 'BR' && allowed(node)) lineBreak = true;
      } else if (readableNode(node)) {
        if (lineBreak) breaksBefore.add(node);
        lineBreak = false;
        allNodes.push(node);
      }
    }

    let root = doc.body;
    if (!selectedRange) {
      const stats = new Map();
      for (const node of allNodes) {
        const length = node.nodeValue.trim().length;
        const linked = !!node.parentElement.closest('a');
        for (let parent = node.parentElement; parent && parent !== doc.documentElement; parent = parent.parentElement) {
          if (!['BODY', 'ARTICLE', 'MAIN', 'DIV', 'SECTION'].includes(parent.tagName) && parent.getAttribute('role') !== 'main') continue;
          let record = stats.get(parent);
          if (!record) stats.set(parent, record = { characters: 0, linked: 0 });
          record.characters += length;
          if (linked) record.linked += length;
        }
      }
      let best = 0;
      for (const [candidate, stat] of stats) {
        if (stat.characters < 100) continue;
        const linkRatio = stat.linked / stat.characters;
        if (linkRatio > 0.55) continue;
        const identity = `${candidate.id} ${candidate.className}`;
        let boost = candidate.tagName === 'ARTICLE' ? 1.3 : candidate.tagName === 'MAIN' || candidate.getAttribute('role') === 'main' ? 1.18 : CONTENT.test(identity) ? 1.12 : 1;
        if (candidate.tagName === 'BODY') boost = 0.8;
        const score = Math.pow(stat.characters, 0.82) * Math.pow(1 - linkRatio, 1.8) * boost;
        if (score > best) { best = score; root = candidate; }
      }
    }

    const blocks = [];
    let currentBlock = null;
    let currentElement = null;
    function blockFor(node) {
      for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (BLOCK_TAGS.has(parent.tagName)) return parent;
      }
      return root;
    }
    for (const node of allNodes) {
      if (!selectedRange && !root.contains(node)) continue;
      let start = 0;
      let end = node.nodeValue.length;
      if (selectedRange) {
        if (!selectedRange.intersectsNode(node)) continue;
        if (node === selectedRange.startContainer) start = selectedRange.startOffset;
        if (node === selectedRange.endContainer) end = selectedRange.endOffset;
        if (end <= start) continue;
      }
      const element = blockFor(node);
      if (element !== currentElement) {
        currentElement = element;
        currentBlock = { text: '', segments: [] };
        blocks.push(currentBlock);
      }
      const text = node.nodeValue.slice(start, end);
      if (breaksBefore.has(node) && currentBlock.text) currentBlock.text += '\n';
      currentBlock.segments.push({ node, nodeStart: start, start: currentBlock.text.length, end: currentBlock.text.length + text.length });
      currentBlock.text += text;
    }

    const words = [];
    blocks.forEach((block, blockIndex) => {
      for (const token of tokenSpans(block.text)) {
        const first = block.segments.find(segment => segment.end > token.start);
        const last = block.segments.find(segment => segment.end >= token.end);
        if (!first || !last) continue;
        const range = doc.createRange();
        range.setStart(first.node, first.nodeStart + token.start - first.start);
        range.setEnd(last.node, last.nodeStart + token.end - last.start);
        words.push({ text: token.text, range, block: blockIndex });
      }
    });
    const heading = root.querySelector('h1')?.textContent.trim();
    return { title: heading || doc.title || 'Untitled article', lang: doc.documentElement.lang || 'en', words, chunks: makeChunks(words), source: selectedRange ? 'selection' : 'article' };
  }

  global.ReaderExtract = { extract, fromText };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.ReaderExtract;
})(typeof window !== 'undefined' ? window : globalThis);
