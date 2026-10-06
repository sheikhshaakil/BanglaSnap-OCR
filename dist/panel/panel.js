/* global Tesseract */

const LANGUAGE_LABELS = {
  'ben+eng': 'বাংলা + English',
  ben: 'বাংলা',
  eng: 'English',
};
const STATUS_LABELS = {
  'loading tesseract core': 'Loading OCR engine…',
  'initializing tesseract': 'Initializing OCR engine…',
  'loading language traineddata': 'Loading language model…',
  'initializing api': 'Preparing recognition…',
  'recognizing text': 'Recognizing selected area…',
};

const elements = {
  languageLabel: document.querySelector('#language-label'),
  preview: document.querySelector('#capture-preview'),
  progressSection: document.querySelector('#progress-section'),
  progressLabel: document.querySelector('#progress-label'),
  progressPercent: document.querySelector('#progress-percent'),
  progressBar: document.querySelector('#progress-bar'),
  errorMessage: document.querySelector('#error-message'),
  textSection: document.querySelector('#text-section'),
  resultText: document.querySelector('#result-text'),
  confidenceLabel: document.querySelector('#confidence-label'),
  filterSummary: document.querySelector('#filter-summary'),
  filterMessage: document.querySelector('#filter-message'),
  toggleRawButton: document.querySelector('#toggle-raw-button'),
  copyParagraphButton: document.querySelector('#copy-paragraph-button'),
  copyLinesButton: document.querySelector('#copy-lines-button'),
  scanAnotherButton: document.querySelector('#scan-another-button'),
  closeButton: document.querySelector('#close-button'),
  copyStatus: document.querySelector('#copy-status'),
  panelHeader: document.querySelector('#panel-header'),
};

const parameters = new URLSearchParams(location.search);
const language = parameters.get('language') || 'ben+eng';
const selectionSize = {
  width: Number(parameters.get('width')) || 1,
  height: Number(parameters.get('height')) || 1,
};
const domLines = parseDomLines(parameters.get('domLines'));
let captureBlob = null;
let captureUrl = null;
let worker = null;
let filteredText = '';
let rawText = '';
let showingRawText = false;
let currentOcrPass = 0;
let copyStatusTimer = null;
let dragPointerId = null;
let panelFitFrame = null;
const totalOcrPasses = language === 'ben+eng' ? 5 : 3;

function setProgress(label, progress) {
  const percent = Math.min(100, Math.max(0, Math.round(progress)));
  elements.progressLabel.textContent = label;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressBar.value = percent;
  elements.progressBar.textContent = `${percent}%`;
}

function handleProgress(message) {
  const label = message.status === 'recognizing text' && currentOcrPass
    ? `Reading image text — pass ${currentOcrPass} of ${totalOcrPasses}…`
    : STATUS_LABELS[message.status] || 'Processing selected area…';
  setProgress(label, (message.progress || 0) * 100);
}

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = false;
  requestPanelFit();
}

function postAction(action, details = {}) {
  window.parent.postMessage({ source: 'banglasnap-panel', action, language, ...details }, '*');
}

function requestPanelFit() {
  cancelAnimationFrame(panelFitFrame);
  panelFitFrame = requestAnimationFrame(() => {
    const footer = document.querySelector('footer');
    if (!footer) return;
    postAction('resize-panel', { height: footer.getBoundingClientRect().bottom + 16 });
  });
}

async function loadAndCropCapture() {
  const captureId = parameters.get('capture');
  if (!captureId) throw new Error('The captured image is missing. Please scan another area.');

  const response = await chrome.runtime.sendMessage({ type: 'GET_CAPTURE', captureId });
  if (!response?.ok || !response.dataUrl) {
    throw new Error(response?.error || 'The captured image expired. Please scan another area.');
  }
  const rect = {
    left: Number(parameters.get('left')),
    top: Number(parameters.get('top')),
    width: Number(parameters.get('width')),
    height: Number(parameters.get('height')),
  };
  const viewport = {
    width: Number(parameters.get('viewportWidth')),
    height: Number(parameters.get('viewportHeight')),
  };
  captureBlob = await cropScreenshot(response.dataUrl, rect, viewport);
  captureUrl = URL.createObjectURL(captureBlob);
  elements.preview.src = captureUrl;
}

