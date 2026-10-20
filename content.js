// 2026 Osaym Omar - SmoothIIQ Content Script v1.4

// 1. Initialize State
chrome.storage.local.get('isEnabled', function (data) {
  setOptimizationState(data.isEnabled !== false);
});

// 2. Listen for Changes
chrome.storage.onChanged.addListener(function (changes) {
  if (changes.isEnabled) {
    setOptimizationState(changes.isEnabled.newValue !== false);
  }
});

maybeShowOutdatedToastOnRefresh();

try {
  if (window.location && window.location.origin && window.location.origin.includes('incidentiq.com')) {
    chrome.storage.local.set({ lastKnownTenantUrl: window.location.origin });
  }
} catch (e) { }

// 4. Message Handling
window.addEventListener('message', function (event) {
  if (event.source !== window || !event.data || typeof event.data !== 'object') return;

  if (event.data.type === 'SMOOTHIIQ_TOAST') {
    showCacheNotification(
      event.data.text,
      event.data.isLoading,
      event.data.duration,
      event.data.progress,
      event.data.subProgress
    );
  }
  if (event.data.type === 'SMOOTHIIQ_SYNC_SUCCESS') {
    if (isExtensionValid()) {
      try { chrome.storage.local.set({ 'lastSyncTime': event.data.timestamp }); } catch (e) { }
    }
  }
  if (event.data.type === 'SMOOTHIIQ_STATS_DATA') {
    if (isExtensionValid()) {
      try { chrome.storage.local.set({ 'cacheStats': event.data.stats }); } catch (e) { }
    }
  }
  if (event.data.type === 'SMOOTHIIQ_SAVINGS_EVENT') {
    recordSavings(event.data.bytesSaved || 0, event.data.timeSavedMs || 0, event.data.isTracker || false);
  }
  if (event.data.type === 'SMOOTHIIQ_COMMENT_SHORTCUT') {
    handleCommentShortcutTrigger();
  }
  if (event.data.type === 'SMOOTHIIQ_MODAL_KEY') {
    handleModalKeyFromPage(event.data.key);
  }
});

