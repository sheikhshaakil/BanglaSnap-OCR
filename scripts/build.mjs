import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = join(root, 'dist');

const copies = [
  ['manifest.json', 'manifest.json'],
  ['background.js', 'background.js'],
  ['assets', 'assets'],
  ['content', 'content'],
  ['popup', 'popup'],
  ['panel', 'panel'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
  ['node_modules/tesseract.js/dist/tesseract.min.js', 'vendor/tesseract/tesseract.min.js'],
  ['node_modules/tesseract.js/dist/tesseract.min.js.LICENSE.txt', 'vendor/tesseract/tesseract.min.js.LICENSE.txt'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'vendor/tesseract/worker.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt', 'vendor/tesseract/worker.min.js.LICENSE.txt'],
  ['node_modules/tesseract.js-core/LICENSE', 'vendor/tesseract-core/LICENSE'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'vendor/tesseract-core/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'vendor/tesseract-core/tesseract-core-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'vendor/tesseract-core/tesseract-core-simd-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'vendor/tesseract-core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm', 'vendor/tesseract-core/tesseract-core-relaxedsimd-lstm.wasm'],
  ['node_modules/@tesseract.js-data/ben/4.0.0_best_int/ben.traineddata.gz', 'tessdata/ben.traineddata.gz'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tessdata/eng.traineddata.gz'],
];

await rm(distRoot, { recursive: true, force: true });
// Clean generated root-level assets created by the earliest prototype build.
await rm(join(root, 'vendor'), { recursive: true, force: true });
await rm(join(root, 'tessdata'), { recursive: true, force: true });

for (const [source, destination] of copies) {
  const target = join(distRoot, destination);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, source), target, { recursive: true });
}

// Tesseract's UMD bundles retain legacy fallbacks for browsers without globalThis.
// Chrome MV3 has globalThis, so remove the unreachable Function-constructor paths.
for (const file of ['tesseract.min.js', 'worker.min.js']) {
  const path = join(distRoot, 'vendor/tesseract', file);
  const original = await readFile(path, 'utf8');
  const hardened = original
    .replace(/Function\("r","regeneratorRuntime = r"\)\(([a-z])\)/g, 'globalThis.regeneratorRuntime=$1')
    .replace('this||new Function("return this")()', 'this||globalThis');
  await writeFile(path, hardened);
}

console.log(`Bundled ${copies.length} local OCR assets.`);