async function cropScreenshot(screenshotUrl, rect, viewport) {
  if (!viewport.width || !viewport.height || !rect.width || !rect.height) {
    throw new Error('The selection coordinates are invalid. Please scan another area.');
  }

  const image = new Image();
  image.src = screenshotUrl;
  await image.decode();
  const scaleX = image.naturalWidth / viewport.width;
  const scaleY = image.naturalHeight / viewport.height;
  const sourceX = Math.max(0, Math.round(rect.left * scaleX));
  const sourceY = Math.max(0, Math.round(rect.top * scaleY));
  const sourceWidth = Math.min(image.naturalWidth - sourceX, Math.max(1, Math.round(rect.width * scaleX)));
  const sourceHeight = Math.min(image.naturalHeight - sourceY, Math.max(1, Math.round(rect.height * scaleY)));
  const canvas = document.createElement('canvas');
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  canvas.getContext('2d', { alpha: false }).drawImage(
    image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight,
  );
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare the selected image.')), 'image/png');
  });
}

async function runOcr() {
  const activeWorker = await Tesseract.createWorker(
    language.includes('+') ? language.split('+') : language,
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
  worker = activeWorker;
  await activeWorker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
    preserve_interword_spaces: '1',
  });

  const variants = await prepareImageVariants(captureBlob);
  currentOcrPass = 1;
  const colorResult = await activeWorker.recognize(variants.color, {}, { text: true, blocks: true });
  currentOcrPass = 2;
  await activeWorker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO });
  const contrastResult = await activeWorker.recognize(variants.contrast, {}, { text: true, blocks: true });
  currentOcrPass = 3;
  await activeWorker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
  const invertedResult = await activeWorker.recognize(variants.inverted, {}, { text: true, blocks: true });
  const supplementalResults = [];
  if (language === 'ben+eng') {
    // Keep the bilingual results, then give small Bengali labels and isolated
    // alphabet tiles dedicated passes without competition from English.
    await activeWorker.reinitialize('ben', Tesseract.OEM.LSTM_ONLY);
    await activeWorker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
    for (const image of [variants.color, variants.inverted]) {
      currentOcrPass = 4 + supplementalResults.length;
      supplementalResults.push(await activeWorker.recognize(image, {}, { text: true, blocks: true }));
    }
  }
  currentOcrPass = 0;

  const colorLines = extractReliableOcrLines(colorResult.data.blocks, variants.width, variants.height);
  const contrastLines = extractReliableOcrLines(contrastResult.data.blocks, variants.width, variants.height);
  const invertedLines = extractReliableOcrLines(invertedResult.data.blocks, variants.width, variants.height);
  const supplementalLines = supplementalResults.map((result) => extractReliableOcrLines(result.data.blocks, variants.width, variants.height));
  const candidates = [colorLines, contrastLines, invertedLines, ...supplementalLines].flatMap((result, pass) => result.kept
    .filter((line) => pass < 3 || hasBanglaLetter(line.text))
    .map((line) => ({ ...line, pass })));
  const combined = combinePageAndImageText(candidates);
  filteredText = combined.text;
  rawText = buildRawText([...new Set([colorResult, contrastResult, invertedResult, ...supplementalResults].map((result) => result.data.text))].join('\n\n'), domLines);
  showingRawText = false;
  setProgress('Complete', 100);
  elements.resultText.value = filteredText;
  elements.confidenceLabel.textContent = domLines.length
    ? 'Exact page text + OCR'
    : Number.isFinite(combined.confidence) ? `${Math.round(combined.confidence)}% OCR confidence` : '';
  elements.textSection.hidden = false;
  setCopyButtonsDisabled(!filteredText);

  const removedCount = colorLines.removedCount + contrastLines.removedCount + invertedLines.removedCount + supplementalLines.reduce((sum, result) => sum + result.removedCount, 0) + combined.duplicateCount;
  if (removedCount > 0 || domLines.length) {
    const messages = [];
    if (domLines.length) messages.push('Used exact webpage text where available.');
    if (removedCount > 0) messages.push(`${removedCount} uncertain or duplicate ${removedCount === 1 ? 'line was' : 'lines were'} ignored.`);
    elements.filterMessage.textContent = messages.join(' ');
    elements.toggleRawButton.textContent = 'Show all detections';
    elements.filterSummary.hidden = false;
  } else {
    elements.filterSummary.hidden = true;
  }

  if (!filteredText) {
    showError(rawText
      ? 'Only uncertain shapes were detected, so they were hidden. Select a tighter area around clear text or show all detections.'
      : 'No reliable text was detected. Try scanning a tighter area around larger, clearer text.');
  }
  requestPanelFit();
}

