// 2025 Osaym Omar - SmoothIIQ Content Script v1.4 (Dark Mode Removed)

// 1. Initialize State
chrome.storage.local.get('isEnabled', function(data) {
  if (data.isEnabled !== false) {
    enableBlocking();
  }
});

// 2. Listen for Changes
chrome.storage.onChanged.addListener(function(changes) {
  if (changes.isEnabled) {
    if (changes.isEnabled.newValue) enableBlocking();
    else disableBlocking();
  }
});

// 3. Inject Cache Interceptor
const script = document.createElement('script');
script.src = chrome.runtime.getURL('cache_interceptor.js');
script.onload = function() { this.remove(); };
(document.head || document.documentElement).appendChild(script);

// 4. Message Handling
window.addEventListener('message', function(event) {
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
    chrome.storage.local.set({ 'lastSyncTime': event.data.timestamp });
  }
  if (event.data.type === 'SMOOTHIIQ_STATS_DATA') {
    chrome.storage.local.set({ 'cacheStats': event.data.stats });
  }
});

chrome.runtime.onMessage.addListener(function(request) {
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

function showCacheNotification(message, isLoading = true, duration = 0, progress = -1, subProgress = -1) {
  let toast = document.getElementById('smoothiiq-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'smoothiiq-toast';
    document.body.appendChild(toast);
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

  if (duration > 0) {
    setTimeout(() => { toast.classList.remove('show'); }, duration);
  }
}