import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('This background launcher is for macOS. Use npm start on other systems.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const label='com.tempo-reader.speech';
const target=path.join(os.homedir(),'Library','LaunchAgents',`${label}.plist`);
const domain=`gui/${process.getuid()}`;
const action=process.argv[2]||'status';
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function launch(...args){return spawnSync('launchctl',args,{encoding:'utf8'});}
if(action==='install'){
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.mkdirSync(path.join(root,'output'),{recursive:true});
 const args=[process.execPath,path.join(root,'server/server.mjs')];
 const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(x=>`<string>${escape(x)}</string>`).join('')}</array><key>WorkingDirectory</key><string>${escape(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${escape(path.join(root,'output/service.log'))}</string><key>StandardErrorPath</key><string>${escape(path.join(root,'output/service-error.log'))}</string></dict></plist>\n`;
 launch('bootout',domain,target);fs.writeFileSync(target,xml,{mode:0o600});
 const result=launch('bootstrap',domain,target);
 if(result.status!==0)throw Error('Could not register the Tempo background service. Try npm start.');
 console.log('Tempo will run in the background and start when you sign in.');
}else if(action==='uninstall'){
 launch('bootout',domain,target);if(fs.existsSync(target))fs.unlinkSync(target);console.log('Tempo background service removed.');
}else if(action==='restart'){
 const r=launch('kickstart','-k',`${domain}/${label}`);if(r.status!==0)throw Error('Service is not installed. Run npm run service:install first.');console.log('Tempo background service restarted.');
}else{
 const r=launch('print',`${domain}/${label}`);console.log(r.status===0?'Tempo background service is registered.':'Tempo background service is not installed.');
}
