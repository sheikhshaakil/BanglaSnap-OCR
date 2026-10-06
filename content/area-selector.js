(() => {
  if (globalThis.__banglaSnapAreaSelectorInstalled) return;
  globalThis.__banglaSnapAreaSelectorInstalled = true;

  let session = null;
  let panel = null;

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'START_AREA_SELECTION') startSelection(message.language, message.captureId);
  });

  window.addEventListener('message', (event) => {
    if (!panel || event.source !== panel.iframe.contentWindow || event.data?.source !== 'banglasnap-panel') return;

    if (event.data.action === 'close') removePanel();
    if (event.data.action === 'drag-start') startPanelDrag(event.data.screenX, event.data.screenY);
    if (event.data.action === 'drag-move') moveResultPanel(event.data.screenX, event.data.screenY);
    if (event.data.action === 'drag-end') panel.drag = null;
    if (event.data.action === 'resize-panel') resizeResultPanel(event.data.height);
    if (event.data.action === 'scan-another') {
      const language = event.data.language || 'ben+eng';
      removePanel();
      chrome.runtime.sendMessage({ type: 'RESTART_SELECTION', language }).then((response) => {
        if (!response?.ok) showToast('Could not start another scan. Click the extension and try again.', true);
      }).catch(() => showToast('Could not start another scan. Click the extension and try again.', true));
    }
  });

  function startPanelDrag(screenX, screenY) {
    if (!panel || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
    const rect = panel.host.getBoundingClientRect();
    panel.drag = { screenX, screenY, left: rect.left, top: rect.top };
  }

  function moveResultPanel(screenX, screenY) {
    if (!panel?.drag || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
    const rect = panel.host.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, panel.drag.left + screenX - panel.drag.screenX),
      Math.max(8, window.innerWidth - rect.width - 8),
    );
    const top = Math.min(
      Math.max(8, panel.drag.top + screenY - panel.drag.screenY),
      Math.max(8, window.innerHeight - rect.height - 8),
    );
    panel.host.style.setProperty('left', `${left}px`, 'important');
    panel.host.style.setProperty('top', `${top}px`, 'important');
    panel.host.style.setProperty('right', 'auto', 'important');
  }

  function resizeResultPanel(requestedHeight) {
    if (!panel || !Number.isFinite(requestedHeight)) return;
    const maxHeight = Math.max(280, window.innerHeight - 16);
    const height = Math.min(maxHeight, Math.max(420, Math.ceil(requestedHeight)));
    panel.host.style.setProperty('height', `${height}px`, 'important');
    const rect = panel.host.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8) {
      panel.host.style.setProperty('top', `${Math.max(8, window.innerHeight - height - 8)}px`, 'important');
    }
  }

  function startSelection(language, captureId) {
    if (session) {
      discardCapture(session.captureId);
      cleanup();
    }
    removePanel();

    const overlay = document.createElement('div');
    overlay.id = 'banglasnap-selection-overlay';
    overlay.innerHTML = `
      <div class="banglasnap-selection-shade"></div>
      <div class="banglasnap-selection-help">
        <strong>BanglaSnap OCR</strong>
        <span>Drag around the text you want to recognize</span>
        <kbd>Esc</kbd><span>Cancel</span>
      </div>
      <div class="banglasnap-selection-box" hidden>
        <span class="banglasnap-selection-size"></span>
      </div>
    `;

    const style = document.createElement('style');
    style.id = 'banglasnap-selection-style';
    style.textContent = `
      #banglasnap-selection-overlay { position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; user-select: none; touch-action: none; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .banglasnap-selection-shade { position: absolute; inset: 0; background: rgba(5, 18, 14, .38); }
      .banglasnap-selection-help { position: absolute; top: 18px; left: 50%; display: flex; align-items: center; gap: 9px; transform: translateX(-50%); border: 1px solid rgba(255,255,255,.24); border-radius: 10px; padding: 10px 14px; color: #fff; background: #006747; box-shadow: 0 8px 26px rgba(0,0,0,.25); font-size: 13px; white-space: nowrap; }
      .banglasnap-selection-help strong { color: #fff; }
      .banglasnap-selection-help kbd { margin-left: 8px; border: 1px solid rgba(255,255,255,.45); border-radius: 4px; padding: 2px 5px; background: #00563c; font: inherit; font-size: 11px; }
      .banglasnap-selection-box { position: absolute; border: 2px solid #e31b23; background: transparent; box-shadow: 0 0 0 99999px rgba(5, 18, 14, .38), 0 0 0 1px rgba(255,255,255,.8) inset; }
      .banglasnap-selection-size { position: absolute; right: -2px; bottom: -27px; border-radius: 5px; padding: 4px 6px; color: #fff; background: #006747; font-size: 11px; line-height: 1; }
      .banglasnap-toast { position: fixed; top: 18px; left: 50%; z-index: 2147483647; transform: translateX(-50%); border-radius: 9px; padding: 11px 15px; color: #fff; background: #e31b23; box-shadow: 0 8px 24px rgba(0,0,0,.25); font: 600 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
    `;

    document.documentElement.append(style, overlay);
    const box = overlay.querySelector('.banglasnap-selection-box');
    const shade = overlay.querySelector('.banglasnap-selection-shade');
    const sizeLabel = overlay.querySelector('.banglasnap-selection-size');
    session = { overlay, style, shade, box, sizeLabel, language, captureId, startX: 0, startY: 0, dragging: false };

    overlay.addEventListener('pointerdown', onPointerDown, true);
    overlay.addEventListener('pointermove', onPointerMove, true);
    overlay.addEventListener('pointerup', onPointerUp, true);
    overlay.addEventListener('wheel', blockEvent, { capture: true, passive: false });
    window.addEventListener('keydown', onKeyDown, true);
  }

  function blockEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerDown(event) {
    if (event.button !== 0 || !session) return;
    event.preventDefault();
    event.stopPropagation();
    session.dragging = true;
    session.startX = event.clientX;
    session.startY = event.clientY;
    session.shade.hidden = true;
    session.box.hidden = false;
    session.overlay.setPointerCapture(event.pointerId);
    updateBox(event.clientX, event.clientY);
  }

  function onPointerMove(event) {
    if (!session?.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    updateBox(event.clientX, event.clientY);
  }

  function onPointerUp(event) {
    if (!session?.dragging) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = getRect(session.startX, session.startY, event.clientX, event.clientY);
    const language = session.language;
    const captureId = session.captureId;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    cleanup();
    const domLines = collectVisibleDomText(rect);

    if (rect.width < 12 || rect.height < 12) {
      discardCapture(captureId);
      showToast('Select a larger area and try again.', true);
      return;
    }

    showResultPanel({ captureId, language, rect, viewport, domLines });
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !session) return;
    event.preventDefault();
    event.stopPropagation();
    const captureId = session.captureId;
    cleanup();
    discardCapture(captureId);
  }

  function updateBox(currentX, currentY) {
    const rect = getRect(session.startX, session.startY, currentX, currentY);
    Object.assign(session.box.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    session.sizeLabel.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  }

  function getRect(startX, startY, endX, endY) {
    const left = Math.max(0, Math.min(startX, endX));
    const top = Math.max(0, Math.min(startY, endY));
    const right = Math.min(window.innerWidth, Math.max(startX, endX));
    const bottom = Math.min(window.innerHeight, Math.max(startY, endY));
    return { left, top, width: right - left, height: bottom - top };
  }

  function cleanup() {
    if (!session) return;
    session.overlay.remove();
    session.style.remove();
    window.removeEventListener('keydown', onKeyDown, true);
    session = null;
  }

  function collectVisibleDomText(selection) {
    const fragments = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node && fragments.length < 250) {
      const rawText = node.nodeValue;
      const element = node.parentElement;
      if (rawText.trim() && element && !element.closest('#banglasnap-selection-overlay, #banglasnap-result-panel-host, script, style, noscript')) {
        const style = getComputedStyle(element);
        if (style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0) {
          for (const match of rawText.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            for (const box of range.getClientRects()) {
              const visible = visibleTextRect(element, box, selection);
              if (!visible) continue;
              fragments.push({
                text: match[0],
                left: visible.left - selection.left,
                top: visible.top - selection.top,
                width: visible.right - visible.left,
                height: visible.bottom - visible.top,
              });
            }
          }
        }
      }
      node = walker.nextNode();
    }

    fragments.sort((a, b) => a.top - b.top || a.left - b.left);
    const lines = [];
    for (const fragment of fragments) {
      const existing = lines.find((line) => (
        Math.abs(line.top - fragment.top) <= Math.max(4, fragment.height * 0.45)
        && fragment.left >= line.left
      ));
      if (existing) {
        existing.text += ` ${fragment.text}`;
        existing.width = Math.max(existing.width, fragment.left + fragment.width - existing.left);
        existing.height = Math.max(existing.height, fragment.height);
      } else {
        lines.push({ ...fragment });
      }
    }
    return lines.slice(0, 100);
  }

  function visibleTextRect(element, box, selection) {
    const visible = {
      left: Math.max(box.left, selection.left, 0),
      top: Math.max(box.top, selection.top, 0),
      right: Math.min(box.right, selection.left + selection.width, window.innerWidth),
      bottom: Math.min(box.bottom, selection.top + selection.height, window.innerHeight),
    };
    // Range rectangles include offscreen digits in animated counters and text
    // inside transparent controls. Inspect the entire ancestor chain and clip
    // to each scrolling/clipping container before treating DOM text as exact.
    let opacity = 1;
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      opacity *= Number(style.opacity);
      if (style.display === 'none' || style.contentVisibility === 'hidden' || opacity < 0.1) return null;
      // Arbitrary masks cannot be resolved reliably with rectangular bounds;
      // let the screenshot OCR handle those elements instead.
      if ((style.clipPath && style.clipPath !== 'none')
        || (style.clip && style.clip !== 'auto')) return null;
      const clipsX = /^(hidden|clip|scroll|auto)$/.test(style.overflowX);
      const clipsY = /^(hidden|clip|scroll|auto)$/.test(style.overflowY);
      if (clipsX || clipsY) {
        const bounds = ancestor.getBoundingClientRect();
        if (clipsX) {
          visible.left = Math.max(visible.left, bounds.left);
          visible.right = Math.min(visible.right, bounds.right);
        }
        if (clipsY) {
          visible.top = Math.max(visible.top, bounds.top);
          visible.bottom = Math.min(visible.bottom, bounds.bottom);
        }
      }
    }
    if (visible.right <= visible.left || visible.bottom <= visible.top) return null;
    if ((visible.bottom - visible.top) < box.height * 0.6) return null;
    // Reject text covered by a different element. The selection overlay has
    // already been removed so it cannot interfere with this check.
    const y = (visible.top + visible.bottom) / 2;
    const exposed = [0.2, 0.5, 0.8].some((fraction) => {
      const top = document.elementFromPoint(visible.left + (visible.right - visible.left) * fraction, y);
      return top === element || (top && element.contains(top));
    });
    return exposed ? visible : null;
  }

  function showResultPanel({ captureId, language, rect, viewport, domLines }) {
    const host = document.createElement('div');
    host.id = 'banglasnap-result-panel-host';
    host.style.cssText = [
      'all: initial !important',
      'position: fixed !important',
      'top: 16px !important',
      'right: 16px !important',
      'width: min(480px, calc(100vw - 32px)) !important',
      'height: min(640px, calc(100vh - 32px)) !important',
      'z-index: 2147483647 !important',
      'display: block !important',
    ].join(';');

    const shadow = host.attachShadow({ mode: 'closed' });
    const iframe = document.createElement('iframe');
    const parameters = new URLSearchParams({
      capture: captureId,
      language,
      left: String(rect.left),
      top: String(rect.top),
      width: String(rect.width),
      height: String(rect.height),
      viewportWidth: String(viewport.width),
      viewportHeight: String(viewport.height),
      domLines: JSON.stringify(domLines),
    });
    iframe.src = chrome.runtime.getURL(`panel/panel.html?${parameters}`);
    iframe.title = 'BanglaSnap OCR result';
    iframe.allow = 'clipboard-write';
    iframe.style.cssText = 'width:100%;height:100%;border:0;border-radius:14px;background:#f7f9f8;box-shadow:0 18px 55px rgba(0,0,0,.28);';
    shadow.append(iframe);
    document.documentElement.append(host);
    panel = { host, iframe };
  }

  function removePanel() {
    if (!panel) return;
    panel.host.remove();
    panel = null;
  }

  function discardCapture(captureId) {
    if (!captureId) return;
    chrome.runtime.sendMessage({ type: 'DISCARD_CAPTURE', captureId }).catch(() => {});
  }

  function showToast(message, isError = false) {
    document.querySelector('.banglasnap-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'banglasnap-toast';
    if (!isError) toast.style.background = '#006747';
    toast.textContent = message;
    document.documentElement.append(toast);
    setTimeout(() => toast.remove(), 4000);
  }
})();
