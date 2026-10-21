// 2026 Osaym Omar - SmoothIIQ Popup v1.4

const UPDATE_REPO_OWNER = 'osaym';
const UPDATE_REPO_NAME = 'SmoothIIQ';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_STORAGE_KEY = 'updateInfo';
const FALLBACK_RELEASE_URL = `https://github.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases/latest`;
const MANIFEST_API_URL = `https://api.github.com/repos/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/contents/manifest.json?ref=main`;
const CHROME_WEBSTORE_URL = 'https://chromewebstore.google.com/detail/osayms-smoothiiq/odacipeffkmakacijjkbabgaannhbpba';

document.addEventListener('DOMContentLoaded', function () {
  const toggleButton = document.getElementById('toggleButton');
  const refreshButton = document.getElementById('refreshButton');

  setInstalledVersionLabel();
  initializeUpdateNotice();

  // 1. Initialize Toggle UI
  chrome.storage.local.get('isEnabled', function (data) {
    if (toggleButton) {
      updateUI(data.isEnabled !== false);
    }
  });

  // Detect active tab and render appropriate context UI
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const activeTab = tabs && tabs[0];
    const isIIQ = !!(activeTab && activeTab.url && activeTab.url.includes('incidentiq.com'));

    if (isIIQ && activeTab.url) {
      try {
        const origin = new URL(activeTab.url).origin;
        chrome.storage.local.set({ lastKnownTenantUrl: origin });
      } catch (e) { }
    }

    chrome.storage.local.get('lastKnownTenantUrl', function (data) {
      const tenantUrl = data.lastKnownTenantUrl || 'https://incidentiq.com';
      renderTabContext(isIIQ, tenantUrl);
    });
  });

  // 2. Initialize Cache Status & Request Update
  updateCacheStatus();
  requestStatsUpdate();

  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (changes.savingsStats || changes.timeSpentOnIIQ || changes.installDate || areaName === 'sync') {
      loadAndRenderAggregateMetrics();
    }
    if (changes.cacheStats) {
      renderStats(changes.cacheStats.newValue);
    }
    if (changes.lastSyncTime) {
      updateCacheStatus();
    }
    if (changes[UPDATE_STORAGE_KEY]) {
      renderUpdateNotice(changes[UPDATE_STORAGE_KEY].newValue);
    }
  });

  chrome.storage.local.get(['cacheStats', 'installDate'], function (data) {
    if (data.cacheStats) {
      renderStats(data.cacheStats);
    }
    let installDate = data.installDate;
    if (!installDate) {
      installDate = Date.now();
      chrome.storage.local.set({ installDate: installDate });
    }
    loadAndRenderAggregateMetrics();
  });

  checkForUpdates(false);

  // --- Handlers ---

  if (toggleButton) {
    toggleButton.addEventListener('click', function () {
      chrome.storage.local.get('isEnabled', function (data) {
        const currentState = data.isEnabled !== false;
        const newState = !currentState;
        chrome.storage.local.set({ isEnabled: newState }, function () {
          updateUI(newState);
        });
      });
    });
  }

  if (refreshButton) {
    refreshButton.addEventListener('click', function () {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0] && tabs[0].url && tabs[0].url.includes('incidentiq.com')) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "FORCE_RESYNC" }, function () {
            if (chrome.runtime.lastError) {
              const statusEl = document.getElementById('cacheStatus');
              if (statusEl) statusEl.textContent = "Open IncidentIQ first!";
              return;
            }
          });
          const statusEl = document.getElementById('cacheStatus');
          if (statusEl) {
            statusEl.textContent = "Command sent... check screen!";
            setTimeout(updateCacheStatus, 2000);
          }
        } else {
          const statusEl = document.getElementById('cacheStatus');
          if (statusEl) statusEl.textContent = "Open IncidentIQ first!";
        }
      });
    });
  }

  const resetSavingsBtn = document.getElementById('resetSavingsBtn');
  if (resetSavingsBtn) {
    resetSavingsBtn.addEventListener('click', function () {
      chrome.storage.local.set({
        savingsStats: { bytes: 0, timeMs: 0, requests: 0, trackers: 0 },
        timeSpentOnIIQ: 0
      }, function () {
        if (chrome.storage && chrome.storage.sync) {
          try {
            chrome.storage.sync.get(null, function (syncItems) {
              const devKeys = Object.keys(syncItems || {}).filter(k => k.startsWith('siiq_dev_'));
              if (devKeys.length > 0) {
                chrome.storage.sync.remove(devKeys, function () {
                  loadAndRenderAggregateMetrics();
                });
              } else {
                loadAndRenderAggregateMetrics();
              }
            });
          } catch (e) {
            loadAndRenderAggregateMetrics();
          }
        } else {
          loadAndRenderAggregateMetrics();
        }
        showFeedback("Metrics reset across all devices.");
      });
    });
  }

  const exportMetricsBtn = document.getElementById('exportMetricsBtn');
  if (exportMetricsBtn) {
    exportMetricsBtn.addEventListener('click', handleExport);
  }

  const importMetricsBtn = document.getElementById('importMetricsBtn');
  if (importMetricsBtn) {
    importMetricsBtn.addEventListener('click', handleImport);
  }
});

