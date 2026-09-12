'use strict';

// Patch a copied hot-update main.min.js for local protocol testing.
// The original file should remain untouched; the output is written separately.

const fs = require('fs');

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node patch_runtime.js input.js output.js');
  process.exit(2);
}

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

fs.writeFileSync(output, patched, 'utf8');
console.log(`patched channel selector: ${input} -> ${output}`);