async function prepareImageVariants(blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();

    const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = longestSide < 1400 ? Math.min(2, 1400 / longestSide) : 1;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);

    const color = await canvasToBlob(canvas);
    const pixels = context.getImageData(0, 0, width, height);
    const histogram = new Uint32Array(256);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const luminance = Math.round(
        pixels.data[index] * 0.2126
        + pixels.data[index + 1] * 0.7152
        + pixels.data[index + 2] * 0.0722,
      );
      histogram[luminance] += 1;
    }

    const low = percentileFromHistogram(histogram, width * height, 0.02);
    const high = percentileFromHistogram(histogram, width * height, 0.98);
    const range = Math.max(32, high - low);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const luminance = Math.round(
        pixels.data[index] * 0.2126
        + pixels.data[index + 1] * 0.7152
        + pixels.data[index + 2] * 0.0722,
      );
      const normalized = Math.max(0, Math.min(255, Math.round(((luminance - low) * 255) / range)));
      pixels.data[index] = normalized;
      pixels.data[index + 1] = normalized;
      pixels.data[index + 2] = normalized;
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);

    const contrast = await canvasToBlob(canvas);
    for (let index = 0; index < pixels.data.length; index += 4) {
      pixels.data[index] = 255 - pixels.data[index];
      pixels.data[index + 1] = 255 - pixels.data[index + 1];
      pixels.data[index + 2] = 255 - pixels.data[index + 2];
    }
    context.putImageData(pixels, 0, 0);
    const inverted = await canvasToBlob(canvas);
    return { color, contrast, inverted, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((processed) => processed
      ? resolve(processed)
      : reject(new Error('Could not prepare the image for OCR.')), 'image/png');
  });
}

function percentileFromHistogram(histogram, total, percentile) {
  const target = total * percentile;
  let count = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    count += histogram[value];
    if (count >= target) return value;
  }
  return 255;
}

function extractReliableOcrLines(blocks, imageWidth, imageHeight) {
  const lines = [];
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        // Large gaps commonly separate a text label from a bell, avatar or
        // other control. Validate each spatial group independently.
        for (const group of splitOcrLine(line)) {
          const candidate = cleanOcrLine(group, imageWidth, imageHeight);
          if (candidate) lines.push(candidate);
        }
      }
    }
  }

  const kept = lines.filter(isReliableLine);
  return {
    kept,
    removedCount: Math.max(0, lines.length - kept.length),
  };
}

function splitOcrLine(line) {
  if (!line.words?.length) return [line];
  const groups = [];
  for (const word of line.words) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    const height = Math.max(1, word.bbox.y1 - word.bbox.y0, previous ? previous.bbox.y1 - previous.bbox.y0 : 0);
    if (!previous || word.bbox.x0 - previous.bbox.x1 > height * 1.6) groups.push([word]);
    else group.push(word);
  }
  return groups.map((words) => ({
    words, text: words.map((word) => word.text).join(' '),
    confidence: words.reduce((sum, word) => sum + word.confidence, 0) / words.length,
    bbox: { x0: Math.min(...words.map((word) => word.bbox.x0)), x1: Math.max(...words.map((word) => word.bbox.x1)), y0: Math.min(...words.map((word) => word.bbox.y0)), y1: Math.max(...words.map((word) => word.bbox.y1)) },
  }));
}