function setInstalledVersionLabel() {
  const versionEl = document.getElementById('versionText');
  if (!versionEl) return;
  versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
}

function initializeUpdateNotice() {
  chrome.storage.local.get(UPDATE_STORAGE_KEY, function (data) {
    renderUpdateNotice(data[UPDATE_STORAGE_KEY]);
  });
}

function renderUpdateNotice(updateInfo) {
  const noticeEl = document.getElementById('updateNotice');
  const textEl = document.getElementById('updateText');
  const storeLinkEl = document.getElementById('storeUpdateLink');
  const linkEl = document.getElementById('updateLink');

  if (!noticeEl || !textEl) return;

  if (!updateInfo || !updateInfo.isOutdated) {
    noticeEl.classList.add('hidden');
    return;
  }

  const latest = updateInfo.latestVersion ? `v${updateInfo.latestVersion}` : 'a newer version';
  const installed = updateInfo.installedVersion ? `v${updateInfo.installedVersion}` : 'your current version';
  textEl.textContent = `You're on ${installed}. Latest is ${latest}.`;
  if (storeLinkEl) {
    storeLinkEl.href = CHROME_WEBSTORE_URL;
  }
  if (linkEl) {
    linkEl.href = updateInfo.releaseUrl || FALLBACK_RELEASE_URL;
  }
  noticeEl.classList.remove('hidden');
}

function normalizeVersion(versionString) {
  if (!versionString) return '';
  return String(versionString).trim().replace(/^v/i, '');
}

function compareVersions(left, right) {
  const leftParts = normalizeVersion(left).split('.').map(n => parseInt(n, 10) || 0);
  const rightParts = normalizeVersion(right).split('.').map(n => parseInt(n, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let i = 0; i < length; i++) {
    const l = leftParts[i] || 0;
    const r = rightParts[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function isVersionLike(value) {
  return /^\d+(\.\d+){1,3}$/.test(normalizeVersion(value));
}

function extractVersionFromManifestContent(apiPayload) {
  if (!apiPayload || !apiPayload.content) return '';
  try {
    const decoded = atob(String(apiPayload.content).replace(/\n/g, ''));
    const parsed = JSON.parse(decoded);
    return normalizeVersion(parsed.version);
  } catch (error) {
    return '';
  }
}

function checkForUpdates(force) {
  chrome.storage.local.get(UPDATE_STORAGE_KEY, async function (data) {
    const existingInfo = data[UPDATE_STORAGE_KEY] || null;
    const now = Date.now();
    const installedVersion = normalizeVersion(chrome.runtime.getManifest().version);

    const canUseCache = !force
      && existingInfo
      && existingInfo.checkedAt
      && existingInfo.installedVersion === installedVersion
      && (now - existingInfo.checkedAt) < UPDATE_CHECK_INTERVAL_MS;

    if (canUseCache) {
      renderUpdateNotice(existingInfo);
      return;
    }

    try {
      const [releaseResponse, manifestResponse] = await Promise.all([
        fetch(`https://api.github.com/repos/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases/latest`),
        fetch(MANIFEST_API_URL)
      ]);

      if (!releaseResponse.ok) throw new Error(`GitHub Release API failed: ${releaseResponse.status}`);

      const release = await releaseResponse.json();

      let latestVersion = '';
      if (manifestResponse.ok) {
        const manifestPayload = await manifestResponse.json();
        latestVersion = extractVersionFromManifestContent(manifestPayload);
      }

      if (!latestVersion && isVersionLike(release.tag_name)) {
        latestVersion = normalizeVersion(release.tag_name);
      }

      const isOutdated = !!latestVersion && compareVersions(latestVersion, installedVersion) > 0;

      const updateInfo = {
        checkedAt: now,
        installedVersion,
        latestVersion,
        isOutdated,
        releaseUrl: release.html_url || FALLBACK_RELEASE_URL
      };

      chrome.storage.local.set({ [UPDATE_STORAGE_KEY]: updateInfo }, function () {
        renderUpdateNotice(updateInfo);
      });
    } catch (error) {
      if (existingInfo && existingInfo.installedVersion === installedVersion) {
        renderUpdateNotice(existingInfo);
        return;
      }

      const fallbackInfo = {
        checkedAt: now,
        installedVersion,
        latestVersion: '',
        isOutdated: false,
        releaseUrl: FALLBACK_RELEASE_URL
      };

      chrome.storage.local.set({ [UPDATE_STORAGE_KEY]: fallbackInfo }, function () {
        renderUpdateNotice(fallbackInfo);
      });
    }
  });
}

function requestStatsUpdate() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0] && tabs[0].url && tabs[0].url.includes('incidentiq.com')) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "GET_CACHE_STATS" }, function () {
        if (chrome.runtime.lastError) {
          return;
        }
      });
    }
  });
}