function isExtensionValid() {
  try {
    return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

// --- Savings Accumulator ---
let pendingSavings = { bytes: 0, timeMs: 0, requests: 0, trackers: 0 };
let savingsFlushTimer = null;

function recordSavings(bytes, timeMs, isTracker = false) {
  pendingSavings.bytes += bytes;
  pendingSavings.timeMs += timeMs;
  pendingSavings.requests += 1;
  if (isTracker) {
    pendingSavings.trackers += 1;
  }

  if (!savingsFlushTimer) {
    savingsFlushTimer = setTimeout(flushSavings, 1500);
  }
}

function flushSavings() {
  savingsFlushTimer = null;
  if (!isExtensionValid()) return;
  if (pendingSavings.requests === 0 && pendingSavings.trackers === 0) return;
  const toFlush = { ...pendingSavings };
  pendingSavings = { bytes: 0, timeMs: 0, requests: 0, trackers: 0 };

  try {
    chrome.storage.local.get('savingsStats', function (data) {
      if (!isExtensionValid()) return;
      const current = data.savingsStats || { bytes: 0, timeMs: 0, requests: 0, trackers: 0 };
      const updated = {
        bytes: (current.bytes || 0) + toFlush.bytes,
        timeMs: (current.timeMs || 0) + toFlush.timeMs,
        requests: (current.requests || 0) + toFlush.requests,
        trackers: (current.trackers || 0) + toFlush.trackers,
        lastUpdated: Date.now()
      };
      chrome.storage.local.set({ savingsStats: updated });
    });
  } catch (e) { }
}

window.addEventListener('beforeunload', flushSavings);

// --- Active Time on iiQ Tracker (Multi-Tab Safe + Idle Detection) ---
let activeTimeTimer = null;
let pendingActiveSeconds = 0;
let lastActiveTimeFlush = Date.now();
let lastUserInteractionTime = Date.now();
const IDLE_TIMEOUT_MS = 60 * 1000; // 60 seconds of inactivity pauses counting

function recordUserActivity() {
  lastUserInteractionTime = Date.now();
}

['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
  window.addEventListener(evt, recordUserActivity, { passive: true });
});

function isUserActive() {
  const isVisible = document.visibilityState === 'visible';
  // Use focus check so 2-3 open tabs don't double/triple count the same real minute
  const isFocused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  const isNotIdle = (Date.now() - lastUserInteractionTime) < IDLE_TIMEOUT_MS;
  return isVisible && isFocused && isNotIdle;
}

function startActiveTimer() {
  if (activeTimeTimer) return;
  activeTimeTimer = setInterval(() => {
    if (isUserActive()) {
      pendingActiveSeconds += 1;
      if (pendingActiveSeconds >= 10 || (Date.now() - lastActiveTimeFlush) > 15000) {
        flushActiveTime();
      }
    }
  }, 1000);
}

function flushActiveTime() {
  if (!isExtensionValid()) {
    if (activeTimeTimer) {
      clearInterval(activeTimeTimer);
      activeTimeTimer = null;
    }
    return;
  }
  lastActiveTimeFlush = Date.now();
  if (pendingActiveSeconds <= 0) return;
  const secsToAdd = pendingActiveSeconds;
  pendingActiveSeconds = 0;

  try {
    chrome.storage.local.get(['timeSpentOnIIQ', 'installDate'], function (data) {
      if (!isExtensionValid()) return;
      const currentMs = Number(data.timeSpentOnIIQ) || 0;
      const updates = {
        timeSpentOnIIQ: currentMs + (secsToAdd * 1000)
      };
      if (!data.installDate) {
        updates.installDate = Date.now();
      }
      chrome.storage.local.set(updates);
    });
  } catch (e) {
    if (activeTimeTimer) {
      clearInterval(activeTimeTimer);
      activeTimeTimer = null;
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushActiveTime();
  } else {
    recordUserActivity();
  }
});

window.addEventListener('focus', recordUserActivity);
window.addEventListener('blur', flushActiveTime);
window.addEventListener('beforeunload', flushActiveTime);
startActiveTimer();

chrome.runtime.onMessage.addListener(function (request) {
  if (request.action === "FORCE_RESYNC") {
    window.postMessage({ type: 'SMOOTHIIQ_CMD_FORCE_SYNC' }, '*');
  }
  if (request.action === "GET_CACHE_STATS") {
    window.postMessage({ type: 'SMOOTHIIQ_CMD_GET_STATS' }, '*');
  }
});

// --- Helper Functions ---

function enableBlocking() {
  document.documentElement.classList.add('smoothiiq-active');
}

function disableBlocking() {
  document.documentElement.classList.remove('smoothiiq-active');
}

function sendInterceptorEnabledState(isEnabled) {
  window.postMessage({
    type: 'SMOOTHIIQ_CMD_SET_ENABLED',
    enabled: !!isEnabled
  }, '*');
}

function setOptimizationState(isEnabled) {
  if (isEnabled) enableBlocking();
  else disableBlocking();
  sendInterceptorEnabledState(isEnabled);
}

let toastTimeout = null;

function showCacheNotification(message, isLoading = true, duration = 0, progress = -1, subProgress = -1) {
  let toast = document.getElementById('smoothiiq-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'smoothiiq-toast';
    const toastTarget = document.body || document.documentElement;
    toastTarget.appendChild(toast);
  }

  const showBars = progress >= 0 || subProgress >= 0;
  const mainPct = Math.min(100, Math.max(0, progress));
  const subPct = Math.min(100, Math.max(0, subProgress));

  toast.textContent = '';

  const header = document.createElement('div');
  header.className = 'toast-header';

  if (isLoading) {
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    header.appendChild(spinner);
  }

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = String(message || '');
  header.appendChild(text);
  toast.appendChild(header);

  if (showBars) {
    const wrapper = document.createElement('div');
    wrapper.className = 'progress-wrapper';

    const categoryContainer = document.createElement('div');
    categoryContainer.className = 'toast-progress-container category';
    const categoryFill = document.createElement('div');
    categoryFill.className = 'toast-progress-fill green';
    categoryFill.style.width = `${subPct}%`;
    categoryContainer.appendChild(categoryFill);

    const totalContainer = document.createElement('div');
    totalContainer.className = 'toast-progress-container total';
    const totalFill = document.createElement('div');
    totalFill.className = 'toast-progress-fill blue';
    totalFill.style.width = `${mainPct}%`;
    totalContainer.appendChild(totalFill);

    const labels = document.createElement('div');
    labels.className = 'progress-labels';
    const currentLabel = document.createElement('span');
    currentLabel.textContent = 'Current';
    const totalLabel = document.createElement('span');
    totalLabel.textContent = `Total: ${mainPct}%`;
    labels.appendChild(currentLabel);
    labels.appendChild(totalLabel);

    wrapper.appendChild(categoryContainer);
    wrapper.appendChild(totalContainer);
    wrapper.appendChild(labels);
    toast.appendChild(wrapper);
  }

  void toast.offsetWidth;
  toast.classList.add('show');

  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  if (duration > 0) {
    toastTimeout = setTimeout(() => { toast.classList.remove('show'); }, duration);
  }
}

function maybeShowOutdatedToastOnRefresh() {
  chrome.storage.local.get('updateInfo', function (data) {
    const updateInfo = data.updateInfo;
    if (!updateInfo || !updateInfo.isOutdated) return;

    const currentInstalledVersion = normalizeVersion(chrome.runtime.getManifest().version);
    if (updateInfo.installedVersion && normalizeVersion(updateInfo.installedVersion) !== currentInstalledVersion) {
      return;
    }

    const latest = updateInfo.latestVersion ? `v${updateInfo.latestVersion}` : 'latest version';
    const toastText = `SmoothIIQ is out of date (${latest} available)`;

    const showToast = function () {
      showCacheNotification(toastText, false, 3200);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(showToast, 350);
      }, { once: true });
    } else {
      setTimeout(showToast, 350);
    }
  });
}

