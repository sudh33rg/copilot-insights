'use strict';
const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const files=[];function walk(d){for(const n of fs.readdirSync(d)){const p=path.join(d,n);const st=fs.statSync(p);if(st.isDirectory())walk(p);else if(p.endsWith('.js'))files.push(p)}}walk(path.join(root,'src'));walk(path.join(root,'test'));
for(const f of files) cp.execFileSync(process.execPath,['--check',f],{stdio:'inherit'});
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
for(const key of ['name','displayName','version','engines','main','contributes']) if(!(key in pkg)) throw new Error('package.json missing '+key);
if(!fs.existsSync(path.join(root,pkg.main))) throw new Error('main file missing');
console.log(`Checked ${files.length} JavaScript files and extension manifest.`);