function renderStats(stats) {
  if (!stats) return;

  const elStatus = document.getElementById('stat-status');
  const elLocs = document.getElementById('stat-locations');
  const select = document.getElementById('room-breakdown');

  if (elStatus) elStatus.textContent = stats.statuses || 0;
  if (elLocs) elLocs.textContent = stats.locations || 0;

  if (select) {
    select.innerHTML = '';

    if (stats.rooms && stats.rooms.length > 0) {
      const totalRooms = stats.rooms.reduce((acc, r) => acc + r.count, 0);
      const defaultOpt = document.createElement('option');
      defaultOpt.text = `View Room Counts (${totalRooms} total)`;
      select.add(defaultOpt);

      stats.rooms.forEach(room => {
        const opt = document.createElement('option');
        opt.text = `${room.name} (${room.count})`;
        select.add(opt);
      });
    } else {
      const opt = document.createElement('option');
      opt.text = "No rooms cached yet";
      select.add(opt);
    }
  }
}

function formatTimeSaved(timeMs) {
  const ms = Math.max(0, Number(timeMs) || 0);
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = Math.round(secs % 60);
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hours = (secs / 3600).toFixed(1);
  return `${hours}h`;
}

function formatBytesSaved(bytes) {
  const b = Math.max(0, Number(bytes) || 0);
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function renderSavings(stats) {
  const timeEl = document.getElementById('timeSaved');
  const dataEl = document.getElementById('dataSaved');
  const requestsEl = document.getElementById('requestsSaved');
  const trackersEl = document.getElementById('trackersBlocked');

  const s = stats || { bytes: 0, timeMs: 0, requests: 0, trackers: 0 };

  if (timeEl) timeEl.textContent = formatTimeSaved(s.timeMs);
  if (dataEl) dataEl.textContent = formatBytesSaved(s.bytes);
  if (requestsEl) requestsEl.textContent = (Number(s.requests) || 0).toLocaleString();
  if (trackersEl) trackersEl.textContent = (Number(s.trackers) || 0).toLocaleString();
}

function renderMeta(installDate, timeSpentOnIIQ) {
  const installEl = document.getElementById('installDate');
  const timeSpentEl = document.getElementById('timeSpentOnIIQ');

  if (installEl) installEl.textContent = formatDate(installDate);
  if (timeSpentEl) timeSpentEl.textContent = formatDuration(timeSpentOnIIQ);
}

function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDuration(ms) {
  const totalSecs = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (totalSecs < 60) return `${totalSecs}s`;
  const totalMins = Math.floor(totalSecs / 60);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const remMins = totalMins % 60;
  return `${hours}h ${remMins}m`;
}

function showFeedback(msg) {
  const el = document.getElementById('actionFeedback');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => {
    el.classList.add('hidden');
  }, 3500);
}

const METRICS_SECRET_PEPPER = "SmoothIIQ_Secure_v1_BraggingRights_Salt_998124_Prod";
const OBFUSCATION_KEY = "SmoothIIQ_Obfuscator_2026";

