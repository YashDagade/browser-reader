const NS='http://www.w3.org/2000/svg';
export function pointDistance(point,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=dx||dy?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy))):0;return Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy);}
export function strokeHit(stroke,point,radius){const pad=radius+stroke.width/2;const p=stroke.points;if(p.length===1)return pointDistance(point,p[0],p[0])<=pad;for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];if(point[0]<Math.min(a[0],b[0])-pad||point[0]>Math.max(a[0],b[0])+pad||point[1]<Math.min(a[1],b[1])-pad||point[1]>Math.max(a[1],b[1])+pad)continue;if(pointDistance(point,a,b)<=pad)return true;}return false;}
export class InkDrawing {
 constructor({document:ink,container,onError=()=>{}}){Object.assign(this,{ink,container,onError});this.mounts=new Map();this.mode=null;this.color='#2457d6';this.width=2;}
 setMode(mode){this.finish();this.mode=mode;this.container.classList.toggle('inking',!!mode);this.container.classList.toggle('erasing',mode==='erase');}
 mount({number,surface,viewport}){
  this.unmount(number);const svg=document.createElementNS(NS,'svg');svg.classList.add('pdf-ink');svg.setAttribute('viewBox',`0 0 ${viewport.width} ${viewport.height}`);svg.setAttribute('aria-label',`Pen annotations on page ${number}`);
  const record={number,svg,surface,viewport};this.mounts.set(number,record);surface.append(svg);
  svg.addEventListener('pointerdown',e=>this.start(e,record));svg.addEventListener('pointermove',e=>this.move(e));svg.addEventListener('pointerup',e=>{if(e.isTrusted&&e.pointerId===this.live?.pointerId)this.finish();});
  svg.addEventListener('pointercancel',e=>{if(e.isTrusted&&e.pointerId===this.live?.pointerId)this.finish(true);});
  svg.addEventListener('lostpointercapture',e=>{if(e.isTrusted&&e.pointerId===this.live?.pointerId)this.finish();});this.repaint(number);
 }
 unmount(number){if(this.live?.record.number===number)this.finish();const record=this.mounts.get(number);record?.svg.remove();this.mounts.delete(number);}
 polyline(stroke,record){const line=document.createElementNS(NS,'polyline');line.setAttribute('fill','none');line.setAttribute('stroke',stroke.color);line.setAttribute('stroke-width',stroke.width*record.viewport.scale*(record.viewport.userUnit||1));line.setAttribute('stroke-linecap','round');line.setAttribute('stroke-linejoin','round');line.dataset.stroke=stroke.id;this.updateLine(line,stroke.points,record.viewport);return line;}
 updateLine(line,points,viewport){const output=points.map(p=>viewport.convertToViewportPoint(...p));if(output.length===1)output.push([output[0][0]+.01,output[0][1]+.01]);line.setAttribute('points',output.map(p=>p.map(v=>Math.round(v*100)/100).join(',')).join(' '));}
 repaint(number){for(const [page,record] of this.mounts){if(number&&page!==number)continue;record.svg.replaceChildren(...this.ink.onPage(page).map(stroke=>this.polyline(stroke,record)));if(this.live?.record===record&&this.live.preview)record.svg.append(this.live.preview);}}
 point(event,record){const box=record.surface.getBoundingClientRect();return record.viewport.convertToPdfPoint(Math.max(0,Math.min(record.viewport.width,event.clientX-box.left)),Math.max(0,Math.min(record.viewport.height,event.clientY-box.top))).map(v=>Math.round(v*100)/100);}
 start(event,record){
  if(!event.isTrusted||!this.mode||event.button!==0||event.isPrimary===false||this.live)return;
  event.preventDefault();event.stopPropagation();const point=this.point(event,record);
  const stroke={id:crypto.randomUUID(),createdAt:Date.now(),page:record.number,color:this.color,width:this.width,points:[point]};
  this.live={record,stroke,pointerId:event.pointerId,mode:this.mode};record.svg.setPointerCapture(event.pointerId);
  if(this.mode==='erase')this.eraseAt(point,record);else{this.live.preview=this.polyline(stroke,record);record.svg.append(this.live.preview);}
 }
 move(event){
  const live=this.live;if(!event.isTrusted||!live||live.pointerId!==event.pointerId)return;event.preventDefault();
  if(live.mode==='erase'){this.eraseAt(this.point(event,live.record),live.record);return;}
  const events=event.getCoalescedEvents?.();for(const input of events?.length?events:[event]){const p=this.point(input,live.record),previous=live.stroke.points.at(-1);if(live.stroke.points.length<10000&&Math.hypot(p[0]-previous[0],p[1]-previous[1])>.2)live.stroke.points.push(p);}
  if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=null;if(this.live?.preview)this.updateLine(this.live.preview,this.live.stroke.points,this.live.record.viewport);});
 }
 eraseAt(point,record){const radius=7/(record.viewport.scale*(record.viewport.userUnit||1));const hit=this.ink.onPage(record.number).reverse().find(stroke=>strokeHit(stroke,point,radius));if(hit)try{this.ink.erase(hit.id);}catch(error){this.onError(error.message);}}
 finish(cancel=false){const live=this.live;if(!live)return;this.live=null;cancelAnimationFrame(this.frame);this.frame=null;if(live.record.svg.hasPointerCapture(live.pointerId))live.record.svg.releasePointerCapture(live.pointerId);if(live.mode==='pen'&&!cancel)try{this.ink.add(live.stroke);}catch(error){this.onError(error.message);}this.repaint(live.record.number);}
 destroy(){this.finish();for(const number of [...this.mounts.keys()])this.unmount(number);this.setMode(null);}
}
