import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
for(const directory of ['extension','server','scripts'])for(const file of fs.readdirSync(directory)){
  if(/\.(js|mjs)$/.test(file))execFileSync(process.execPath,['--check',path.join(directory,file)],{stdio:'inherit'});
}
const manifest=JSON.parse(fs.readFileSync('extension/manifest.json','utf8'));
for(const file of [manifest.background.service_worker,manifest.options_page,...Object.values(manifest.icons),'extractor.js','ui.js','content.js','offscreen.html','offscreen.js','speech-client.js','timing.js','audio-cache.js','session-data.js','credential-vault.js']){
  if(!fs.existsSync(path.join('extension',file)))throw Error(`Missing extension file: ${file}`);
}
if(manifest.host_permissions.some(p=>p.includes('<all_urls>')))throw Error('Unexpected broad host permission.');
console.log('Syntax, manifest assets, and permissions checked.');
