import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = join(root, 'dist');
const requiredFiles = [
  'manifest.json',
  'background.js',
  'assets/logo.svg',
  'assets/icons/icon-16.png',
  'assets/icons/icon-32.png',
  'assets/icons/icon-48.png',
  'assets/icons/icon-128.png',
  'content/area-selector.js',
  'popup/popup.html',
  'popup/popup.css',
  'popup/popup.js',
  'panel/panel.html',
  'panel/panel.css',
  'panel/panel.js',
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract-core/tesseract-core-lstm.wasm.js',
  'vendor/tesseract-core/tesseract-core-lstm.wasm',
  'vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract-core/tesseract-core-simd-lstm.wasm',
  'vendor/tesseract-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'vendor/tesseract-core/tesseract-core-relaxedsimd-lstm.wasm',
  'tessdata/ben.traineddata.gz',
  'tessdata/eng.traineddata.gz',
];

for (const file of requiredFiles) await access(join(distRoot, file));

const manifest = JSON.parse(await readFile(join(distRoot, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3.');
const expectedPermissions = ['activeTab', 'scripting', 'storage'];
if (JSON.stringify(manifest.permissions?.sort()) !== JSON.stringify(expectedPermissions.sort())) {
  throw new Error('Only activeTab, scripting, and storage permissions should be requested.');
}
if (!manifest.background?.service_worker) throw new Error('Capture service worker is missing.');
if (!manifest.icons?.['128'] || !manifest.action?.default_icon?.['32']) {
  throw new Error('Extension branding icons are missing from the manifest.');
}
const popupMarkup = await readFile(join(distRoot, 'popup/popup.html'), 'utf8');
const panelMarkup = await readFile(join(distRoot, 'panel/panel.html'), 'utf8');
if (!popupMarkup.includes('../assets/logo.svg') || !panelMarkup.includes('../assets/logo.svg')) {
  throw new Error('The SVG brand logo is missing from the extension interface.');
}
if (!manifest.content_security_policy.extension_pages.includes("'wasm-unsafe-eval'")) {
  throw new Error('The extension CSP must allow packaged WebAssembly.');
}

for (const file of ['background.js', 'content/area-selector.js', 'popup/popup.js', 'panel/panel.js']) {
  const implementation = await readFile(join(distRoot, file), 'utf8');
  if (/https?:\/\//.test(implementation)) throw new Error(`Remote URL found in ${file}.`);
}
const popupImplementation = await readFile(join(distRoot, 'popup/popup.js'), 'utf8');
const panelImplementation = await readFile(join(distRoot, 'panel/panel.js'), 'utf8');
if (!popupImplementation.includes('workerBlobURL: false') || !panelImplementation.includes('workerBlobURL: false')) {
  throw new Error('MV3-safe direct worker mode is missing.');
}
if (!panelImplementation.includes('blocks: true')
  || !panelImplementation.includes('extractReliableOcrLines')
  || !panelImplementation.includes('combinePageAndImageText')
  || !panelImplementation.includes('cleanOcrArtifacts')
  || !panelImplementation.includes("if (/^\\d+$/.test(compact)) return false")) {
  throw new Error('Confidence-filtered OCR output is missing.');
}

for (const file of ['tesseract.min.js', 'worker.min.js']) {
  const bundle = await readFile(join(distRoot, 'vendor/tesseract', file), 'utf8');
  if (/\beval\s*\(|new Function\s*\(|\bFunction\s*\(\s*["']/.test(bundle)) {
    throw new Error(`Dynamic code construction found in ${file}.`);
  }
}

console.log(`Checks passed: MV${manifest.manifest_version}, minimal capture permissions, local OCR assets present.`);
