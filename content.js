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

function initShortcutHandlers() {
  window.addEventListener('keydown', function (e) {
    const isModifier = e.metaKey || e.ctrlKey;
    if (!isModifier || (e.key !== 'Enter' && e.keyCode !== 13)) {
      return;
    }

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

// --- 6. Non-obtrusive Asset Shortcut Tip Toast ---
function isMacUser() {
  return (typeof navigator !== 'undefined') && (
    (navigator.platform && navigator.platform.toUpperCase().indexOf('MAC') >= 0) ||
    (navigator.userAgent && navigator.userAgent.toUpperCase().indexOf('MAC') >= 0)
  );
}

function isInsideAssetEditForm(target) {
  if (!target) return false;

  // 1. Explicitly ignore global search bars, header, navbar, and search dropdowns
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

  // 2. Must be inside an asset details/edit container, flyout, modal, or asset form
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

  // 3. Ensure a primary save button exists for this asset
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
  // Trigger ONLY when focusing an editable input/field inside the actual asset edit form
  document.addEventListener('focusin', function (e) {
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.closest('.ui-select-container') || target.tagName === 'SELECT')) {
      maybeShowAssetShortcutHint(target);
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