async function generateSignature(data) {
  const canonical = `${data.installDate}:${data.timeSpentOnIIQ}:${data.bytes}:${data.timeMs}:${data.requests}:${data.trackers}:${METRICS_SECRET_PEPPER}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(canonical));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function xorEncode(str) {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    out += String.fromCharCode(str.charCodeAt(i) ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length));
  }
  return btoa(unescape(encodeURIComponent(out)));
}

function xorDecode(b64) {
  const raw = decodeURIComponent(escape(atob(b64)));
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    out += String.fromCharCode(raw.charCodeAt(i) ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length));
  }
  return out;
}

async function createTamperProofToken(data) {
  const sig = await generateSignature(data);
  const bundle = {
    v: 1,
    id: data.installDate,
    ts: data.timeSpentOnIIQ,
    by: data.bytes,
    tm: data.timeMs,
    rq: data.requests,
    tr: data.trackers,
    sig: sig
  };
  return `SIIQ1-${xorEncode(JSON.stringify(bundle))}`;
}

async function verifyAndParseToken(input) {
  if (!input || typeof input !== 'string') throw new Error("Empty input");

  const match = input.match(/SIIQ1-([A-Za-z0-9+/=]+)/);
  if (!match) {
    throw new Error("No valid SmoothIIQ certified token found");
  }

  const b64 = match[1];
  let bundle;
  try {
    const jsonStr = xorDecode(b64);
    bundle = JSON.parse(jsonStr);
  } catch(e) {
    throw new Error("Corrupted or invalid token format");
  }

  if (!bundle || bundle.v !== 1 || !bundle.sig) {
    throw new Error("Invalid token structure");
  }

  const data = {
    installDate: Number(bundle.id) || 0,
    timeSpentOnIIQ: Number(bundle.ts) || 0,
    bytes: Number(bundle.by) || 0,
    timeMs: Number(bundle.tm) || 0,
    requests: Number(bundle.rq) || 0,
    trackers: Number(bundle.tr) || 0
  };

  // 1. Verify cryptographic SHA-256 signature
  const expectedSig = await generateSignature(data);
  if (bundle.sig !== expectedSig) {
    throw new Error("Tamper detected: Signature mismatch! Stats have been modified.");
  }

  // 2. Sanity check metrics
  const now = Date.now();
  if (data.installDate > now + 300000) {
    throw new Error("Invalid install timestamp (from the future)");
  }
  if (data.timeSpentOnIIQ < 0 || data.bytes < 0 || data.timeMs < 0 || data.requests < 0 || data.trackers < 0) {
    throw new Error("Negative numbers detected");
  }

  return data;
}

function loadAndRenderAggregateMetrics(callback) {
  if (!chrome.storage) return;

  function calculateAndRender(syncData, localData) {
    const myDeviceId = localData.siiq_device_id;
    const myKey = myDeviceId ? `siiq_dev_${myDeviceId}` : null;
    const deviceMap = {};

    if (syncData && typeof syncData === 'object') {
      for (const [k, v] of Object.entries(syncData)) {
        if (k.startsWith('siiq_dev_') && v && typeof v === 'object') {
          deviceMap[k] = v;
        }
      }
    }

    // Always represent current device with freshest local data
    if (myKey) {
      deviceMap[myKey] = {
        bytes: (localData.savingsStats && localData.savingsStats.bytes) || 0,
        timeMs: (localData.savingsStats && localData.savingsStats.timeMs) || 0,
        requests: (localData.savingsStats && localData.savingsStats.requests) || 0,
        trackers: (localData.savingsStats && localData.savingsStats.trackers) || 0,
        timeSpentOnIIQ: Number(localData.timeSpentOnIIQ) || 0,
        installDate: localData.installDate || Date.now(),
        lastUpdated: Date.now()
      };
    }

    const devices = Object.values(deviceMap);
    const deviceCount = devices.length;

    let aggBytes = 0;
    let aggTimeMs = 0;
    let aggRequests = 0;
    let aggTrackers = 0;
    let aggTimeSpent = 0;
    let earliestInstall = Number(localData.installDate) || Date.now();

    if (devices.length > 0) {
      for (const dev of devices) {
        aggBytes += (Number(dev.bytes) || 0);
        aggTimeMs += (Number(dev.timeMs) || 0);
        aggRequests += (Number(dev.requests) || 0);
        aggTrackers += (Number(dev.trackers) || 0);
        aggTimeSpent += (Number(dev.timeSpentOnIIQ) || 0);
        if (dev.installDate && Number(dev.installDate) < earliestInstall) {
          earliestInstall = Number(dev.installDate);
        }
      }
    } else {
      aggBytes = (localData.savingsStats && localData.savingsStats.bytes) || 0;
      aggTimeMs = (localData.savingsStats && localData.savingsStats.timeMs) || 0;
      aggRequests = (localData.savingsStats && localData.savingsStats.requests) || 0;
      aggTrackers = (localData.savingsStats && localData.savingsStats.trackers) || 0;
      aggTimeSpent = Number(localData.timeSpentOnIIQ) || 0;
    }

    const aggregateSavings = {
      bytes: aggBytes,
      timeMs: aggTimeMs,
      requests: aggRequests,
      trackers: aggTrackers
    };

    renderSavings(aggregateSavings);
    renderMeta(earliestInstall, aggTimeSpent);

    const badge = document.getElementById('syncDeviceBadge');
    if (badge) {
      badge.classList.remove('hidden');
      if (deviceCount > 1) {
        badge.textContent = `🔄 ${deviceCount} devices synced`;
        badge.title = `Aggregated across ${deviceCount} devices via your Chrome profile`;
      } else {
        badge.textContent = `🔄 Device Sync`;
        badge.title = `Syncs metrics across devices signed into your Chrome profile`;
      }
    }

    if (typeof callback === 'function') {
      callback({
        savingsStats: aggregateSavings,
        timeSpentOnIIQ: aggTimeSpent,
        installDate: earliestInstall,
        deviceCount: deviceCount
      });
    }
  }

  if (chrome.storage.sync) {
    try {
      chrome.storage.sync.get(null, function (syncItems) {
        chrome.storage.local.get(['savingsStats', 'timeSpentOnIIQ', 'installDate', 'siiq_device_id'], function (localItems) {
          calculateAndRender(syncItems, localItems);
        });
      });
    } catch (e) {
      chrome.storage.local.get(['savingsStats', 'timeSpentOnIIQ', 'installDate', 'siiq_device_id'], function (localItems) {
        calculateAndRender({}, localItems);
      });
    }
  } else {
    chrome.storage.local.get(['savingsStats', 'timeSpentOnIIQ', 'installDate', 'siiq_device_id'], function (localItems) {
      calculateAndRender({}, localItems);
    });
  }
}

function handleExport() {
  loadAndRenderAggregateMetrics(async function (aggData) {
    const s = (aggData && aggData.savingsStats) || { bytes: 0, timeMs: 0, requests: 0, trackers: 0 };
    const installDate = (aggData && aggData.installDate) || Date.now();
    const timeSpentOnIIQ = (aggData && aggData.timeSpentOnIIQ) || 0;

    const exportData = {
      installDate: installDate,
      timeSpentOnIIQ: timeSpentOnIIQ,
      bytes: s.bytes || 0,
      timeMs: s.timeMs || 0,
      requests: s.requests || 0,
      trackers: s.trackers || 0
    };

    const token = await createTamperProofToken(exportData);

    const installStr = formatDate(installDate);
    const timeSpentStr = formatDuration(timeSpentOnIIQ);
    const timeSavedStr = formatTimeSaved(exportData.timeMs);
    const dataSavedStr = formatBytesSaved(exportData.bytes);
    const requestsStr = (Number(exportData.requests) || 0).toLocaleString();
    const trackersStr = (Number(exportData.trackers) || 0).toLocaleString();

    const reportText = [
      "🚀 SmoothIIQ Certified Performance Report (IncidentIQ)",
      `📅 First Installed: ${installStr}`,
      `⏳ Active Time on iiQ: ${timeSpentStr}`,
      "----------------------------------------",
      "⚡ Performance & Data Savings:",
      `• Wait Time Saved: ${timeSavedStr}`,
      `• Bandwidth Saved: ${dataSavedStr}`,
      `• Accelerated Requests: ${requestsStr}`,
      `• Trackers Blocked: ${trackersStr}`,
      "----------------------------------------",
      "🔒 Certified Tamper-Proof Token:",
      token
    ].join("\n");

    navigator.clipboard.writeText(reportText).then(() => {
      showFeedback("✓ Certified report copied & downloaded!");
    }).catch(() => {
      showFeedback("✓ Backup generated!");
    });

    try {
      const backupPayload = {
        token: token,
        exportedAt: new Date().toISOString()
      };
      const jsonStr = JSON.stringify(backupPayload, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonStr);
      const a = document.createElement('a');
      a.href = dataUri;
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      a.download = `SmoothIIQ-metrics-${timestamp}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 500);
    } catch (e) { }
  });
}

