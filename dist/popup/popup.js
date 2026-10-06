/* global Tesseract */

const elements = {
  extensionEnabled: document.querySelector('#extension-enabled'),
  brandLogo: document.querySelector('#brand-logo'),
  brandSubtitle: document.querySelector('#brand-subtitle'),
  captureButton: document.querySelector('#capture-button'),
  languageSelect: document.querySelector('#language-select'),
  uploadDialog: document.querySelector('#image-upload-dialog'),
  openUploadButton: document.querySelector('#open-upload-button'),
  closeUploadButton: document.querySelector('#close-upload-button'),
  imageInput: document.querySelector('#image-input'),
  filePicker: document.querySelector('.file-picker'),
  imageSummary: document.querySelector('#image-summary'),
  imagePreview: document.querySelector('#image-preview'),
  imageName: document.querySelector('#image-name'),
  imageSize: document.querySelector('#image-size'),
  changeButton: document.querySelector('#change-button'),
  clearButton: document.querySelector('#clear-button'),
  runButton: document.querySelector('#run-button'),
  progressSection: document.querySelector('#progress-section'),
  progressLabel: document.querySelector('#progress-label'),
  progressPercent: document.querySelector('#progress-percent'),
  progressBar: document.querySelector('#progress-bar'),
  errorMessage: document.querySelector('#error-message'),
  uploadErrorMessage: document.querySelector('#upload-error-message'),
  resultSection: document.querySelector('#result-section'),
  resultText: document.querySelector('#result-text'),
  confidenceLabel: document.querySelector('#confidence-label'),
  copyButton: document.querySelector('#copy-button'),
  copyStatus: document.querySelector('#copy-status'),
};

const STATUS_LABELS = {
  'loading tesseract core': 'Loading OCR engine…',
  'initializing tesseract': 'Initializing OCR engine…',
  'loading language traineddata': 'Loading language model…',
  'initializing api': 'Preparing recognition…',
  'recognizing text': 'Recognizing text…',
};

let selectedFile = null;
let previewUrl = null;
let worker = null;
let workerLanguage = null;
let languageInteracted = false;
let extensionEnabled = true;

const LANGUAGE_SETTING_KEY = 'recognitionLanguage';
const EXTENSION_ENABLED_KEY = 'extensionEnabled';
const SUPPORTED_LANGUAGES = new Set(['ben+eng', 'ben', 'eng']);
const ACTIVE_ICONS = {
  16: 'assets/icons/icon-16.png',
  32: 'assets/icons/icon-32.png',
  48: 'assets/icons/icon-48.png',
  128: 'assets/icons/icon-128.png',
};
const DISABLED_ICONS = {
  16: 'assets/icons/icon-disabled-16.png',
  32: 'assets/icons/icon-disabled-32.png',
  48: 'assets/icons/icon-disabled-48.png',
  128: 'assets/icons/icon-disabled-128.png',
};

function syncActionAppearance(enabled) {
  Promise.all([
    chrome.action.setIcon({ path: enabled ? ACTIVE_ICONS : DISABLED_ICONS }),
    chrome.action.setTitle({ title: enabled ? 'BanglaSnap OCR' : 'BanglaSnap OCR — Paused' }),
  ]).catch((error) => {
    console.warn('BanglaSnap could not update its toolbar icon:', error);
  });
}

function applyEnabledState(enabled) {
  extensionEnabled = enabled;
  elements.extensionEnabled.checked = enabled;
  document.body.classList.toggle('extension-disabled', !enabled);
  elements.brandLogo.src = enabled ? '../assets/logo.svg' : '../assets/logo-mono.png';
  elements.brandSubtitle.textContent = enabled ? 'Bangla & English OCR for Chrome' : 'OCR is paused';
  elements.captureButton.disabled = !enabled;
  elements.languageSelect.disabled = !enabled;
  elements.openUploadButton.disabled = !enabled;
  elements.runButton.disabled = !enabled || !selectedFile;
  syncActionAppearance(enabled);

  if (!enabled && elements.uploadDialog.open) elements.uploadDialog.close();
}

