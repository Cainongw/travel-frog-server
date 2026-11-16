'use strict';

// Patch a copied hot-update main.min.js for local protocol testing.
// The original file should remain untouched; the output is written separately.

const fs = require('fs');
const path=require('node:path');
const {PROJECT_ROOT}=require('../../src/paths');

const args=process.argv.slice(2),[inputArg,outputArg]=args.filter(x=>!x.startsWith('--'));
if (!inputArg || !outputArg) {
  console.error('usage: node tools/resources/patch_runtime.js input.js output.js [--check]');
  process.exit(2);
}
const input=path.resolve(PROJECT_ROOT,inputArg),output=path.resolve(PROJECT_ROOT,outputArg);
if(input===output)throw Error('Patch output must differ from the original input');

const source = fs.readFileSync(input, 'utf8');
const replacements = [
  ['i=e.channelType,i>ChannelType.Undefined', 'i=1,i>ChannelType.Undefined'],
  ['GameConfig.serverList=n.gameServer', 'GameConfig.serverList=["ws://127.0.0.1:8080"]'],
];
let patched = source;
for (const [oldText, newText] of replacements) {
  const matches = patched.split(oldText).length - 1;
  if (matches !== 1) throw new Error(`expected one occurrence of ${oldText}, found ${matches}`);
  patched = patched.replace(oldText, newText);
}

if(args.includes('--check'))console.log(JSON.stringify({checked:true,input,output,replacements:replacements.length}));
else{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output, patched, 'utf8');console.log(`patched channel selector: ${input} -> ${output}`);}
