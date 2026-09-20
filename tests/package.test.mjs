import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-package-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'extension'));
 fs.copyFileSync(new URL('../scripts/package.mjs',import.meta.url),path.join(root,'scripts/package.mjs'));
 fs.writeFileSync(path.join(root,'extension/manifest.json'),JSON.stringify({manifest_version:3,name:'Hermes',version:'0.4.0'}));
 fs.writeFileSync(path.join(root,'extension/background.js'),'/* Bundled extension code */');
 fs.writeFileSync(path.join(root,'LICENSE'),'MIT license fixture');
 return {root,run:()=>execFileSync(process.execPath,['scripts/package.mjs'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']})};
}
test('store archive places the manifest at its root and contains only approved extension inputs',t=>{
 const app=fixture(t);fs.writeFileSync(path.join(app.root,'.env.local'),'DO_NOT_PACKAGE=yes');app.run();
 const entries=name=>execFileSync('unzip',['-Z1',path.join(app.root,'output',name)],{encoding:'utf8'}).trim().split('\n').sort();
 assert.deepEqual(entries('hermes-chrome-web-store.zip'),['LICENSE','background.js','manifest.json']);
 assert.deepEqual(entries('hermes-extension.zip'),['LICENSE','extension/background.js','extension/manifest.json']);
});
test('packaging checks untracked bytes and refuses credentials, unexpected files, and symlinks',t=>{
 const app=fixture(t),extra=path.join(app.root,'extension/untracked.js');
 fs.writeFileSync(extra,'const credential="sk-'+'x'.repeat(36)+'";');
 assert.throws(app.run,/Credential pattern found/);
 fs.rmSync(extra);fs.writeFileSync(path.join(app.root,'extension/.env.local'),'DO_NOT_PACKAGE=yes');
 assert.throws(app.run,/Unexpected extension asset/);
 fs.rmSync(path.join(app.root,'extension/.env.local'));fs.symlinkSync('../LICENSE',extra);
 assert.throws(app.run,/Refusing symlink/);
});
