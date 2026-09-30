'use strict';
const cp=require('node:child_process');const path=require('node:path');
const root=path.resolve(__dirname,'..');const out=path.resolve(root,'..','copilot-insights-source.zip');
cp.execFileSync('zip',['-qr',out,'.','-x','node_modules/*','*.vsix','*.zip','.git/*'],{cwd:root,stdio:'inherit'});
console.log(out);