async function handleImport() {
  const input = window.prompt("Paste your SmoothIIQ certified token or exported report:");
  if (!input || !input.trim()) return;

  try {
    const verifiedData = await verifyAndParseToken(input);

    const newSavings = {
      bytes: verifiedData.bytes,
      timeMs: verifiedData.timeMs,
      requests: verifiedData.requests,
      trackers: verifiedData.trackers
    };

    chrome.storage.local.get('siiq_device_id', function (devData) {
      let devId = devData && devData.siiq_device_id;
      if (!devId) {
        devId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
        chrome.storage.local.set({ siiq_device_id: devId });
      }

      chrome.storage.local.set({
        savingsStats: newSavings,
        installDate: verifiedData.installDate,
        timeSpentOnIIQ: verifiedData.timeSpentOnIIQ
      }, function () {
        if (chrome.storage && chrome.storage.sync) {
          try {
            chrome.storage.sync.set({
              [`siiq_dev_${devId}`]: {
                bytes: newSavings.bytes,
                timeMs: newSavings.timeMs,
                requests: newSavings.requests,
                trackers: newSavings.trackers,
                timeSpentOnIIQ: verifiedData.timeSpentOnIIQ,
                installDate: verifiedData.installDate,
                lastUpdated: Date.now()
              }
            });
          } catch (e) { }
        }
        loadAndRenderAggregateMetrics();
        showFeedback("✓ Verified & restored successfully!");
      });
    });
  } catch (err) {
    showFeedback(`❌ ${err.message || "Invalid or tampered token."}`);
  }
}

