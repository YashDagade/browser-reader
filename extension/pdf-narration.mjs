// Speech is a filtered view of the source. Every spoken token keeps its PDF
// item/character coordinates; the visible PDF itself is never rewritten.
export const PDF_DEFAULTS={skipCitations:true,footnotes:false,references:false,captions:true,tables:true};
const normalize=text=>text.normalize('NFKC').replace(/\u00ad/g,'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
function sourceOffset(original,offset,end=false) {
  if(normalize(original)===original)return offset;
  let count=0,index=0;
  for(const char of original){const size=normalize(char).length;if(count+size>offset)return end?index+char.length:index;count+=size;index+=char.length;if(count===offset)return index;}
  return original.length;
}
export function sourceRefs(paragraph,start,end,page) {
  return (paragraph.segments||[]).filter(s=>s.end>start&&s.start<end).map(s=>({page,item:s.item,
    start:sourceOffset(s.original,s.offset+Math.max(start,s.start)-s.start),
    end:sourceOffset(s.original,s.offset+Math.min(end,s.end)-s.start,true)}));
}
function maskRange(chars,start,end){for(let n=start;n<end;n++)chars[n]=' ';}
export function withoutCitations(text) {
  const chars=text.split('');
  // Parenthetical author-year citations, including multiple works. Keep
  // equations, named model versions, parenthetical definitions and prose dates.
  for(const match of text.matchAll(/\([^()]{0,500}\)/gu)){
    const inner=match[0].slice(1,-1);
    const works=inner.split(';');
    if(works.every(work=>/^\s*\p{Lu}[\p{L}\p{M}\s.'’&,-]*?(?:,\s*|\s+)(?:19|20)\d{2}[a-z]?(?:\s*,\s*(?:19|20)\d{2}[a-z]?)*\s*$/u.test(work)))maskRange(chars,match.index,match.index+match[0].length);
  }
  for(const match of text.matchAll(/\[\s*[1-9]\d{0,3}(?:\s*[,;–—−-]\s*[1-9]\d{0,3})*\s*\]/gu)){
    const before=text.slice(Math.max(0,match.index-65),match.index);
    // Avoid common mathematical lists/intervals; zero-containing intervals do
    // not match the citation pattern in the first place.
    if(/(?:vector|array|interval|range|coordinates|indices|shape|matrix|values?|\bin)\s*(?:of|is|=|:)?\s*$/i.test(before)||/[=∈]\s*$/.test(before))continue;
    maskRange(chars,match.index,match.index+match[0].length);
  }
  return chars.join('');
}
function isFootnote(paragraph,page){return paragraph.lines?.length&&paragraph.lines.every(l=>l.height<page.font*.94&&l.y<page.height*.23);}
function caption(paragraph){return /^\s*(?:Figure|Fig\.|Table)\s+\d+[.:]/i.test(paragraph.text);}
function originalParagraph(items,number) {
  let text='';const segments=[];
  for(const {item,index} of items){if(text)text+=' ';const value=normalize(item.str);segments.push({start:text.length,end:text.length+value.length,item:index,original:item.str,offset:0});text+=value;}
  return {text,segments,page:number};
}
// Boolean comparison tables: narrate each row with its column labels instead
// of reading all labels first and then an unexplained stream of symbols.
export function booleanTables(page) {
  const items=page.content.items.map((item,index)=>({item,index})).filter(x=>x.item.str?.trim()&&x.item.height>0);
  const checks=items.filter(x=>/^[✓✔☑✗✘✕✖×]$/.test(x.item.str.trim()));
  const rows=[];
  for(const check of checks){let row=rows.find(r=>Math.abs(r.y-check.item.transform[5])<page.font*.35);if(!row)rows.push(row={y:check.item.transform[5],checks:[]});row.checks.push(check);}
  const valid=rows.filter(r=>r.checks.length>=2).sort((a,b)=>b.y-a.y),groups=[];
  for(const row of valid){let group=groups.at(-1);if(!group||group.at(-1).y-row.y>page.font*3)groups.push(group=[]);group.push(row);}
  return groups.filter(group=>group.length>=2).map(group=>{
    const centers=group[0].checks.map(x=>x.item.transform[4]+x.item.width/2).sort((a,b)=>a-b);
    const top=group[0].y,bottom=group.at(-1).y;
    const headerItems=items.filter(({item:i})=>i.transform[5]>top+page.font*.6&&i.transform[5]<top+page.font*3.8&&i.width<page.width*.4);
    const headers=centers.map((center,column)=>{
      const left=column?(centers[column-1]+center)/2:center-(centers[1]-center)/2;
      const right=column<centers.length-1?(center+centers[column+1])/2:center+(center-centers[column-1])/2;
      return headerItems.filter(({item:i})=>i.transform[4]+i.width/2>=left&&i.transform[4]+i.width/2<right).sort((a,b)=>b.item.transform[5]-a.item.transform[5]||a.item.transform[4]-b.item.transform[4]);
    });
    const consumed=new Set(headerItems.map(i=>i.index));
    const paragraphs=group.map(row=>{
      const values=items.filter(({item:i})=>Math.abs(i.transform[5]-row.y)<page.font*.35).sort((a,b)=>a.item.transform[4]-b.item.transform[4]);
      values.forEach(v=>consumed.add(v.index));
      const labels=values.filter(v=>v.item.transform[4]<centers[0]-page.font*1.5);
      const parts=[{...originalParagraph(labels,page.number),suffix:'.'}];
      row.checks.sort((a,b)=>a.item.transform[4]-b.item.transform[4]).forEach((check,column)=>{
        if(headers[column]?.length)parts.push({...originalParagraph(headers[column],page.number),suffix:':'});
        parts.push({text:/[✓✔☑]/.test(check.item.str)?'Yes.':'No.',directRefs:[{page:page.number,item:check.index,start:0,end:check.item.str.length}]});
      });
      return {y:row.y,parts};
    });
    return {top,bottom,consumed,paragraphs};
  });
}
export function buildNarration(model,options={}) {
  const settings={...PDF_DEFAULTS,...options},words=[];
  let block=0,inReferences=false;const occurrences=new Map();
  function add(paragraph,page){
    const filtered=settings.skipCitations?withoutCitations(paragraph.text):paragraph.text;
    for(const match of filtered.matchAll(/\S+/gu)){
      let text=match[0];if(!/[\p{L}\p{N}✓✔☑✗✘✕✖×]/u.test(text)){
        if(words.length&&/^[.,;:!?]+$/.test(text))words.at(-1).text+=text;
        continue;
      }
      const refs=paragraph.directRefs||sourceRefs(paragraph,match.index,match.index+match[0].length,page);
      if(!refs.length)continue;
      const key=`${page}:${refs[0].item}:${refs[0].start}`,occurrence=occurrences.get(key)||0;occurrences.set(key,occurrence+1);
      words.push({text,refs,page,block,sourceKey:`${key}:${occurrence}`});
    }
    if(paragraph.suffix&&words.at(-1)?.block===block)words.at(-1).text+=paragraph.suffix;
  }
  for(const page of model.pages){
    const source=model.sourcePages[page.number-1],tables=booleanTables(source),used=new Set();
    const tableItems=new Set(tables.flatMap(t=>[...t.consumed]));
    for(const paragraph of page.paragraphs){
      if(/^(?:\d+\s+)?(?:References|Bibliography|Literature cited)\s*$/i.test(paragraph.text.trim()))inReferences=true;
      else if(inReferences&&paragraph.heading&&/^(?:[A-Z](?:\.\d+)?\s+|Appendix\b|Supplementary\b)/.test(paragraph.text))inReferences=false;
      if(inReferences&&!settings.references)continue;
      if(!settings.footnotes&&isFootnote(paragraph,source)&&!caption(paragraph))continue;
      if(!settings.captions&&caption(paragraph))continue;
      const included=paragraph.segments?.filter(s=>tableItems.has(s.item))||[];
      if(included.length){
        for(const table of tables)if(!used.has(table)&&included.some(s=>table.consumed.has(s.item))){
          used.add(table);if(settings.tables)for(const row of table.paragraphs){for(const part of row.parts)add(part,page.number);block++;}
        }
        // Paragraphs can straddle the end of a table and the next prose block.
        const chars=paragraph.text.split('');for(const s of included)maskRange(chars,s.start,s.end);
        add({...paragraph,text:chars.join('')},page.number);block++;continue;
      }
      add(paragraph,page.number);block++;
    }
  }
  return words;
}
