import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const forbidden=/(^|\/)(\.env(?:\..*)?|credentials[^/]*\.json|id_rsa|id_ed25519|[^/]+\.(?:pem|key|p12|pfx))$/i;
const patterns=[/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/,/\bgh[pousr]_[A-Za-z0-9]{30,}/,/\bgithub_pat_[A-Za-z0-9_]{40,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
const failures=[];
for(const file of files){
 if(forbidden.test(file)&&!file.endsWith('.env.example'))failures.push(file);
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())continue;
 if(/\.(png|gif|mp4|wav|webm)$/.test(file))continue;
 const text=fs.readFileSync(file,'utf8');if(patterns.some(p=>p.test(text)))failures.push(file);
}
if(failures.length){console.error('Potential credential material found in tracked files:',[...new Set(failures)].join(', '));process.exit(1);}
console.log(`Credential-pattern check passed for ${files.length} tracked files. No secret values printed.`);
