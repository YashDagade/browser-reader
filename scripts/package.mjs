import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const allowed = new Set(['.js','.html','.css','.png']);
const secrets = [/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/,/\bgh[pousr]_[A-Za-z0-9]{30,}/,/\bgithub_pat_[A-Za-z0-9_]{40,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
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
visit('extension'); files.push('LICENSE'); files.sort();
// Scan the exact packaged bytes, including untracked assets, without logging secrets.
for(const file of files) {
  if(!fs.lstatSync(path.join(root,file)).isFile())throw Error(`Not a regular file: ${file}`);
  if(secrets.some(pattern=>pattern.test(fs.readFileSync(path.join(root,file)).toString('utf8'))))throw Error(`Credential pattern found in package input: ${file}`);
}
fs.mkdirSync(path.join(root,'output'),{recursive:true});
const unpacked=path.join(root,'output/hermes-extension.zip');
fs.rmSync(unpacked,{force:true});
execFileSync('zip',['-q','-X',unpacked,...files],{cwd:root});
const staging=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-store-'));
const store=path.join(root,'output/hermes-chrome-web-store.zip');
try {
  const names=files.map(file=>file.replace(/^extension\//,''));
  for(let i=0;i<files.length;i++) {
    const target=path.join(staging,names[i]);fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(path.join(root,files[i]),target);
  }
  fs.rmSync(store,{force:true});execFileSync('zip',['-q','-X',store,...names],{cwd:staging});
  const entries=execFileSync('unzip',['-Z1',store],{encoding:'utf8'}).trim().split('\n');
  if(!entries.includes('manifest.json')||entries.some(name=>name.startsWith('extension/')))throw Error('Store ZIP must have manifest.json at its root.');
}finally { fs.rmSync(staging,{recursive:true,force:true}); }
const bytes=files.reduce((n,file)=>n+fs.statSync(path.join(root,file)).size,0);
console.log(`Checked ${files.length} package inputs for credentials. ${bytes} bytes unpacked.`);
console.log(`Unpacked install: ${unpacked} (${fs.statSync(unpacked).size} bytes)`);
console.log(`Chrome Web Store: ${store} (${fs.statSync(store).size} bytes)`);