function normalizeVersion(versionString) {
  if (!versionString) return '';
  return String(versionString).trim().replace(/^v/i, '');
}

// --- 5. Keyboard Shortcut: Cmd/Ctrl + Enter to Save ---
function findPrimarySaveButton() {
  const scopes = [
    document.querySelector('.iq-flyout:not(.ng-hide):not([aria-hidden="true"])'),
    document.querySelector('.flyout:not(.ng-hide):not([aria-hidden="true"])'),
    document.querySelector('.modal.show, .modal.in, .modal:not(.ng-hide)'),
    document.querySelector('iq-flyout, iq-drawer, .iq-drawer'),
    document.body
  ].filter(Boolean);

  for (const scope of scopes) {
    const candidates = Array.from(scope.querySelectorAll('button, a.btn, input[type="submit"], [role="button"], iq-button'));

    // Priority 1: Visible element matching Save / Update / Done
    for (const el of candidates) {
      const target = el.tagName === 'IQ-BUTTON' ? (el.querySelector('button') || el) : el;
      if (target.disabled || target.getAttribute('disabled') !== null) continue;
      if (!target.offsetParent && target.offsetWidth === 0 && target.offsetHeight === 0) continue;

      const text = (target.textContent || target.value || '').trim();
      if (/^(save|save changes|update|update asset|submit|done)$/i.test(text)) {
        return target;
      }
    }

    // Priority 2: Primary colored action button in footer or bottom bar
    for (const el of candidates) {
      const target = el.tagName === 'IQ-BUTTON' ? (el.querySelector('button') || el) : el;
      if (target.disabled || target.getAttribute('disabled') !== null) continue;
      if (!target.offsetParent && target.offsetWidth === 0 && target.offsetHeight === 0) continue;

      const isPrimary = target.classList.contains('btn-primary') ||
        target.classList.contains('k-primary') ||
        (target.className && target.className.includes('primary'));
      if (isPrimary) {
        return target;
      }
    }
  }

  return null;
}

