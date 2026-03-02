// popup.js - v1.3.1 (Dark Mode Removed)
// 2025 Osaym Omar

document.addEventListener('DOMContentLoaded', function() {
  const toggleButton = document.getElementById('toggleButton');
  const refreshButton = document.getElementById('refreshButton');

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
  });
  
  chrome.storage.local.get('cacheStats', function(data) {
    if (data.cacheStats) {
      renderStats(data.cacheStats);
    }
  });

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