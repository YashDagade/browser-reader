// A separate, device-local store. No PDF bytes, text, URL, or API key is saved.
export const INK_COLORS=['#2457d6','#252923','#ca4949','#16856b'];
export const MAX_POINTS=200000;
export function validStroke(stroke){return stroke&&typeof stroke.id==='string'&&stroke.id.length>0&&stroke.id.length<=80&&(stroke.createdAt===undefined||Number.isFinite(stroke.createdAt))&&Number.isInteger(stroke.page)&&stroke.page>=1&&stroke.page<=500&&INK_COLORS.includes(stroke.color)&&Number.isFinite(stroke.width)&&stroke.width>=.5&&stroke.width<=8&&Array.isArray(stroke.points)&&stroke.points.length>0&&stroke.points.length<=10000&&stroke.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&Math.abs(v)<1000000));}
export async function documentFingerprint(bytes){const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export class InkStore {
 constructor(indexed=indexedDB){this.indexed=indexed;}
 async database(){
  if(!this.opening)this.opening=new Promise((resolve,reject)=>{
   const request=this.indexed.open('hermes-pdf-ink',1);let abandoned=false;
   request.onupgradeneeded=()=>{const store=request.result.createObjectStore('strokes',{keyPath:['document','id']});store.createIndex('document','document');};
   request.onerror=()=>reject(Error('Local annotation storage is unavailable.'));
   request.onblocked=()=>{abandoned=true;reject(Error('Close other Hermes PDF tabs and retry.'));};
   request.onsuccess=()=>{if(abandoned){request.result.close();return;}this.db=request.result;this.db.onversionchange=()=>this.close();resolve(this.db);};
  });
  try{return await this.opening;}catch(error){this.opening=null;throw error;}
 }
 async run(mode,operation){const db=await this.database();return new Promise((resolve,reject)=>{const tx=db.transaction('strokes',mode),request=operation(tx.objectStore('strokes'));tx.oncomplete=()=>resolve(request.result);tx.onabort=()=>reject(Error('Annotations could not be saved on this device.'));tx.onerror=()=>{};});}
 async read(document){const rows=await this.run('readonly',s=>s.index('document').getAll(document));return rows.filter(validStroke).map(({document:_,...stroke})=>stroke);}
 async put(document,stroke){if(!validStroke(stroke))throw Error('Invalid pen stroke.');await this.run('readwrite',s=>s.put({...stroke,document}));}
 async remove(document,id){await this.run('readwrite',s=>s.delete([document,id]));}
 close(){this.db?.close();this.db=null;this.opening=null;}
}
export class InkDocument {
 constructor({document,store=new InkStore(),onChange=()=>{},onStatus=()=>{}}){Object.assign(this,{document,store,onChange,onStatus});this.strokes=new Map();this.pending=new Map();this.undoStack=[];this.redoStack=[];this.points=0;this.closed=false;}
 async load(){try{const rows=await this.store.read(this.document);for(const s of rows){if(this.points+s.points.length>MAX_POINTS)throw Error('This paper has more ink than this reader can load.');this.strokes.set(s.id,s);this.points+=s.points.length;}this.onStatus('saved');}catch(error){this.onStatus('error',error.message);this.readFailed=true;}this.onChange();}
 values(){return [...this.strokes.values()].sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)||a.id.localeCompare(b.id));}
 onPage(page){return this.values().filter(s=>s.page===page);}
 apply(stroke,id){const old=this.strokes.get(id);this.points-=old?.points.length||0;if(stroke){this.strokes.set(id,stroke);this.points+=stroke.points.length;}else this.strokes.delete(id);this.pending.set(id,stroke);this.onChange(stroke?.page||old?.page);void this.flush();}
 change(before,after){if(this.readFailed)throw Error('Annotations could not be loaded. Reopen the PDF before drawing to protect existing marks.');const size=this.points-(before?.points.length||0)+(after?.points.length||0);if(size>MAX_POINTS)throw Error('This paper has reached its ink limit. Download a copy, then erase some marks to add more.');const id=(after||before).id;this.undoStack.push({before,after});this.redoStack=[];this.apply(after,id);}
 add(stroke){if(!validStroke(stroke))throw Error('Invalid pen stroke.');this.change(null,stroke);}
 erase(id){const before=this.strokes.get(id);if(before)this.change(before,null);}
 undo(){const command=this.undoStack.pop();if(!command)return;this.redoStack.push(command);this.apply(command.before,(command.after||command.before).id);}
 redo(){const command=this.redoStack.pop();if(!command)return;this.undoStack.push(command);this.apply(command.after,(command.after||command.before).id);}
 async flush(){
  if(this.saving)return this.saving;if(!this.pending.size)return;
  this.onStatus('saving');
  this.saving=Promise.resolve().then(async()=>{try{while(this.pending.size){const [id,stroke]=this.pending.entries().next().value;if(stroke)await this.store.put(this.document,stroke);else await this.store.remove(this.document,id);if(this.pending.get(id)===stroke)this.pending.delete(id);}if(!this.readFailed)this.onStatus('saved');}catch(error){this.onStatus('error',error.message);}}).finally(()=>{this.saving=null;});
  return this.saving;
 }
 async close(){this.closed=true;await this.flush();this.store.close();}
}