// --- 5. Keyboard Shortcut: Cmd/Ctrl + Enter to Save / Submit ---
let commentModalOverlay = null;
let currentCommentComposer = null;
let lastActiveEditor = null;

function ensureCommentModalDom() {
  if (commentModalOverlay && document.body.contains(commentModalOverlay)) {
    return commentModalOverlay;
  }

  const overlay = document.createElement('div');
  overlay.id = 'smoothiiq-comment-overlay';
  overlay.innerHTML = `
    <div id="smoothiiq-comment-modal" role="dialog" aria-modal="true" aria-labelledby="smoothiiq-modal-title">
      <div class="smoothiiq-modal-header">
        <div class="smoothiiq-modal-title-wrap">
          <span class="smoothiiq-brand-pill">SmoothIIQ</span>
          <h3 id="smoothiiq-modal-title">Submit Ticket Comment</h3>
        </div>
        <button type="button" class="smoothiiq-close-btn" id="smoothiiq-close-modal" aria-label="Close modal">&times;</button>
      </div>
      <div class="smoothiiq-modal-subtitle">Press a number [1 - 3] or click an option to submit:</div>
      <div class="smoothiiq-options-list">
        <button type="button" class="smoothiiq-option-btn" data-choice="1">
          <span class="smoothiiq-key-pill">1</span>
          <div class="smoothiiq-option-info">
            <div class="smoothiiq-option-name"><span class="smoothiiq-opt-icon">🔒</span> Private Comment</div>
            <div class="smoothiiq-option-desc">Visible to Requestor = OFF &bull; Waiting on Requestor = OFF</div>
          </div>
        </button>
        <button type="button" class="smoothiiq-option-btn" data-choice="2">
          <span class="smoothiiq-key-pill">2</span>
          <div class="smoothiiq-option-info">
            <div class="smoothiiq-option-name"><span class="smoothiiq-opt-icon">👁️</span> Visible to Requestor</div>
            <div class="smoothiiq-option-desc">Visible to Requestor = ON &bull; Waiting on Requestor = OFF</div>
          </div>
        </button>
        <button type="button" class="smoothiiq-option-btn" data-choice="3">
          <span class="smoothiiq-key-pill">3</span>
          <div class="smoothiiq-option-info">
            <div class="smoothiiq-option-name"><span class="smoothiiq-opt-icon">✉️</span> Visible &amp; Waiting on Requestor</div>
            <div class="smoothiiq-option-desc">Visible to Requestor = ON &bull; Waiting on Requestor = ON</div>
          </div>
        </button>
      </div>
      <div class="smoothiiq-modal-footer">
        <span>SmoothIIQ Shortcut</span>
        <span><kbd>Esc</kbd> to cancel</span>
      </div>
    </div>
  `;

  // Click outside backdrop to cancel
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) {
      closeCommentModal(true);
    }
  });

  // Close button
  const closeBtn = overlay.querySelector('#smoothiiq-close-modal');
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      closeCommentModal(true);
    });
  }

  // Click option buttons
  const optionBtns = overlay.querySelectorAll('.smoothiiq-option-btn');
  optionBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      const choice = parseInt(btn.getAttribute('data-choice'), 10);
      if (choice && currentCommentComposer) {
        executeCommentOption(currentCommentComposer, choice);
      }
    });
  });

  document.body.appendChild(overlay);
  commentModalOverlay = overlay;
  return overlay;
}

