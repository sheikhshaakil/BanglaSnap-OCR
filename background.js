const CAPTURE_KEY_PREFIX = 'banglasnap-capture:';
const EXTENSION_ENABLED_KEY = 'extensionEnabled';
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

async function syncActionIcon(enabled) {
  await chrome.action.setIcon({ path: enabled ? ACTIVE_ICONS : DISABLED_ICONS });
  await chrome.action.setTitle({ title: enabled ? 'BanglaSnap OCR' : 'BanglaSnap OCR — Paused' });
}

async function restoreExtensionState() {
  const stored = await chrome.storage.local.get({ [EXTENSION_ENABLED_KEY]: true });
  await syncActionIcon(stored[EXTENSION_ENABLED_KEY] !== false);
}

chrome.runtime.onInstalled.addListener(restoreExtensionState);
chrome.runtime.onStartup.addListener(restoreExtensionState);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[EXTENSION_ENABLED_KEY]) {
    syncActionIcon(changes[EXTENSION_ENABLED_KEY].newValue !== false).catch(console.error);
  }
});
restoreExtensionState().catch(console.error);

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

  const stored = await chrome.storage.local.get({ [EXTENSION_ENABLED_KEY]: true });
  if (stored[EXTENSION_ENABLED_KEY] === false) {
    throw new Error('BanglaSnap OCR is paused. Turn it on from the extension popup.');
  }

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
