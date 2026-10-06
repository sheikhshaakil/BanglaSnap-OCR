const CAPTURE_KEY_PREFIX = 'banglasnap-capture:';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BEGIN_SELECTION') {
    beginSelection(message.tabId, message.language)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'RESTART_SELECTION' && sender.tab) {
    beginSelection(sender.tab.id, message.language)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'DISCARD_CAPTURE') {
    discardCapture(message.captureId).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'GET_CAPTURE') {
    getCapture(message.captureId)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function beginSelection(tabId, language) {
  if (!Number.isInteger(tabId)) throw new Error('No active webpage was found.');

  const tab = await chrome.tabs.get(tabId);
  const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: 'jpeg',
    quality: 95,
  });
  const captureId = crypto.randomUUID();
  await storeCapture(captureId, screenshotUrl);

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/area-selector.js'],
    });

    await chrome.tabs.sendMessage(tabId, {
      type: 'START_AREA_SELECTION',
      language,
      captureId,
    });
  } catch (error) {
    await discardCapture(captureId);
    throw error;
  }
}

async function discardCapture(captureId) {
  if (!captureId) return;
  await chrome.storage.session.remove(`${CAPTURE_KEY_PREFIX}${captureId}`);
}

async function getCapture(captureId) {
  if (!captureId) throw new Error('The captured image is missing.');
  const key = `${CAPTURE_KEY_PREFIX}${captureId}`;
  const stored = await chrome.storage.session.get(key);
  const dataUrl = stored[key];
  if (!dataUrl) throw new Error('The captured image expired. Please scan another area.');
  await chrome.storage.session.remove(key);
  return dataUrl;
}

async function storeCapture(captureId, dataUrl) {
  const stored = await chrome.storage.session.get(null);
  const staleKeys = Object.keys(stored).filter((key) => key.startsWith(CAPTURE_KEY_PREFIX));
  if (staleKeys.length) await chrome.storage.session.remove(staleKeys);
  await chrome.storage.session.set({ [`${CAPTURE_KEY_PREFIX}${captureId}`]: dataUrl });
}