function onModalKeydown(e) {
  if (!commentModalOverlay || !commentModalOverlay.classList.contains('smoothiiq-visible')) {
    return;
  }

  if (e.key === 'Escape' || e.keyCode === 27) {
    e.preventDefault();
    e.stopPropagation();
    closeCommentModal(true);
    return;
  }

  const isOne = e.key === '1' || e.code === 'Digit1' || e.code === 'Numpad1';
  const isTwo = e.key === '2' || e.code === 'Digit2' || e.code === 'Numpad2';
  const isThree = e.key === '3' || e.code === 'Digit3' || e.code === 'Numpad3';

  if (isOne && currentCommentComposer) {
    e.preventDefault();
    e.stopPropagation();
    executeCommentOption(currentCommentComposer, 1);
  } else if (isTwo && currentCommentComposer) {
    e.preventDefault();
    e.stopPropagation();
    executeCommentOption(currentCommentComposer, 2);
  } else if (isThree && currentCommentComposer) {
    e.preventDefault();
    e.stopPropagation();
    executeCommentOption(currentCommentComposer, 3);
  }
}

function openCommentModal(composer, activeEl) {
  currentCommentComposer = composer;
  lastActiveEditor = activeEl || document.activeElement;

  const overlay = ensureCommentModalDom();
  overlay.classList.add('smoothiiq-visible');

  // Notify Main world (TinyMCE) that modal is open so it captures 1, 2, 3, Esc
  window.postMessage({ type: 'SMOOTHIIQ_SET_MODAL_STATE', isOpen: true }, '*');

  // Focus the first option button for instant key navigation
  const firstBtn = overlay.querySelector('.smoothiiq-option-btn[data-choice="1"]');
  if (firstBtn) {
    setTimeout(() => {
      try { firstBtn.focus(); } catch (err) { }
    }, 20);
  }

  window.removeEventListener('keydown', onModalKeydown, true);
  window.addEventListener('keydown', onModalKeydown, true);
}

function closeCommentModal(restoreFocus = false) {
  if (commentModalOverlay) {
    commentModalOverlay.classList.remove('smoothiiq-visible');
  }
  window.postMessage({ type: 'SMOOTHIIQ_SET_MODAL_STATE', isOpen: false }, '*');
  window.removeEventListener('keydown', onModalKeydown, true);

  if (restoreFocus && lastActiveEditor) {
    try {
      if (lastActiveEditor.contentWindow && lastActiveEditor.contentWindow.focus) {
        lastActiveEditor.contentWindow.focus();
      } else if (typeof lastActiveEditor.focus === 'function') {
        lastActiveEditor.focus();
      }
    } catch (err) { }
  }
}

function handleModalKeyFromPage(key) {
  if (!commentModalOverlay || !commentModalOverlay.classList.contains('smoothiiq-visible')) {
    return;
  }
  if (key === 'Escape') {
    closeCommentModal(true);
  } else if (key === '1' && currentCommentComposer) {
    executeCommentOption(currentCommentComposer, 1);
  } else if (key === '2' && currentCommentComposer) {
    executeCommentOption(currentCommentComposer, 2);
  } else if (key === '3' && currentCommentComposer) {
    executeCommentOption(currentCommentComposer, 3);
  }
}

function hasCommentContent(composer) {
  if (!composer) return false;

  // 1. Check TinyMCE iframe
  const iframe = composer.querySelector('iframe');
  if (iframe) {
    try {
      const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
      if (doc && doc.body) {
        const text = (doc.body.innerText || doc.body.textContent || '').trim();
        if (text.length > 0) return true;
      }
    } catch (e) { }
  }

  // 2. Check textarea
  const textarea = composer.querySelector('textarea');
  if (textarea && textarea.value && textarea.value.trim().length > 0) {
    return true;
  }

  // 3. Check Add Comment button enabled state (IIQ disables it if empty)
  const submitBtn = composer.querySelector('button.btn-primary[ng-click*="Save"]') ||
    Array.from(composer.querySelectorAll('button.btn-primary')).find(b => /add comment/i.test(b.textContent || ''));
  if (submitBtn && !submitBtn.disabled && submitBtn.getAttribute('disabled') === null) {
    return true;
  }

  return false;
}

function handleCommentShortcutTrigger() {
  const composer = getActiveCommentComposer();
  if (!composer) return;

  if (!hasCommentContent(composer)) {
    showCacheNotification("Please type a comment before submitting", false, 2500);
    return;
  }

  openCommentModal(composer, document.activeElement);
}