async function restoreEnabledState() {
  try {
    const stored = await chrome.storage.local.get({ [EXTENSION_ENABLED_KEY]: true });
    applyEnabledState(stored[EXTENSION_ENABLED_KEY] !== false);
  } catch (error) {
    console.warn('BanglaSnap could not restore its enabled state:', error);
    applyEnabledState(true);
  }
}

async function saveEnabledState(event) {
  const enabled = event.target.checked;
  applyEnabledState(enabled);
  clearMessages();

  chrome.storage.local.set({ [EXTENSION_ENABLED_KEY]: enabled }).catch((error) => {
    console.warn('BanglaSnap could not save its enabled state:', error);
  });

  if (!enabled && worker) {
    await worker.terminate().catch(() => {});
    worker = null;
    workerLanguage = null;
  }
}

function getSelectedLanguage() {
  return elements.languageSelect.value;
}

async function restoreLanguagePreference() {
  try {
    const stored = await chrome.storage.local.get(LANGUAGE_SETTING_KEY);
    const language = stored[LANGUAGE_SETTING_KEY];
    if (languageInteracted || !SUPPORTED_LANGUAGES.has(language)) return;
    elements.languageSelect.value = language;
  } catch (error) {
    console.warn('BanglaSnap could not restore the language preference:', error);
  }
}

function saveLanguagePreference(event) {
  languageInteracted = true;
  chrome.storage.local.set({ [LANGUAGE_SETTING_KEY]: event.target.value }).catch((error) => {
    console.warn('BanglaSnap could not save the language preference:', error);
  });
}

async function startAreaSelection() {
  if (!extensionEnabled) return;
  clearMessages();
  elements.captureButton.disabled = true;
  elements.captureButton.textContent = 'Starting selection…';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active webpage was found.');

    const response = await chrome.runtime.sendMessage({
      type: 'BEGIN_SELECTION',
      tabId: tab.id,
      language: getSelectedLanguage(),
    });

    if (!response?.ok) throw new Error(response?.error || 'Selection mode could not start.');
    window.close();
  } catch (error) {
    console.error('BanglaSnap selection failed:', error);
    const isRestrictedPage = /Cannot access|chrome:\/\/|extensions gallery/i.test(error.message);
    showError(isRestrictedPage
      ? 'Chrome blocks area overlays on this built-in page or PDF viewer. Use a screenshot with Image Upload, or open a regular webpage.'
      : `Could not start area selection: ${error.message}`);
    elements.captureButton.disabled = !extensionEnabled;
    elements.captureButton.textContent = 'Select Area on Page';
  }
}

