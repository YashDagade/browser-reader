import fs from 'node:fs/promises';
const base=new URL('../node_modules/pdfjs-dist/',import.meta.url);
const target=new URL('../extension/vendor/pdfjs/',import.meta.url);
const version=JSON.parse(await fs.readFile(new URL('package.json',base),'utf8')).version;
if(version!=='6.4.299')throw Error('Expected pinned PDF.js 6.4.299. Review and update the vendor script when upgrading.');
await fs.mkdir(target,{recursive:true});
for(const [source,destination] of [['legacy/build/pdf.min.mjs','pdf.min.mjs'],['legacy/build/pdf.worker.min.mjs','pdf.worker.min.mjs'],['LICENSE','LICENSE.txt']])await fs.copyFile(new URL(source,base),new URL(destination,target));
for(const directory of ['cmaps','standard_fonts'])await fs.cp(new URL(directory,base),new URL(directory,target),{recursive:true});
await fs.mkdir(new URL('wasm/',target),{recursive:true});
for(const name of ['jbig2_nowasm_fallback.js','openjpeg_nowasm_fallback.js','LICENSE_JBIG2','LICENSE_OPENJPEG','LICENSE_PDFJS_JBIG2','LICENSE_PDFJS_OPENJPEG'])await fs.copyFile(new URL('wasm/'+name,base),new URL('wasm/'+name,target));
console.log('Copied pinned PDF.js, CMaps, fonts, non-WASM image decoders, and their licenses.');

const lib=new URL('../node_modules/pdf-lib/',import.meta.url),libTarget=new URL('../extension/vendor/pdf-lib/',import.meta.url);
if(JSON.parse(await fs.readFile(new URL('package.json',lib),'utf8')).version!=='1.17.1')throw Error('Expected pinned pdf-lib 1.17.1.');
await fs.mkdir(libTarget,{recursive:true});
await fs.copyFile(new URL('dist/pdf-lib.esm.min.js',lib),new URL('pdf-lib.min.mjs',libTarget));
await fs.copyFile(new URL('LICENSE.md',lib),new URL('LICENSE.txt',libTarget));
console.log('Copied pinned pdf-lib browser export module and license.');

for(const [source,name] of [['@pdf-lib/standard-fonts/LICENSE.md','LICENSE_STANDARD_FONTS.txt'],['@pdf-lib/upng/LICENSE','LICENSE_UPNG.txt'],['pako/LICENSE','LICENSE_PAKO.txt'],['tslib/LICENSE.txt','LICENSE_TSLIB.txt']])await fs.copyFile(new URL('../node_modules/'+source,import.meta.url),new URL(name,libTarget));
