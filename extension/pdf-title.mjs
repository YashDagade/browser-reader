const clean=value=>String(value||'').normalize('NFKC').replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim();
function meaningful(value){return value.length>8&&value.length<280&&!/^(?:untitled|document|paper|main|manuscript|microsoft word.*|latex.*|\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?$/i.test(value)&&!/^https?:|\.pdf$/i.test(value);}
function presentation(value){
 const letters=value.replace(/[^\p{L}]/gu,'');
 if(letters.length<10||letters!==letters.toUpperCase())return value;
 const acronyms=new Set(['AI','ML','LLM','LLMS','GPT','NLP','RNN','RNNS','PDF','CLIP','EBT','EBTS','RL','3D','DNA']);
 return value.split(' ').map((word,i)=>{const bare=word.replace(/[^\w]/g,'');if(acronyms.has(bare))return word;const lower=word.toLowerCase();return i&&/^(?:a|an|and|as|at|by|for|in|of|on|or|the|to|with)$/.test(lower)?lower:lower.replace(/\p{L}/u,c=>c.toUpperCase());}).join(' ');
}
export function documentTitle(metadata,model,filename=''){
 const declared=clean(metadata?.info?.Title);if(meaningful(declared))return presentation(declared);
 const paragraphs=model?.pages?.[0]?.paragraphs||[],abstract=paragraphs.findIndex(p=>/^abstract$/i.test(p.text.trim()));
 const front=paragraphs.slice(0,abstract<0?8:abstract);
 const headings=front.filter(p=>p.heading&&!/^(?:preprint|arxiv|accepted|submitted|proceedings|conference)\b/i.test(p.text.trim()));
 const parts=[];for(const p of headings){const text=clean(p.text);if(parts.join(' ').length+text.length>260)break;if(text.length>4)parts.push(presentation(text));if(parts.length===3)break;}
 const inferred=parts.join(' ');if(meaningful(inferred))return inferred;
 return clean(filename).replace(/\.pdf$/i,'').replace(/[_]+/g,' ')||'Untitled paper';
}
export const downloadName=title=>(clean(title).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'').slice(0,110).trim()||'Paper')+' — annotated.pdf';