function getLanguageArgument(value) {
  return value.includes('+') ? value.split('+') : value;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setProgress(label, percent) {
  const safePercent = Math.min(100, Math.max(0, Math.round(percent)));
  elements.progressLabel.textContent = label;
  elements.progressPercent.textContent = `${safePercent}%`;
  elements.progressBar.value = safePercent;
  elements.progressBar.textContent = `${safePercent}%`;
}

function handleProgress(message) {
  const label = STATUS_LABELS[message.status] || 'Processing image…';
  setProgress(label, (message.progress || 0) * 100);
}

function showError(message) {
  const target = elements.uploadDialog.open ? elements.uploadErrorMessage : elements.errorMessage;
  target.textContent = message;
  target.hidden = false;
}

function clearMessages() {
  for (const message of [elements.errorMessage, elements.uploadErrorMessage]) {
    message.hidden = true;
    message.textContent = '';
  }
  elements.copyStatus.textContent = '';
}

function resetResult() {
  elements.resultSection.hidden = true;
  elements.resultText.value = '';
  elements.confidenceLabel.textContent = '';
}

function resetSelectedImage() {
  selectedFile = null;
  elements.imageInput.value = '';
  elements.filePicker.hidden = false;
  elements.imageSummary.hidden = true;
  elements.clearButton.hidden = true;
  elements.runButton.disabled = true;
  elements.imagePreview.removeAttribute('src');
  elements.imageName.textContent = '';
  elements.imageSize.textContent = '';
  elements.progressSection.hidden = true;
  clearMessages();
  resetResult();

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
}

function selectImage(file) {
  if (!extensionEnabled) return;
  clearMessages();
  resetResult();

  if (!file || !file.type.startsWith('image/')) {
    resetSelectedImage();
    showError('Please choose a supported image file.');
    return;
  }

  selectedFile = file;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  elements.imagePreview.src = previewUrl;
  elements.imageName.textContent = file.name;
  elements.imageSize.textContent = formatFileSize(file.size);
  elements.filePicker.hidden = true;
  elements.imageSummary.hidden = false;
  elements.clearButton.hidden = false;
  elements.runButton.disabled = !extensionEnabled;
}

async function getWorker(language) {
  if (!worker) {
    worker = await Tesseract.createWorker(
      getLanguageArgument(language),
      Tesseract.OEM.LSTM_ONLY,
      {
        workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
        corePath: chrome.runtime.getURL('vendor/tesseract-core'),
        langPath: chrome.runtime.getURL('tessdata'),
        workerBlobURL: false,
        gzip: true,
        logger: handleProgress,
      },
    );
    workerLanguage = language;
    return worker;
  }

  if (workerLanguage !== language) {
    setProgress('Switching language model…', 0);
    await worker.reinitialize(getLanguageArgument(language), Tesseract.OEM.LSTM_ONLY);
    workerLanguage = language;
  }

  return worker;
}

async function runOcr() {
  if (!extensionEnabled || !selectedFile) return;

  const language = getSelectedLanguage();
  clearMessages();
  resetResult();
  elements.progressSection.hidden = false;
  elements.runButton.disabled = true;
  setProgress('Preparing OCR…', 0);

  try {
    const activeWorker = await getWorker(language);
    setProgress('Recognizing text…', 0);
    const result = await activeWorker.recognize(selectedFile);
    const text = result.data.text.replace(/[ \t]+\n/g, '\n').trim();

    setProgress('Complete', 100);
    elements.resultText.value = text;
    elements.confidenceLabel.textContent = Number.isFinite(result.data.confidence)
      ? `${Math.round(result.data.confidence)}% confidence`
      : '';
    elements.resultSection.hidden = false;

    if (!text) {
      showError('OCR completed, but no text was detected. Try a clearer or larger image.');
    }
  } catch (error) {
    console.error('BanglaSnap OCR failed:', error);
    elements.progressSection.hidden = true;
    showError('OCR could not process this image. Try a clear PNG or JPEG, then run OCR again.');

    if (worker) {
      await worker.terminate().catch(() => {});
      worker = null;
      workerLanguage = null;
    }
  } finally {
    elements.runButton.disabled = !extensionEnabled || !selectedFile;
  }
}

async function copyResult() {
  const text = elements.resultText.value;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    elements.copyStatus.textContent = 'Copied';
  } catch (error) {
    elements.resultText.focus();
    elements.resultText.select();
    elements.copyStatus.textContent = 'Select the text and press Ctrl/Cmd+C';
  }
}

elements.imageInput.addEventListener('change', (event) => {
  selectImage(event.target.files[0]);
});
elements.captureButton.addEventListener('click', startAreaSelection);
elements.changeButton.addEventListener('click', () => elements.imageInput.click());
elements.clearButton.addEventListener('click', resetSelectedImage);
elements.runButton.addEventListener('click', runOcr);
elements.copyButton.addEventListener('click', copyResult);
elements.languageSelect.addEventListener('change', saveLanguagePreference);
elements.extensionEnabled.addEventListener('change', saveEnabledState);
elements.openUploadButton.addEventListener('click', () => elements.uploadDialog.showModal());
elements.closeUploadButton.addEventListener('click', () => elements.uploadDialog.close());
elements.uploadDialog.addEventListener('click', (event) => {
  if (event.target === elements.uploadDialog) elements.uploadDialog.close();
});
Promise.all([restoreLanguagePreference(), restoreEnabledState()]);

window.addEventListener('unload', () => {
  if (worker) worker.terminate();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
});