function isSwitchActive(container) {
  if (!container) return false;
  const switchEl = container.querySelector('.onoffswitch2');
  if (switchEl && switchEl.getAttribute('aria-checked') !== null) {
    return switchEl.getAttribute('aria-checked') === 'true';
  }
  const checkbox = container.querySelector('input.onoffswitch2-checkbox, input[type="checkbox"]');
  if (checkbox) {
    return Boolean(checkbox.checked || checkbox.classList.contains('ng-not-empty'));
  }
  return false;
}

function setSwitchChecked(container, targetState) {
  if (!container) return;
  const current = isSwitchActive(container);
  if (current !== targetState) {
    const clickTarget = container.querySelector('.onoffswitch2') ||
      container.querySelector('.onoffswitch2-label') ||
      container.querySelector('input');
    if (clickTarget) {
      clickTarget.click();
    }
  }
}

function executeCommentOption(composer, choice) {
  closeCommentModal(false);

  let isPublic = false;
  let waitForRequestor = false;
  let label = "Private Comment";

  if (choice === 1) {
    isPublic = false;
    waitForRequestor = false;
    label = "Private Comment";
  } else if (choice === 2) {
    isPublic = true;
    waitForRequestor = false;
    label = "Visible to Requestor";
  } else if (choice === 3) {
    isPublic = true;
    waitForRequestor = true;
    label = "Visible & Waiting on Requestor";
  }

  // Commit text editor model
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  try {
    if (typeof window.tinymce !== 'undefined' && window.tinymce.triggerSave) {
      window.tinymce.triggerSave();
    }
  } catch (e) { }

  // 1. Set Visible to Requestor
  const visibleContainer = composer.querySelector('[data-testid="visible-to-requestor"]');
  if (visibleContainer) {
    setSwitchChecked(visibleContainer, isPublic);
  }

  // 2. Set Waiting on Requestor after brief tick to allow Angular digest
  setTimeout(() => {
    const waitingContainer = composer.querySelector('[data-testid="change-to-requestor"]');
    if (waitingContainer && isPublic) {
      setSwitchChecked(waitingContainer, waitForRequestor);
    } else if (waitingContainer && !isPublic) {
      setSwitchChecked(waitingContainer, false);
    }

    // 3. Trigger Add Comment button
    setTimeout(() => {
      const submitBtn = composer.querySelector('button.btn-primary[ng-click*="Save"]') ||
        Array.from(composer.querySelectorAll('button.btn-primary')).find(b => /add comment/i.test(b.textContent || ''));

      if (submitBtn) {
        if (!submitBtn.disabled && submitBtn.getAttribute('disabled') === null) {
          submitBtn.click();
          showCacheNotification(`Submitted (${label})`, false, 2000);
        } else {
          showCacheNotification("Could not submit: 'Add Comment' is disabled (empty comment?)", false, 3200);
        }
      } else {
        showCacheNotification("Could not find 'Add Comment' button", false, 3000);
      }
    }, 60);
  }, 50);
}

function getActiveCommentComposer() {
  const active = document.activeElement;
  if (active) {
    const comp = active.closest('spark-ticket-activities-add-comment');
    if (comp) return comp;
  }

  // Check if active element is a TinyMCE iframe inside a comment composer
  const iframes = document.querySelectorAll('spark-ticket-activities-add-comment iframe');
  for (const iframe of iframes) {
    if (iframe === active) {
      return iframe.closest('spark-ticket-activities-add-comment');
    }
    try {
      if (iframe.contentDocument && iframe.contentDocument.hasFocus && iframe.contentDocument.hasFocus()) {
        return iframe.closest('spark-ticket-activities-add-comment');
      }
    } catch (e) { }
  }

  // Find any visible comment composer component
  const composers = Array.from(document.querySelectorAll('spark-ticket-activities-add-comment'));
  for (const comp of composers) {
    if (comp.offsetParent !== null && !comp.classList.contains('ng-hide') && comp.offsetHeight > 50) {
      if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')) {
        if (!comp.contains(active)) {
          return null;
        }
      }
      return comp;
    }
  }

  return null;
}

