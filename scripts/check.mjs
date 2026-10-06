import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = join(root, 'dist');
const requiredFiles = [
  'manifest.json',
  'background.js',
  'assets/logo.svg',
  'assets/logo-mono.png',
  'assets/icons/icon-16.png',
  'assets/icons/icon-32.png',
  'assets/icons/icon-48.png',
  'assets/icons/icon-128.png',
  'assets/icons/icon-disabled-16.png',
  'assets/icons/icon-disabled-32.png',
  'assets/icons/icon-disabled-48.png',
  'assets/icons/icon-disabled-128.png',
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
const interfaceText = `${popupMarkup}\n${panelMarkup}`;
if (/Local OCR|processed (?:locally |)on this device|শুধু বাংলা|English only/i.test(interfaceText)) {
  throw new Error('Outdated interface wording is still present.');
}
if (!interfaceText.includes('OCR may make mistakes. Review the result before using it.')) {
  throw new Error('The OCR accuracy reminder is missing.');
}
if (!popupMarkup.includes('href="https://shakilsheikh.com/"')
  || !popupMarkup.includes('© 2026')
  || !popupMarkup.includes('All rights reserved.')
  || popupMarkup.includes('OCR may make mistakes. Review the result before using it.')
  || panelMarkup.includes('© 2026')
  || !panelMarkup.includes('OCR may make mistakes. Review the result before using it.')) {
  throw new Error('Popup copyright or result-panel accuracy reminder is missing.');
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
if (!popupImplementation.includes('chrome.storage.local.get(LANGUAGE_SETTING_KEY)')
  || !popupImplementation.includes('chrome.storage.local.set({ [LANGUAGE_SETTING_KEY]')) {
  throw new Error('Persistent recognition-language selection is missing.');
}
if (!popupMarkup.includes('id="language-select"')
  || !popupMarkup.includes('id="extension-enabled"')
  || !popupMarkup.includes('id="image-upload-dialog"')
  || !popupImplementation.includes('elements.uploadDialog.showModal()')) {
  throw new Error('Extension switch, scalable language selector, or focused image-OCR dialog is missing.');
}
if (popupMarkup.includes('class="upload-launch-next"')
  || /<div class="select-control">[\s\S]*?<\/select>\s*<svg/.test(popupMarkup)) {
  throw new Error('Legacy upload or select arrows are still present.');
}
const backgroundImplementation = await readFile(join(distRoot, 'background.js'), 'utf8');
if (!backgroundImplementation.includes('chrome.action.setIcon')
  || !backgroundImplementation.includes('icon-disabled-128.png')
  || !backgroundImplementation.includes('BanglaSnap OCR is paused')) {
  throw new Error('Persistent pause state or disabled toolbar branding is missing.');
}
if (!popupImplementation.includes("const EXTENSION_ENABLED_KEY = 'extensionEnabled'")
  || !popupImplementation.includes('chrome.storage.local.set({ [EXTENSION_ENABLED_KEY]: enabled })')
  || !popupImplementation.includes('chrome.action.setIcon')) {
  throw new Error('Persistent enabled state is missing from the popup.');
}
if (!panelMarkup.includes('class="preview-viewport"')) {
  throw new Error('Aspect-fit selected-area preview is missing.');
}
if (!panelImplementation.includes('blocks: true')
  || !panelImplementation.includes('extractReliableOcrLines')
  || !panelImplementation.includes('combinePageAndImageText')
  || !panelImplementation.includes('cleanOcrArtifacts')
  || !panelImplementation.includes("if (/^\\d+$/.test(compact)) return false")) {
  throw new Error('Confidence-filtered OCR output is missing.');
}
if (!panelImplementation.includes("postAction('drag-start'")
  || !panelImplementation.includes('copyParagraphButton')
  || !panelImplementation.includes('copyLinesButton')
  || !panelImplementation.includes("label: 'Copied'")) {
  throw new Error('Movable panel and copy-format controls are missing.');
}
if (panelMarkup.includes('class="copy-feedback"') || !panelMarkup.includes('class="success-icon"')) {
  throw new Error('Inline animated copy feedback is missing.');
}
const selectorImplementation = await readFile(join(distRoot, 'content/area-selector.js'), 'utf8');
if (!selectorImplementation.includes("event.data.action === 'drag-move'")
  || !selectorImplementation.includes("event.data.action === 'resize-panel'")
  || !selectorImplementation.includes("height: min(640px")) {
  throw new Error('Movable compact result-panel host is missing.');
}

for (const file of ['tesseract.min.js', 'worker.min.js']) {
  const bundle = await readFile(join(distRoot, 'vendor/tesseract', file), 'utf8');
  if (/\beval\s*\(|new Function\s*\(|\bFunction\s*\(\s*["']/.test(bundle)) {
    throw new Error(`Dynamic code construction found in ${file}.`);
  }
}

console.log(`Checks passed: MV${manifest.manifest_version}, minimal capture permissions, local OCR assets present.`);