function cleanOcrLine(line, imageWidth, imageHeight) {
  const originalWords = (line.words || []).map((word) => ({
    text: cleanText(word.text),
    confidence: Number(word.confidence) || 0,
  })).filter((word) => word.text);
  const words = originalWords.filter((word, index) => {
    if (isReliableWord(word)) return true;
    // Keep punctuation and single digits when they belong to a real phrase.
    // A blanket single-character filter erased '&' and the 6 in 'GTA 6'.
    const hasTextNeighbor = [originalWords[index - 1], originalWords[index + 1]]
      .some((neighbor) => neighbor && /\p{L}{2}/u.test(neighbor.text) && isReliableWord(neighbor));
    return hasTextNeighbor && word.confidence >= 75 && /^[&+%|\d\u09E6-\u09EF]$/u.test(word.text);
  });
  // If Tesseract supplied word data but every word failed validation, the line
  // is noise. Falling back to line.text here would re-introduce rejected shapes
  // such as spaced digits detected in buildings, cars, and interface icons.
  if (originalWords.length && !words.length) return null;
  const text = cleanOcrArtifacts(cleanText(
    words.length ? words.map((word) => word.text).join(' ') : line.text,
  ));
  if (!text) return null;
  const confidence = words.length
    ? words.reduce((total, word) => total + word.confidence, 0) / words.length
    : Number(line.confidence) || 0;
  return {
    text,
    confidence,
    top: Math.max(0, line.bbox.y0 / imageHeight),
    bottom: Math.min(1, line.bbox.y1 / imageHeight),
    left: Math.max(0, line.bbox.x0 / imageWidth),
    right: Math.min(1, line.bbox.x1 / imageWidth),
  };
}

