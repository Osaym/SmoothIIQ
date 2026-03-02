// 2026 Osaym Omar - SmoothIIQ Popup v1.2

const UPDATE_REPO_OWNER = 'osaym';
const UPDATE_REPO_NAME = 'SmoothIIQ';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_STORAGE_KEY = 'updateInfo';
const FALLBACK_RELEASE_URL = `https://github.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases/latest`;
const MANIFEST_API_URL = `https://api.github.com/repos/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/contents/manifest.json?ref=main`;

document.addEventListener('DOMContentLoaded', function() {
  const toggleButton = document.getElementById('toggleButton');
  const refreshButton = document.getElementById('refreshButton');

  setInstalledVersionLabel();
  initializeUpdateNotice();

  // 1. Initialize Toggle UI
  chrome.storage.local.get('isEnabled', function(data) {
    if (toggleButton) { 
        updateUI(data.isEnabled !== false); 
    }
  });

  // 2. Initialize Cache Status & Request Update
  updateCacheStatus();
  requestStatsUpdate();
  
  chrome.storage.onChanged.addListener(function(changes) {
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
  
  chrome.storage.local.get('cacheStats', function(data) {
    if (data.cacheStats) {
      renderStats(data.cacheStats);
    }
  });

  checkForUpdates(false);

  // --- Handlers ---

  if (toggleButton) {
      toggleButton.addEventListener('click', function() {
        chrome.storage.local.get('isEnabled', function(data) {
          const currentState = data.isEnabled !== false;
          const newState = !currentState;
          chrome.storage.local.set({ isEnabled: newState }, function() {
            updateUI(newState);
          });
        });
      });
  }

  if (refreshButton) {
      refreshButton.addEventListener('click', function() {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          if (tabs[0] && tabs[0].url && tabs[0].url.includes('incidentiq.com')) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "FORCE_RESYNC" }, function() {
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
});

function setInstalledVersionLabel() {
  const versionEl = document.getElementById('versionText');
  if (!versionEl) return;
  versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
}

function initializeUpdateNotice() {
  chrome.storage.local.get(UPDATE_STORAGE_KEY, function(data) {
    renderUpdateNotice(data[UPDATE_STORAGE_KEY]);
  });
}

function renderUpdateNotice(updateInfo) {
  const noticeEl = document.getElementById('updateNotice');
  const textEl = document.getElementById('updateText');
  const linkEl = document.getElementById('updateLink');

  if (!noticeEl || !textEl || !linkEl) return;

  if (!updateInfo || !updateInfo.isOutdated) {
    noticeEl.classList.add('hidden');
    return;
  }

  const latest = updateInfo.latestVersion ? `v${updateInfo.latestVersion}` : 'a newer version';
  const installed = updateInfo.installedVersion ? `v${updateInfo.installedVersion}` : 'your current version';
  textEl.textContent = `You're on ${installed}. Latest is ${latest}.`;
  linkEl.href = updateInfo.releaseUrl || FALLBACK_RELEASE_URL;
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
  chrome.storage.local.get(UPDATE_STORAGE_KEY, async function(data) {
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

      chrome.storage.local.set({ [UPDATE_STORAGE_KEY]: updateInfo }, function() {
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

      chrome.storage.local.set({ [UPDATE_STORAGE_KEY]: fallbackInfo }, function() {
        renderUpdateNotice(fallbackInfo);
      });
    }
  });
}

function requestStatsUpdate() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes('incidentiq.com')) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "GET_CACHE_STATS" }, function() {
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

function updateCacheStatus() {
    chrome.storage.local.get('lastSyncTime', function(data) {
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