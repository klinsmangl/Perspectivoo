// Splits obq_index.json (name -> dir, or name -> {dir,w,h,jgw}) into one file per
// FX flight-line code (obq_index/FXnnnn.json). The app fetches only the shard for a
// name it actually needs instead of the whole ~6MB index upfront.
// Run after obq_index.json is replaced with a new delivery: node scripts/shard-index.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'obq_index.json');
const OUT_DIR = path.join(ROOT, 'obq_index');

const index = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const shards = {};

for (const [name, meta] of Object.entries(index)) {
    const m = name.match(/^FX(\d+)_/);
    if (!m) throw new Error(`Name doesn't match FX<code>_ pattern: ${name}`);
    const fx = m[1];
    (shards[fx] ??= {})[name] = meta;
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR);
for (const [fx, shard] of Object.entries(shards)) {
    fs.writeFileSync(path.join(OUT_DIR, `FX${fx}.json`), JSON.stringify(shard));
}

// ponytail: self-check — every source entry must round-trip through exactly one shard
let total = 0;
for (const fx of Object.keys(shards)) total += Object.keys(shards[fx]).length;
console.assert(total === Object.keys(index).length,
    `shard count mismatch: ${total} vs ${Object.keys(index).length}`);
for (const name of Object.keys(index)) {
    const fx = name.match(/^FX(\d+)_/)[1];
    console.assert(JSON.stringify(shards[fx][name]) === JSON.stringify(index[name]),
        `round-trip failed for ${name}`);
}

console.log(`Wrote ${Object.keys(shards).length} shards (${total} entries) to ${OUT_DIR}`);