function isReliableWord(word) {
  // Mixed numeral scripts in a short token are usually an icon, not a word.
  if (/[0-9]/.test(word.text) && /[\u09E6-\u09EF]/.test(word.text)) return false;
  const characters = word.text.match(/[A-Za-z0-9\u0980-\u09FF]/g) || [];
  if (!characters.length) return false;
  const containsBangla = hasBanglaLetter(word.text);
  if (characters.length === 1) {
    if (containsBangla) return word.confidence >= 78;
    if (/^[AI]$/.test(word.text)) return word.confidence >= 88;
    return false;
  }
  if (characters.length === 2 && /^[a-z]+$/.test(word.text)) {
    const commonShortWords = new Set(['an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'vs', 'we']);
    if (!commonShortWords.has(word.text.toLowerCase())) return word.confidence >= 93;
  }
  return word.confidence >= (containsBangla ? 48 : 58);
}

function isReliableLine(line) {
  const compact = line.text.replace(/\s/g, '');
  const meaningfulCharacters = compact.match(/[A-Za-z0-9\u0980-\u09FF]/g)?.length || 0;
  const containsBangla = hasBanglaLetter(line.text);
  const minimumConfidence = containsBangla ? 50 : 58;
  const tokens = line.text.split(/\s+/).filter(Boolean);
  const singleCharacterTokens = tokens.filter((token) => (
    (token.match(/[A-Za-z0-9\u0980-\u09FF]/g)?.length || 0) <= 1
  )).length;
  const singleTokenRatio = tokens.length ? singleCharacterTokens / tokens.length : 1;

  // Bengali words and alphabet tiles can be one letter plus combining marks.
  // Keep them as candidates; the merger still requires confidence/agreement.
  if (meaningfulCharacters <= 3 && !containsBangla) return false;
  // A standalone number row from an image is overwhelmingly likely to be
  // texture/control noise. Meaningful page counts are retained through the
  // exact DOM-text path, while times embedded beside real words remain valid.
  if (/^\d+$/.test(compact)) return false;
  if (tokens.length >= 4 && singleTokenRatio >= 0.6 && line.confidence < 85) return false;
  return line.confidence >= minimumConfidence;
}

function hasBanglaLetter(text) {
  return [...text].some((character) => /\p{Script=Bengali}/u.test(character) && /\p{L}/u.test(character));
}

function isBanglaText(text) {
  return hasBanglaLetter(text) && /^[\p{Script=Bengali}\p{M}\s.,!?।]+$/u.test(text);
}

function cleanOcrArtifacts(text) {
  return text
    // Video players often paint the current/total time over the thumbnail.
    // It belongs to the controls, not to the title following it.
    .replace(/^\s*\d{1,2}:\d{2}\s*[\/|]\s*\d{1,2}:\d{2}\s*/u, '')
    // Remove a leading run of isolated OCR digits when a real phrase follows.
    .replace(/^(?:\d\s+){2,}(?=[A-Za-z\u0980-\u09FF])/u, '')
    .trim();
}

function combinePageAndImageText(ocrLines) {
  const uniqueOcr = [];
  let duplicateCount = 0;
  for (const candidate of ocrLines.sort((a, b) => b.confidence - a.confidence)) {
    const corroborated = ocrLines.some((other) => other.pass !== candidate.pass && linesAreSimilar(candidate, other));
    const phrase = candidate.text.split(/\s+/).filter((word) => /\p{L}{2}/u.test(word));
    const labeledNumber = phrase.length >= 1 && /(?:\d|[\u09E6-\u09EF])/.test(candidate.text) && candidate.text.split(/\s+/).length >= 2;
    const banglaLetters = [...candidate.text].filter((character) => hasBanglaLetter(character)).length;
    const strongBangla = isBanglaText(candidate.text) && candidate.confidence >= (banglaLetters === 1 ? 94 : 85);
    if (!corroborated && !((phrase.length >= 2 || labeledNumber) && candidate.confidence >= 82)
      && !strongBangla && !(phrase.some((word) => word.length >= 4) && candidate.confidence >= 94)) {
      duplicateCount += 1;
      continue;
    }
    const duplicate = uniqueOcr.find((existing) => linesAreSimilar(existing, candidate));
    if (duplicate) duplicateCount += 1;
    else uniqueOcr.push(candidate);
  }

  const exactLines = domLines.map((line) => ({
    text: cleanText(line.text),
    confidence: 100,
    top: line.top / selectionSize.height,
    bottom: (line.top + line.height) / selectionSize.height,
    left: line.left / selectionSize.width,
    right: (line.left + line.width) / selectionSize.width,
    exact: true,
  })).filter((line) => line.text);

  const imageLines = uniqueOcr.filter((ocrLine) => !exactLines.some((domLine) => verticalOverlap(ocrLine, domLine) >= 0.45 && horizontalOverlap(ocrLine, domLine) >= 0.45));
  duplicateCount += uniqueOcr.length - imageLines.length;
  const combined = [...exactLines, ...imageLines].sort((a, b) => a.top - b.top || a.left - b.left);
  const ocrConfidence = imageLines.length
    ? imageLines.reduce((total, line) => total + line.confidence, 0) / imageLines.length
    : null;
  return {
    text: combined.map((line) => line.text).join('\n'),
    confidence: ocrConfidence,
    duplicateCount,
  };
}

function linesAreSimilar(first, second) {
  if (verticalOverlap(first, second) < 0.35 || horizontalOverlap(first, second) < 0.45) return false;
  const a = normalizeForComparison(first.text);
  const b = normalizeForComparison(second.text);
  if (Math.min(a.length, b.length) <= 3) return a === b;
  return a === b || a.includes(b) || b.includes(a) || similarity(a, b) >= 0.72;
}

function horizontalOverlap(first, second) {
  const overlap = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  return overlap / Math.max(0.001, Math.min(first.right - first.left, second.right - second.left));
}

function verticalOverlap(first, second) {
  const overlap = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  return overlap / Math.max(0.001, Math.min(first.bottom - first.top, second.bottom - second.top));
}

function normalizeForComparison(text) {
  return text.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]/g, '');
}

function similarity(first, second) {
  if (!first || !second) return 0;
  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let row = 1; row <= first.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= second.length; column += 1) {
      const above = previous[column];
      previous[column] = first[row - 1] === second[column - 1]
        ? diagonal
        : Math.min(diagonal, previous[column - 1], above) + 1;
      diagonal = above;
    }
  }
  return 1 - previous[second.length] / Math.max(first.length, second.length);
}

