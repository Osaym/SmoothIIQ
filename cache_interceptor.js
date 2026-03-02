// 2026 Osaym Omar - SmoothIIQ Cache Layer v1.2
// Runs in "Main World" to intercept XHR and manage caching via IndexedDB.

(function() {
    const CACHE_DURATION_MS = 60 * 60 * 1000; // 60 Minutes
    const CHECK_INTERVAL_MS = 15 * 60 * 1000; // Check every 15 minutes
    const DB_NAME = 'SmoothIIQ_DB';
    const DB_VERSION = 1;
    const STORE_NAME = 'network_cache';

    // Enable Verbose Logging to Console for debugging
    const DEBUG_MODE = true;

    const CANONICAL = {
        LOCATIONS: '/api/v1.0/locations/all?$s=999999',
        STATUS:    '/api/v1.0/assets/status/types?$s=999999'
    };

    const DETECTORS = {
        LOCATIONS: /api\/v1\.0\/locations\/all/i,
        STATUS:    /api\/v1\.0\/assets\/status\/types/i,
        ROOMS:     /api\/v1\.0\/locations\/([a-zA-Z0-9-]+)\/rooms/i, // Standard List
        ROOMS_SEARCH: /api\/v1\.0\/locations\/rooms\/([a-zA-Z0-9-]+)\/search/i // Search/Filter
    };

    function log(type, msg, data) {
        if (DEBUG_MODE) {
            const color = type === 'HIT' ? '#27ae60' : (type === 'MISS' ? '#c0392b' : '#2980b9');
            console.log(`%c [SmoothIIQ] ${type}: ${msg}`, `color: ${color}; font-weight: bold;`, data || '');
        }
    }

    // --- Communication Helpers ---
    function notifyUI(msg, isLoading = true, duration = 0, progress = -1, subProgress = -1) {
        window.postMessage({
            type: 'SMOOTHIIQ_TOAST',
            text: msg,
            isLoading: isLoading,
            duration: duration,
            progress: progress,
            subProgress: subProgress
        }, '*');
    }

    function broadcastSyncSuccess() {
        window.postMessage({ type: 'SMOOTHIIQ_SYNC_SUCCESS', timestamp: Date.now() }, '*');
        broadcastStats();
    }

    // --- IndexedDB Storage Engine ---
    const DB = {
        open: () => {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME);
                    }
                };
                request.onsuccess = (e) => resolve(e.target.result);
                request.onerror = (e) => reject(e);
            });
        },
        get: async (key) => {
            try {
                const db = await DB.open();
                return new Promise((resolve) => {
                    const tx = db.transaction(STORE_NAME, 'readonly');
                    const store = tx.objectStore(STORE_NAME);
                    const req = store.get(key);
                    req.onsuccess = () => {
                        const result = req.result;
                        if (!result) resolve(null);
                        else if (Date.now() - result.timestamp > CACHE_DURATION_MS) {
                            DB.del(key); 
                            resolve(null);
                        } else {
                            resolve(result.data);
                        }
                    };
                    req.onerror = () => resolve(null);
                });
            } catch (e) { return null; }
        },
        put: async (key, data) => {
            try {
                const db = await DB.open();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(STORE_NAME, 'readwrite');
                    const store = tx.objectStore(STORE_NAME);
                    store.put({ timestamp: Date.now(), data: data }, key);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject();
                });
            } catch (e) { console.error('IDB Put Error', e); }
        },
        del: async (key) => {
            try {
                const db = await DB.open();
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).delete(key);
            } catch(e) {}
        }
    };

    // --- Search Helpers ---
    function getSearchTerm(url) {
        try {
            const decoded = decodeURIComponent(url);
            let match = decoded.match(/(?:SearchText|q|query)=([^&]+)/i);
            if (match && match[1]) return match[1];
            match = decoded.match(/contains.*?['"]([^'"]+)['"]/i);
            if (match && match[1]) return match[1];
            match = decoded.match(/\w+\s+eq\s+['"]([^'"]+)['"]/i);
            if (match && match[1]) return match[1];
            return null;
        } catch(e) { return null; }
    }

    function filterData(jsonStr, term) {
        if (!term) return jsonStr;
        try {
            const json = JSON.parse(jsonStr);
            const isWrapped = !Array.isArray(json) && json.Items;
            const items = isWrapped ? json.Items : json;
            if (!Array.isArray(items)) return jsonStr;
            const lowerTerm = term.toLowerCase();
            const scoredItems = items.map(item => {
                let score = 0;
                for (const val of Object.values(item)) {
                    if (val === null || val === undefined) continue;
                    const str = String(val).toLowerCase();
                    if (str === lowerTerm) { score = 3; break; } 
                    if (str.startsWith(lowerTerm)) { score = Math.max(score, 2); } 
                    else if (str.includes(lowerTerm)) { score = Math.max(score, 1); }
                }
                return { item, score };
            });
            const filtered = scoredItems
                .filter(x => x.score > 0)
                .sort((a, b) => b.score - a.score)
                .map(x => x.item);
            if (isWrapped) {
                json.Items = filtered;
                if (typeof json.ItemCount !== 'undefined') json.ItemCount = filtered.length;
                return JSON.stringify(json);
            } else {
                return JSON.stringify(filtered);
            }
        } catch(e) { return jsonStr; }
    }

    // --- 1. XHR Interceptor ---
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        this._method = method;
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        if (this._method !== 'GET') return originalSend.apply(this, arguments);

        let dbKeyToUse = null;

        if (DETECTORS.LOCATIONS.test(this._url)) {
            dbKeyToUse = CANONICAL.LOCATIONS;
        } 
        else if (DETECTORS.STATUS.test(this._url)) {
            dbKeyToUse = CANONICAL.STATUS;
        } 
        else {
            let roomMatch = this._url.match(DETECTORS.ROOMS);
            if (!roomMatch) roomMatch = this._url.match(DETECTORS.ROOMS_SEARCH);

            if (roomMatch && roomMatch[1]) {
                const schoolId = roomMatch[1];
                dbKeyToUse = `/api/v1.0/locations/${schoolId}/rooms?$s=999999`;
            }
        }

        if (!dbKeyToUse) return originalSend.apply(this, arguments);

        const self = this;
        const args = arguments;

        DB.get(dbKeyToUse).then(cachedResponse => {
            if (cachedResponse) {
                log('HIT', self._url);
                
                const searchTerm = getSearchTerm(self._url);
                let finalResponse = cachedResponse;
                
                if (searchTerm) {
                    finalResponse = filterData(cachedResponse, searchTerm);
                }

                try {
                    Object.defineProperty(self, 'readyState', { writable: true, value: 4 });
                    Object.defineProperty(self, 'status', { writable: true, value: 200 });
                    try { Object.defineProperty(self, 'statusText', { writable: true, value: 'OK' }); } catch(e) {} 
                    
                    Object.defineProperty(self, 'responseText', { writable: true, value: finalResponse });
                    Object.defineProperty(self, 'response', { writable: true, value: finalResponse });
                    
                    try { Object.defineProperty(self, 'responseURL', { writable: true, value: self._url }); } catch(e) {}
                    
                    self.getAllResponseHeaders = function() { return "Content-Type: application/json"; };
                } catch (e) {
                    log('WARN', 'Mocking properties failed, but dispatching load anyway', e);
                }

                if (self.onreadystatechange) self.onreadystatechange.call(self);
                if (self.onload) self.onload.call(self);
                
                self.dispatchEvent(new Event('load'));
            } else {
                log('MISS', self._url, '(Not in DB)');
                originalSend.apply(self, args);
            }
        });
    };

    // --- 2. UI Logic ---
    function initRoomClearer() {
        document.addEventListener('click', (e) => {
            const item = e.target.closest('.ui-select-choices-row');
            if (!item) return;
            const selectContainer = item.closest('.ui-select-container');
            if (!selectContainer) return;
            const ngModel = selectContainer.getAttribute('ng-model') || "";
            if (ngModel.toLowerCase().includes('location') || ngModel.toLowerCase().includes('site')) {
                setTimeout(() => {
                    if (typeof angular === 'undefined') return;
                    const roomSelects = document.querySelectorAll('[ng-model*="Room"], [ng-model*="room"]');
                    roomSelects.forEach(roomSel => {
                        try {
                            const scope = angular.element(roomSel).scope();
                            if (!scope) return;
                            const modelPath = roomSel.getAttribute('ng-model');
                            const parts = modelPath.split('.');
                            let target = scope;
                            for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
                            if (target) {
                                target[parts[parts.length-1]] = null; 
                                scope.$apply(); 
                            }
                        } catch(err) {}
                    });
                }, 100);
            }
        }, true);
    }
    
    if (document.readyState === 'complete') initRoomClearer();
    else window.addEventListener('load', initRoomClearer);


    // --- 3. Stats Logic ---
    async function broadcastStats() {
        try {
            const db = await DB.open();
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            
            const getAllKeysReq = store.getAllKeys();

            getAllKeysReq.onsuccess = () => {
                const keys = getAllKeysReq.result;
                const getAllReq = store.getAll();

                getAllReq.onsuccess = () => {
                    const values = getAllReq.result;
                    if (!keys || !values) return;

                    let stats = { locations: 0, statuses: 0, rooms: [] };
                    let locationMap = {}; 

                    values.forEach((entry, i) => {
                        const url = keys[i];
                        if (url === CANONICAL.LOCATIONS) {
                            try {
                                const data = JSON.parse(entry.data);
                                const items = Array.isArray(data) ? data : (data.Items || []);
                                stats.locations = items.length;
                                items.forEach(loc => {
                                    if (loc.LocationId) locationMap[loc.LocationId] = loc.Name || "Unknown";
                                });
                            } catch(e) {}
                        }
                    });

                    values.forEach((entry, i) => {
                        const url = keys[i];
                        try {
                            const data = JSON.parse(entry.data);
                            const items = Array.isArray(data) ? data : (data.Items || []);
                            const count = items.length;

                            if (url === CANONICAL.STATUS) stats.statuses = count;
                            else {
                                let roomMatch = url.match(DETECTORS.ROOMS);
                                if (!roomMatch) roomMatch = url.match(DETECTORS.ROOMS_SEARCH);
                                if (roomMatch && roomMatch[1]) {
                                    const schoolId = roomMatch[1];
                                    const schoolName = locationMap[schoolId] || `ID: ${schoolId.substr(0,8)}...`;
                                    stats.rooms.push({ name: schoolName, count: count });
                                }
                            }
                        } catch(e) {}
                    });

                    stats.rooms.sort((a, b) => a.name.localeCompare(b.name));
                    window.postMessage({ type: 'SMOOTHIIQ_STATS_DATA', stats: stats }, '*');
                };
            };
        } catch(e) { console.error("Stats Error", e); }
    }


    // --- 4. Prefetch Logic ---
    async function prefetchGlobals(force = false) {
        let queue = [];
        const fetchAndCache = async (url) => {
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(res.statusText);
                const txt = await res.text();
                await DB.put(url, txt);
                log('INFO', `Cached: ${url}`);
                return txt;
            } catch(e) { 
                log('MISS', `Failed to fetch ${url}`, e);
                return null; 
            }
        };

        let locDataRaw = await DB.get(CANONICAL.LOCATIONS);
        if (force || !locDataRaw) queue.push(CANONICAL.LOCATIONS);
        if (force || !(await DB.get(CANONICAL.STATUS))) queue.push(CANONICAL.STATUS);

        if (queue.length === 0 && !force) {
            broadcastSyncSuccess();
            return; 
        }

        notifyUI("Initializing Cache Sync...", true, 0, 0, 0);

        for (let i = 0; i < queue.length; i++) {
            const url = queue[i];
            const catPct = Math.round(((i) / queue.length) * 100);
            const globalPct = Math.round(((i) / queue.length) * 10); 

            notifyUI(`Fetching Core Lists... ${i + 1}/${queue.length}`, true, 0, globalPct, catPct);

            if (url === CANONICAL.LOCATIONS) {
                locDataRaw = await fetchAndCache(url);
            } else {
                await fetchAndCache(url);
            }
        }

        let roomQueue = [];
        if (locDataRaw) {
            try {
                const json = JSON.parse(locDataRaw);
                const locations = Array.isArray(json) ? json : (json.Items || []);
                for (const loc of locations) {
                    if (loc.LocationId) {
                        const roomUrl = `/api/v1.0/locations/${loc.LocationId}/rooms?$s=999999`;
                        if (force || !(await DB.get(roomUrl))) {
                            roomQueue.push(roomUrl);
                        }
                    }
                }
            } catch(e) {}
        }

        if (roomQueue.length === 0) {
            notifyUI("Cache Sync Complete!", false, 3000, 100, 100);
            broadcastSyncSuccess();
            return;
        }

        const CHUNK_SIZE = 5;
        let processedRooms = 0;
        const totalRooms = roomQueue.length;

        for (let i = 0; i < roomQueue.length; i += CHUNK_SIZE) {
            const chunk = roomQueue.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (url) => {
                await fetchAndCache(url);
                processedRooms++;
                const subPct = Math.round((processedRooms / totalRooms) * 100);
                const globalPct = 10 + Math.round((processedRooms / totalRooms) * 90);
                notifyUI(`Caching Rooms: ${processedRooms}/${totalRooms}`, true, 0, globalPct, subPct);
            }));
        }

        notifyUI("Sync Complete!", false, 3000, 100, 100);
        broadcastSyncSuccess();
    }

    // --- 5. Command Listener ---
    window.addEventListener('message', function(event) {
        if (event.source !== window || !event.data || typeof event.data !== 'object') return;
        if (event.data.type === 'SMOOTHIIQ_CMD_FORCE_SYNC') prefetchGlobals(true);
        if (event.data.type === 'SMOOTHIIQ_CMD_GET_STATS') broadcastStats();
    });

    setTimeout(() => prefetchGlobals(false), 1000);
    setInterval(() => prefetchGlobals(false), CHECK_INTERVAL_MS);

})();