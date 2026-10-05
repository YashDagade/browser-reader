// Original-page rendering with a bounded canvas working set. Narration retains
// source coordinates even when a page is not currently mounted.
export class PDFView {
  constructor({pdfjs,document:pdf,model,container,onPage=()=>{},onSeek=()=>{}}) {
    Object.assign(this,{pdfjs,pdf,model,container,onPage,onSeek});
    this.words=[];this.mounted=new Map();this.desired=[];this.current=1;this.active=-1;this.zoom='fit';this.epoch=0;this.dead=false;
    this.shells=model.sourcePages.map(source=>{
      const shell=document.createElement('section');shell.className='pdf-page';shell.id=`page-${source.number}`;shell.dataset.page=source.number;shell.setAttribute('aria-label',`Page ${source.number}`);
      const surface=document.createElement('div');surface.className='pdf-surface';shell.append(surface);container.append(shell);
      return {shell,surface,source,viewport:null};
    });
    this.scroll=()=>{if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=null;this.updateWindow();});};
    this.resize=()=>{clearTimeout(this.resizeTimer);this.resizeTimer=setTimeout(()=>this.layout(true),120);};
    this.doubleClick=event=>this.seekFromPoint(event);
    addEventListener('scroll',this.scroll,{passive:true});addEventListener('resize',this.resize);
    container.addEventListener('dblclick',this.doubleClick);
    this.layout(false);
  }
  setWords(words){this.words=words;this.clear();}
  setZoom(value){this.zoom=value;this.layout(true);}
  layout(preserve) {
    if(this.dead)return;
    const anchor=this.shells[this.current-1];
    const offset=preserve?anchor.shell.getBoundingClientRect().top:0;
    this.epoch++;for(const number of [...this.mounted.keys()])this.evict(number);
    const available=Math.max(280,Math.min(1100,this.container.clientWidth-32));
    for(const record of this.shells){
      const {source,surface}=record;
      const natural=source.viewport;
      const scale=this.zoom==='fit'?available/natural.width:Number(this.zoom)*96/72;
      const viewport=natural.clone({scale});
      record.viewport=viewport;surface.style.width=`${viewport.width}px`;surface.style.height=`${viewport.height}px`;surface.style.setProperty('--total-scale-factor',viewport.scale*(source.userUnit||1));
    }
    if(preserve)scrollBy({top:anchor.shell.getBoundingClientRect().top-offset,behavior:'instant'});
    this.updateWindow();
  }
  updateWindow() {
    if(this.dead)return;
    const header=document.querySelector('header').getBoundingClientRect().bottom;
    const readingLine=header+(innerHeight-header)*.25;
    let closest=1,distance=Infinity;
    for(const {shell,source} of this.shells){const rect=shell.getBoundingClientRect();const d=rect.bottom>readingLine?Math.max(0,rect.top-readingLine):Infinity;if(d<distance){distance=d;closest=source.number;}}
    this.current=closest;this.onPage(closest);
    this.desired=[closest,closest+1,closest-1].filter(n=>n>0&&n<=this.shells.length);
    for(const number of this.mounted.keys())if(!this.desired.includes(number))this.evict(number);
    void this.pump();
  }
  async pump() {
    if(this.running||this.dead)return;this.running=true;
    try {while(!this.dead){const number=this.desired.find(n=>!this.mounted.has(n));if(!number)break;await this.render(number);}}
    finally {this.running=false;}
  }
  async render(number) {
    const record=this.shells[number-1],epoch=this.epoch;
    const entry={...record,number,divs:new Map(),cancelled:false};this.mounted.set(number,entry);
    const {surface,viewport,source}=record;surface.dataset.state='loading';
    try {
      const page=await this.pdf.getPage(number);entry.page=page;
      if(entry.cancelled||this.dead||epoch!==this.epoch)return;
      const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');
      const ratio=Math.min(devicePixelRatio||1,2,Math.sqrt(3000000/(viewport.width*viewport.height)));
      canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width='100%';canvas.style.height='100%';entry.canvas=canvas;
      const layer=document.createElement('div');layer.className='textLayer';layer.setAttribute('aria-label',`Selectable text on page ${number}`);
      const marks=document.createElement('div');marks.className='pdf-highlights';marks.setAttribute('aria-hidden','true');entry.marks=marks;
      surface.replaceChildren(canvas,layer,marks);
      entry.renderTask=page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport,transform:[ratio,0,0,ratio,0,0]});
      entry.textLayer=new this.pdfjs.TextLayer({textContentSource:source.content,container:layer,viewport});
      await Promise.all([entry.renderTask.promise,entry.textLayer.render()]);
      if(entry.cancelled||this.dead||epoch!==this.epoch)return;
      let position=0;source.content.items.forEach((item,index)=>{if(typeof item.str==='string'){const div=entry.textLayer.textDivs[position++];if(div){entry.divs.set(index,div);div.dataset.pdfItem=index;}}});
      surface.dataset.state='ready';this.paint();
    } catch(error) {
      if(entry.cancelled||this.dead||epoch!==this.epoch)return;
      surface.dataset.state='error';surface.replaceChildren();
      const message=document.createElement('p');message.className='page-error';message.textContent=`Page ${number} could not render. `;
      const retry=document.createElement('button');retry.textContent='Retry page';retry.onclick=event=>{if(event.isTrusted){this.evict(number);void this.pump();}};message.append(retry);surface.append(message);
      console.warn('Hermes PDF page rendering failed:',error.name);
    }
  }
  evict(number) {
    const entry=this.mounted.get(number);if(!entry)return;
    entry.cancelled=true;entry.renderTask?.cancel();entry.textLayer?.cancel();
    if(entry.canvas){entry.canvas.width=0;entry.canvas.height=0;}
    entry.surface.replaceChildren();delete entry.surface.dataset.state;entry.page?.cleanup();this.mounted.delete(number);
  }
  ranges(word) {
    const entry=this.mounted.get(word?.page);if(!entry||entry.surface.dataset.state!=='ready')return [];
    return word.refs.flatMap(ref=>{
      const node=entry.divs.get(ref.item)?.firstChild;if(!node||node.nodeType!==Node.TEXT_NODE)return [];
      const range=document.createRange();range.setStart(node,Math.min(ref.start,node.length));range.setEnd(node,Math.min(ref.end,node.length));return [range];
    });
  }
  rectangle(word) {
    const range=this.ranges(word)[0];if(range)return range.getBoundingClientRect();
    const ref=word?.refs[0],record=this.shells[(ref?.page||1)-1];if(!ref||!record)return null;
    const item=record.source.content.items[ref.item];if(!item)return null;
    const x=item.transform[4],y=item.transform[5],length=Math.max(1,item.str.length);
    const box=[...record.viewport.convertToViewportPoint(x+item.width*ref.start/length,y-item.height*.2),...record.viewport.convertToViewportPoint(x+item.width*ref.end/length,y+item.height*.8)];
    const surface=record.surface.getBoundingClientRect(),left=Math.min(box[0],box[2])+surface.left,top=Math.min(box[1],box[3])+surface.top;
    return {left,top,right:Math.max(box[0],box[2])+surface.left,bottom:Math.max(box[1],box[3])+surface.top};
  }
  highlight(index) {
    if(this.active!==index){this.active=index;this.paint();}
    const word=this.words[index];if(!word)return null;
    return {startContainer:this.shells[word.page-1].surface,getBoundingClientRect:()=>this.rectangle(word)};
  }
  paint() {
    for(const entry of this.mounted.values())entry.marks?.replaceChildren();
    const word=this.words[this.active],entry=this.mounted.get(word?.page);if(!entry?.marks)return;
    const box=entry.surface.getBoundingClientRect();
    for(const range of this.ranges(word))for(const rect of range.getClientRects()) {
      if(!rect.width||!rect.height)continue;
      const mark=document.createElement('span');mark.className='pdf-word';mark.style.cssText=`left:${rect.left-box.left}px;top:${rect.top-box.top}px;width:${rect.width}px;height:${rect.height}px`;entry.marks.append(mark);
    }
  }
  clear(){this.active=-1;this.paint();}
  jump(number){this.shells[number-1]?.shell.scrollIntoView({behavior:'instant',block:'start'});this.updateWindow();}
  seekFromPoint(event) {
    if(!event.isTrusted||event.button!==0||event.metaKey||event.ctrlKey)return;
    const point=document.caretRangeFromPoint?.(event.clientX,event.clientY);
    const span=point?.startContainer.parentElement?.closest('[data-pdf-item]'),shell=span?.closest('[data-page]');if(!span||!shell)return;
    const page=Number(shell.dataset.page),item=Number(span.dataset.pdfItem);
    const index=this.words.findIndex(word=>word.page===page&&word.refs.some(ref=>ref.item===item&&point.startOffset>=ref.start&&point.startOffset<ref.end));
    if(index>=0){event.preventDefault();void this.onSeek(index);}
  }
  destroy(){if(this.dead)return;this.dead=true;this.epoch++;cancelAnimationFrame(this.frame);clearTimeout(this.resizeTimer);removeEventListener('scroll',this.scroll);removeEventListener('resize',this.resize);this.container.removeEventListener('dblclick',this.doubleClick);for(const n of [...this.mounted.keys()])this.evict(n);this.container.replaceChildren();}
}
