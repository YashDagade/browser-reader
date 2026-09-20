import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const allowed = new Set(['.js','.html','.css','.png']);
const files=[];
function visit(directory) {
  for(const entry of fs.readdirSync(path.join(root,directory),{withFileTypes:true})) {
    const name=path.join(directory,entry.name);
    if(entry.isSymbolicLink())throw Error(`Refusing symlink: ${name}`);
    if(entry.isDirectory())visit(name);
    else if(entry.name==='manifest.json'||allowed.has(path.extname(entry.name)))files.push(name);
    else throw Error(`Unexpected extension asset: ${name}`);
  }
}
visit('extension');
files.push('LICENSE');
fs.mkdirSync(path.join(root,'output'),{recursive:true});
const destination=path.join(root,'output/hermes-extension.zip');
fs.rmSync(destination,{force:true});
execFileSync('zip',['-q','-X',destination,...files.sort()],{cwd:root});
const bytes=files.reduce((n,file)=>n+fs.statSync(path.join(root,file)).size,0);
console.log(`Packaged ${files.length} extension assets: ${bytes} bytes unpacked, ${fs.statSync(destination).size} bytes zipped.`);
console.log(destination);