function parseDomLines(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function buildRawText(ocrText, exactLines) {
  return [...exactLines.map((line) => cleanText(line.text)), cleanText(ocrText)].filter(Boolean).join('\n');
}

function cleanText(text) {
  return String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toggleRawText() {
  showingRawText = !showingRawText;
  elements.resultText.value = showingRawText ? rawText : filteredText;
  elements.toggleRawButton.textContent = showingRawText ? 'Show reliable text' : 'Show all detections';
  setCopyButtonsDisabled(!elements.resultText.value);
  requestPanelFit();
}

function setCopyButtonsDisabled(disabled) {
  elements.copyParagraphButton.disabled = disabled;
  elements.copyLinesButton.disabled = disabled;
}

function textAsParagraph(text) {
  return text.split(/\s*\n+\s*/).filter(Boolean).join(' ').replace(/[ \t]{2,}/g, ' ').trim();
}

function resetCopyButton(button) {
  button.classList.remove('copied', 'copy-error');
  button.querySelector('.button-label').textContent = button.dataset.defaultLabel;
}

function showCopyState(button, { announcement, label, state = 'copied' }) {
  clearTimeout(copyStatusTimer);
  for (const copyButton of [elements.copyParagraphButton, elements.copyLinesButton]) resetCopyButton(copyButton);
  button.classList.add(state);
  button.querySelector('.button-label').textContent = label;
  elements.copyStatus.textContent = announcement;
  copyStatusTimer = setTimeout(() => {
    resetCopyButton(button);
    elements.copyStatus.textContent = '';
  }, 1800);
}

async function copyText({ preserveLineBreaks, button }) {
  const value = preserveLineBreaks ? elements.resultText.value.trim() : textAsParagraph(elements.resultText.value);
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showCopyState(button, {
      announcement: preserveLineBreaks ? 'Copied with line breaks' : 'Copied as a paragraph',
      label: 'Copied',
    });
  } catch (error) {
    elements.resultText.focus();
    elements.resultText.select();
    showCopyState(button, {
      announcement: 'Automatic copy failed. Press Ctrl or Command and C.',
      label: 'Press Ctrl/Cmd+C',
      state: 'copy-error',
    });
  }
}

function startPanelDrag(event) {
  if (event.button !== 0 || event.target.closest('button')) return;
  dragPointerId = event.pointerId;
  elements.panelHeader.setPointerCapture(event.pointerId);
  elements.panelHeader.classList.add('dragging');
  postAction('drag-start', { screenX: event.screenX, screenY: event.screenY });
  event.preventDefault();
}

function movePanelDrag(event) {
  if (event.pointerId !== dragPointerId) return;
  postAction('drag-move', { screenX: event.screenX, screenY: event.screenY });
}

function endPanelDrag(event) {
  if (event.pointerId !== dragPointerId) return;
  dragPointerId = null;
  elements.panelHeader.classList.remove('dragging');
  postAction('drag-end');
}

elements.languageLabel.textContent = LANGUAGE_LABELS[language] || LANGUAGE_LABELS['ben+eng'];
elements.copyParagraphButton.addEventListener('click', () => copyText({ preserveLineBreaks: false, button: elements.copyParagraphButton }));
elements.copyLinesButton.addEventListener('click', () => copyText({ preserveLineBreaks: true, button: elements.copyLinesButton }));
elements.resultText.addEventListener('input', () => setCopyButtonsDisabled(!elements.resultText.value.trim()));
elements.toggleRawButton.addEventListener('click', toggleRawText);
elements.scanAnotherButton.addEventListener('click', () => postAction('scan-another'));
elements.closeButton.addEventListener('click', () => postAction('close'));
elements.panelHeader.addEventListener('pointerdown', startPanelDrag);
elements.panelHeader.addEventListener('pointermove', movePanelDrag);
elements.panelHeader.addEventListener('pointerup', endPanelDrag);
elements.panelHeader.addEventListener('pointercancel', endPanelDrag);
elements.preview.addEventListener('load', requestPanelFit);
new ResizeObserver(requestPanelFit).observe(elements.resultText);
requestPanelFit();

(async () => {
  try {
    await loadAndCropCapture();
    await runOcr();
  } catch (error) {
    console.error('BanglaSnap OCR failed:', error);
    elements.progressSection.hidden = true;
    showError(error.message || 'OCR could not process this selection. Please scan another area.');
  }
})();

window.addEventListener('unload', () => {
  if (worker) worker.terminate();
  if (captureUrl) URL.revokeObjectURL(captureUrl);
});