function findPrimarySaveButton() {
  const DANGEROUS_TEXT = /^(resolve|resolve ticket|close|close ticket|delete|cancel|reject|remove)$/i;

  const modalScopes = [
    document.querySelector('.iq-flyout:not(.ng-hide):not([aria-hidden="true"])'),
    document.querySelector('.flyout:not(.ng-hide):not([aria-hidden="true"])'),
    document.querySelector('.modal.show, .modal.in, .modal:not(.ng-hide)'),
    document.querySelector('iq-flyout, iq-drawer, .iq-drawer')
  ].filter(Boolean);

  for (const scope of modalScopes) {
    const candidates = Array.from(scope.querySelectorAll('button, a.btn, input[type="submit"], [role="button"], iq-button'));

    // Priority 1: Exact Save / Update / Done
    for (const el of candidates) {
      const target = el.tagName === 'IQ-BUTTON' ? (el.querySelector('button') || el) : el;
      if (target.disabled || target.getAttribute('disabled') !== null) continue;
      if (!target.offsetParent && target.offsetWidth === 0 && target.offsetHeight === 0) continue;

      const text = (target.textContent || target.value || '').trim();
      if (/^(save|save changes|update|update asset|submit|done)$/i.test(text)) {
        return target;
      }
    }

    // Priority 2: Primary button inside the modal (excluding dangerous actions)
    for (const el of candidates) {
      const target = el.tagName === 'IQ-BUTTON' ? (el.querySelector('button') || el) : el;
      if (target.disabled || target.getAttribute('disabled') !== null) continue;
      if (!target.offsetParent && target.offsetWidth === 0 && target.offsetHeight === 0) continue;

      const text = (target.textContent || target.value || '').trim();
      if (DANGEROUS_TEXT.test(text)) continue;

      const isPrimary = target.classList.contains('btn-primary') ||
        target.classList.contains('k-primary') ||
        (target.className && target.className.includes('primary'));
      if (isPrimary) {
        return target;
      }
    }
  }

  // For document.body: ONLY match elements that EXPLICITLY say Save / Update
  // NEVER blindly click arbitrary .btn-primary on document.body!
  const bodyCandidates = Array.from(document.body.querySelectorAll('button, a.btn, input[type="submit"], [role="button"], iq-button'));
  for (const el of bodyCandidates) {
    const target = el.tagName === 'IQ-BUTTON' ? (el.querySelector('button') || el) : el;
    if (target.disabled || target.getAttribute('disabled') !== null) continue;
    if (!target.offsetParent && target.offsetWidth === 0 && target.offsetHeight === 0) continue;

    const text = (target.textContent || target.value || '').trim();
    if (/^(save|save changes|update|update asset|done)$/i.test(text)) {
      return target;
    }
  }

  return null;
}

function initShortcutHandlers() {
  window.addEventListener('keydown', function (e) {
    const isModifier = e.metaKey || e.ctrlKey;
    if (!isModifier || (e.key !== 'Enter' && e.keyCode !== 13)) {
      return;
    }

    // Priority 1: Comment composer shortcut
    const commentComposer = getActiveCommentComposer();
    if (commentComposer) {
      e.preventDefault();
      e.stopPropagation();
      handleCommentShortcutTrigger();
      return;
    }

    // Priority 2: Standard primary save button (assets, etc.)
    const saveBtn = findPrimarySaveButton();
    if (saveBtn) {
      e.preventDefault();
      e.stopPropagation();

      // Blur active input to commit changes to AngularJS model
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }

      try {
        sessionStorage.setItem('smoothiiq_asset_hint_seen', '1');
      } catch (err) { }

      setTimeout(() => {
        saveBtn.click();
        showCacheNotification("Saved (Cmd/Ctrl + Enter)", false, 1800);
      }, 40);
    }
  }, true);
}

