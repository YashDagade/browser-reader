/* Local PDF text layout. No source text is sent to a model for extraction. */
const normalized = text => text.normalize('NFKC').replace(/\u00ad/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
export function bodyFont(items) {
  const sizes = new Map();
  for (const item of items) if (item.str?.trim() && item.height > 4 && Math.abs(item.transform?.[1] || 0) < Math.abs(item.transform?.[0] || 0) * .25) {
    const size = Math.round(item.height * 2) / 2;
    sizes.set(size, (sizes.get(size) || 0) + item.str.length);
  }
  return [...sizes].sort((a,b)=>b[1]-a[1])[0]?.[0] || 10;
}
export function pageLines(items, width, height, font = bodyFont(items)) {
  const rows=[];
  const parts=items.filter(i=>typeof i.str==='string' && i.str.trim() && i.transform?.length===6 && i.height >= font*.68
    && Math.abs(i.transform[1]) <= Math.abs(i.transform[0])*.25)
    .map(i=>({text:normalized(i.str),x:i.transform[4],y:i.transform[5],width:i.width,height:i.height}))
    .filter(i=>[i.x,i.y,i.width,i.height].every(Number.isFinite)).sort((a,b)=>b.y-a.y||a.x-b.x);
  const starts=[];
  for(const part of parts.filter(p=>p.x>=width*.45&&p.x<width*.8)) {
    let group=starts.find(g=>Math.abs(g.x-part.x)<3);
    if(!group)starts.push(group={x:part.x,ys:new Set(),longest:0});
    group.ys.add(Math.round(part.y/font));group.longest=Math.max(group.longest,part.width);
  }
  const column=starts.filter(g=>g.ys.size>=2&&g.longest>width*.22).sort((a,b)=>b.ys.size-a.ys.size)[0]?.x;
  for(const part of parts) {
    let row=rows.at(-1);
    if(!row || Math.abs(row.y-part.y)>Math.max(2,font*.3))rows.push(row={y:part.y,parts:[]});
    row.parts.push(part);
  }
  const lines=[];
  for(const row of rows) {
    let line;
    for(const part of row.parts.sort((a,b)=>a.x-b.x)) {
      const gap=line?part.x-line.right:Infinity;
      if(!line||gap>Math.max(24,font*2.4)||(column&&part.x>=column-3&&line.right<column+1&&gap>font*.35)) {
        line={text:part.text,x:part.x,y:row.y,right:part.x+part.width,height:part.height,pageWidth:width,pageHeight:height};
        lines.push(line);
      } else {
        line.text+=(gap>font*.15&&!/\s$/.test(line.text)&&!/^\s|^[,.;:!?)]/.test(part.text)?' ':'')+part.text;
        line.right=Math.max(line.right,part.x+part.width);line.height=Math.max(line.height,part.height);
      }
    }
  }
  return lines;
}
function readingOrder(lines,width) {
  const right=lines.filter(l=>l.x>=width/2-5&&l.right-l.x>width*.22);
  const starts=right.map(l=>l.x).sort((a,b)=>a-b);
  const mid=starts.length?starts[Math.floor(starts.length/2)]-5:width/2;
  const left=lines.filter(l=>l.x<mid-30&&l.right<mid+5&&l.right-l.x>width*.22);
  const paired=left.filter(l=>right.some(r=>Math.abs(l.y-r.y)<l.height*.5));
  // A short caption next to body text is still a separate column.
  if(paired.length<1||right.length<2)return [...lines].sort((a,b)=>b.y-a.y||a.x-b.x);
  const result=[],band=[];
  const flush=()=>{result.push(...band.filter(l=>l.x<mid).sort((a,b)=>b.y-a.y||a.x-b.x),...band.filter(l=>l.x>=mid).sort((a,b)=>b.y-a.y||a.x-b.x));band.length=0;};
  for(const line of [...lines].sort((a,b)=>b.y-a.y||a.x-b.x)) {
    if(line.x<mid-30&&line.right>mid+30){flush();result.push(line);}
    else band.push(line);
  }
  flush();return result;
}
export function cleanPages(pages) {
  const repeat=new Map();
  const printedHyphens=new Set(pages.flatMap(p=>p.lines.flatMap(l=>l.text.toLowerCase().match(/\p{L}+-\p{L}+/gu)||[])));
  const signature=l=>l.text.trim().toLowerCase().replace(/\d+/g,'#');
  const margin=l=>l.y>l.pageHeight*.9||l.y<l.pageHeight*.09;
  for(const page of pages)for(const key of new Set(page.lines.filter(l=>margin(l)&&l.text.length<140).map(signature)))repeat.set(key,(repeat.get(key)||0)+1);
  return pages.map(page=>{
    const lines=readingOrder(page.lines.filter(l=>!/^\s*[\d,*∗†‡\s]+\s*$/.test(l.text)&&!(margin(l)&&(repeat.get(signature(l))||0)>=Math.max(2,pages.length*.35))),page.width);
    const paragraphs=[];let previous;
    for(const line of lines) {
      const heading=line.height>page.font*1.18 || /^(?:abstract|references|bibliography)$/i.test(line.text.trim());
      const gap=previous?previous.y-line.y:0;
      const split=!previous||heading||previous.heading||gap<0||gap>page.font*1.3||Math.abs(line.x-previous.x)>page.font*2;
      const text=line.text.trim();if(!text)continue;
      if(split)paragraphs.push({text,heading});
      else {
        const p=paragraphs.at(-1);
        const stem=p.text.match(/(\p{L}+)[-‐]$/u)?.[1],suffix=text.match(/^(\p{Ll}\p{L}*)/u)?.[1];
        if(stem&&suffix) {
          // Rejoin typesetting breaks; preserve compounds attested elsewhere
          // in the PDF and common technical compound endings.
          if(!printedHyphens.has(`${stem}-${suffix}`.toLowerCase())&&!/^(?:like|based|level|driven|dimensional|specific|scale|shot|order|time|free)$/i.test(suffix))p.text=p.text.slice(0,-1);
          p.text+=text;
        } else p.text+=' '+text;
      }
      previous={...line,heading};
    }
    if(page.number===1) {
      const abstract=paragraphs.findIndex(p=>/^abstract$/i.test(p.text));
      if(abstract>2){const title=paragraphs.slice(0,abstract).filter(p=>p.heading).slice(0,2);paragraphs.splice(0,abstract,...title);}
    }
    return {number:page.number,paragraphs};
  });
}
export async function readPDF(data, {onProgress=()=>{}, signal, getDocument: suppliedParser}={}) {
  if(data.byteLength>50*1024*1024)throw Error('This PDF exceeds the 50 MiB limit. Open a smaller document.');
  const pdfjs=suppliedParser?null:await import('./vendor/pdfjs/pdf.min.mjs');
  if(pdfjs)pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs',import.meta.url).href;
  const task=(suppliedParser||pdfjs.getDocument)({data,disableFontFace:true,isEvalSupported:false,useSystemFonts:true,useWasm:false,stopAtErrors:true});
  const abort=()=>{Promise.resolve(task.destroy()).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try {
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const document=await task.promise;
    if(document.numPages>500)throw Error('This PDF exceeds the 500-page limit. Open a smaller section.');
    const pages=[];let characters=0;
    for(let number=1;number<=document.numPages;number++) {
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      const page=await document.getPage(number),content=await page.getTextContent();
      const width=page.view[2]-page.view[0],height=page.view[3]-page.view[1];
      const font=bodyFont(content.items);
      const lines=pageLines(content.items,width,height,font);
      characters+=lines.reduce((n,l)=>n+l.text.length,0);
      if(characters>2000000)throw Error('This PDF has too much text. Open a smaller section.');
      pages.push({number,lines,width,height,font});page.cleanup?.();
      onProgress(number,document.numPages);
    }
    const cleaned=cleanPages(pages);
    if(!cleaned.some(p=>p.paragraphs.some(x=>x.text.length>20)))throw Error('No readable text was found. This PDF may be scanned; use a copy with selectable text.');
    return cleaned;
  } finally {signal?.removeEventListener('abort',abort);await task.destroy();}
}
