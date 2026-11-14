// Downloads Magenta's Groove MIDI Dataset (MIDI only, ~3 MB, CC BY 4.0) into packs-src/.
// https://magenta.tensorflow.org/datasets/groove
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'packs-src');
fs.mkdirSync(dir, { recursive: true });
const url = 'https://storage.googleapis.com/magentadata/datasets/groove/groove-v1.0.0-midionly.zip';
const res = await fetch(url);
if (!res.ok) { console.log(`download failed: HTTP ${res.status}`); process.exit(1); }
const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(path.join(dir, 'groove-v1.0.0-midionly.zip'), buf);
console.log(`saved ${buf.length} bytes to packs-src/groove-v1.0.0-midionly.zip`);