// --- 6. Non-obtrusive Shortcut Tip Toasts ---
function isMacUser() {
  return (typeof navigator !== 'undefined') && (
    (navigator.platform && navigator.platform.toUpperCase().indexOf('MAC') >= 0) ||
    (navigator.userAgent && navigator.userAgent.toUpperCase().indexOf('MAC') >= 0)
  );
}

function maybeShowCommentShortcutHint(target) {
  try {
    if (sessionStorage.getItem('smoothiiq_comment_hint_seen')) return;
  } catch (e) { }

  const isComment = target && (
    target.closest('spark-ticket-activities-add-comment, .spark-ticket-activities-add-comment') ||
    (target.tagName === 'IFRAME' && target.closest('.spark-ticket-activities-add-comment'))
  );
  if (!isComment) return;

  try {
    sessionStorage.setItem('smoothiiq_comment_hint_seen', '1');
  } catch (e) { }

  const shortcut = isMacUser() ? '⌘+Enter' : 'CTRL+Enter';
  const hintText = `Pro tip: Press ${shortcut} while commenting to quickly choose Private, Visible, or Waiting on Requestor!`;
  showCacheNotification(hintText, false, 6500);
}

function isInsideAssetEditForm(target) {
  if (!target) return false;

  // Ignore ticket comments
  if (target.closest('spark-ticket-activities-add-comment, .spark-ticket-activities-add-comment')) {
    return false;
  }

  // Explicitly ignore global search bars, header, navbar, and search dropdowns
  if (target.closest('header, nav, .navbar, .global-search, .search-container, .top-bar')) {
    return false;
  }
  const isSearchInput = target.type === 'search' ||
    (target.placeholder && target.placeholder.toLowerCase().includes('search')) ||
    (target.className && typeof target.className === 'string' && target.className.toLowerCase().includes('search')) ||
    (target.id && target.id.toLowerCase().includes('search'));
  if (isSearchInput) {
    return false;
  }

  // Must be inside an asset details/edit container, flyout, modal, or asset form
  const editContainer = target.closest(
    '.asset-details, [ng-controller*="asset" i], [class*="asset-edit" i], [class*="asset-detail" i], ' +
    '.flyout:not(.ng-hide), .iq-flyout, iq-flyout, .modal:not(.ng-hide)'
  );
  if (!editContainer) {
    const isAssetPage = window.location.href.includes('/agent/assets/') ||
      window.location.href.includes('flyout-type=agent-asset') ||
      window.location.href.includes('/assets/');
    const isMainContent = target.closest('main, .main-content, form, .content-container, .page-content');
    if (!isAssetPage || !isMainContent) {
      return false;
    }
  }

  // Ensure a primary save button exists for this asset
  return Boolean(findPrimarySaveButton());
}

function maybeShowAssetShortcutHint(target) {
  try {
    if (sessionStorage.getItem('smoothiiq_asset_hint_seen')) return;
  } catch (e) { }

  if (!isInsideAssetEditForm(target)) return;

  try {
    sessionStorage.setItem('smoothiiq_asset_hint_seen', '1');
  } catch (e) { }

  const shortcut = isMacUser() ? '⌘+Enter' : 'CTRL+Enter';
  const hintText = `By the way, when you're done editing this asset try ${shortcut} to rapidly save changes`;

  showCacheNotification(hintText, false, 6000);
}

function initAssetHintListeners() {
  document.addEventListener('focusin', function (e) {
    const target = e.target;
    if (target) {
      if (target.closest('spark-ticket-activities-add-comment, .spark-ticket-activities-add-comment') || (target.tagName === 'IFRAME' && target.closest('.spark-ticket-activities-add-comment'))) {
        maybeShowCommentShortcutHint(target);
      } else if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.closest('.ui-select-container') || target.tagName === 'SELECT') {
        maybeShowAssetShortcutHint(target);
      }
    }
  }, { passive: true });
}

function initializeContentScript() {
  initShortcutHandlers();
  initAssetHintListeners();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
  initializeContentScript();
}