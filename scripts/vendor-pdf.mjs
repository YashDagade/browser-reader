import fs from 'node:fs/promises';
const base=new URL('../node_modules/pdfjs-dist/',import.meta.url);
const target=new URL('../extension/vendor/pdfjs/',import.meta.url);
const version=JSON.parse(await fs.readFile(new URL('package.json',base),'utf8')).version;
if(version!=='6.4.299')throw Error('Expected pinned PDF.js 6.4.299. Review and update the vendor script when upgrading.');
await fs.mkdir(target,{recursive:true});
for(const [source,destination] of [['legacy/build/pdf.min.mjs','pdf.min.mjs'],['legacy/build/pdf.worker.min.mjs','pdf.worker.min.mjs'],['LICENSE','LICENSE.txt']])await fs.copyFile(new URL(source,base),new URL(destination,target));
console.log('Copied PDF.js 6.4.299 parser, worker, and license without modifications.');