function updateUI(isEnabled) {
  const toggleButton = document.getElementById('toggleButton');
  const message = document.querySelector('.message');

  if (toggleButton && message) {
    if (isEnabled) {
      toggleButton.textContent = 'Pause Optimization';
      toggleButton.classList.remove('disabled');
      message.innerHTML = "You're all set!<br>SmoothIIQ is running!";
    } else {
      toggleButton.textContent = 'Re-enable Optimization';
      toggleButton.classList.add('disabled');
      message.innerHTML = "Optimization is paused!<br>Click below to re-enable.";
    }
  }
}

function renderTabContext(isIIQ, tenantUrl) {
  const toggleButton = document.getElementById('toggleButton');
  const message = document.querySelector('.message');
  const cacheControl = document.querySelector('.cache-control');
  const nonIIQNotice = document.getElementById('nonIIQNotice');
  const tenantLink = document.getElementById('tenantLink');

  if (isIIQ) {
    if (toggleButton) toggleButton.classList.remove('hidden');
    if (message) message.classList.remove('hidden');
    if (cacheControl) cacheControl.classList.remove('hidden');
    if (nonIIQNotice) nonIIQNotice.classList.add('hidden');
  } else {
    if (toggleButton) toggleButton.classList.add('hidden');
    if (message) message.classList.add('hidden');
    if (cacheControl) cacheControl.classList.add('hidden');
    if (nonIIQNotice) {
      nonIIQNotice.classList.remove('hidden');
      if (tenantLink) {
        tenantLink.href = tenantUrl;
        let hostDisplay = 'IncidentIQ';
        try {
          const parsedHost = new URL(tenantUrl).hostname;
          if (parsedHost && parsedHost !== 'incidentiq.com') {
            hostDisplay = parsedHost;
          }
        } catch (e) { }
        tenantLink.textContent = `Launch ${hostDisplay} \u2192`;
      }
    }
  }
}

function updateCacheStatus() {
  chrome.storage.local.get('lastSyncTime', function (data) {
    const statusEl = document.getElementById('cacheStatus');
    if (!statusEl) return;

    if (!data.lastSyncTime) {
      statusEl.textContent = "No cache data yet.";
      return;
    }

    const diffMs = Date.now() - data.lastSyncTime;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) {
      statusEl.textContent = "Last cached: Just now";
    } else if (diffMins === 1) {
      statusEl.textContent = "Last cached: 1 min ago";
    } else if (diffMins > 60) {
      statusEl.textContent = "Last cached: > 1 hour ago";
    } else {
      statusEl.textContent = `Last cached: ${diffMins} mins ago`;
    }
  });
}