// 2026 Osaym Omar - SmoothIIQ Performance & Discovery Engine v1.4
// Runs in "Main World" to monitor and analyze DOM, Network, Framework, and Render Bottlenecks.

(function () {
    'use strict';

    if (window.__SmoothIIQ_Auditor__) return;
    window.__SmoothIIQ_Auditor__ = true;

    // --- State Storage ---
    const AuditStore = {
        startTime: Date.now(),
        requests: [],
        duplicates: new Map(),
        longTasks: [],
        forcedReflows: 0,
        digestTimes: [],
        maxDigestTime: 0,
        totalDigests: 0,
        unvirtualizedLists: []
    };

    let activeFlightRecorder = null;

    // --- 1. Network & API Intelligence ---
    const originalXOpen = XMLHttpRequest.prototype.open;
    const originalXSend = XMLHttpRequest.prototype.send;
    const originalFetch = window.fetch;

    function recordRequest(url, method, startTime, duration, size, status, isCached) {
        if (!url || typeof url !== 'string') return;

        // Strip origin for cleaner analysis
        let cleanUrl = url;
        try {
            const parsed = new URL(url, window.location.origin);
            cleanUrl = parsed.pathname + parsed.search;
        } catch (e) { }

        const entry = {
            url: cleanUrl,
            rawUrl: url,
            method: (method || 'GET').toUpperCase(),
            duration: Math.round(duration),
            size: Number(size) || 0,
            status: Number(status) || 200,
            isCached: !!isCached,
            timestamp: Date.now()
        };

        AuditStore.requests.push(entry);

        if (activeFlightRecorder) {
            activeFlightRecorder.events.push({
                offsetMs: Math.round(performance.now() - activeFlightRecorder.startTime),
                type: 'NETWORK',
                detail: `${entry.method} ${cleanUrl}`,
                durationMs: entry.duration,
                status: entry.status,
                cached: entry.isCached
            });
        }

        // Detect duplicates
        const dupKey = `${entry.method} ${cleanUrl}`;
        const currentCount = AuditStore.duplicates.get(dupKey) || 0;
        AuditStore.duplicates.set(dupKey, currentCount + 1);

        updateBadgeCounter();
    }

    XMLHttpRequest.prototype.open = function (method, url) {
        this._auditUrl = url;
        this._auditMethod = method;
        this._auditStartTime = performance.now();
        return originalXOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
        const self = this;
        const startTime = this._auditStartTime || performance.now();

        const onComplete = () => {
            const duration = performance.now() - startTime;
            let size = 0;
            try { size = self.responseText ? self.responseText.length : 0; } catch (e) { }

            let isCached = false;
            try {
                if (self.__smoothIIQ_cached) {
                    isCached = true;
                } else if (typeof self.getAllResponseHeaders === 'function') {
                    const headers = self.getAllResponseHeaders() || '';
                    if (headers.toLowerCase().includes('x-smoothiiq-cache')) {
                        isCached = true;
                    }
                }
            } catch (e) { }

            recordRequest(self._auditUrl, self._auditMethod, startTime, duration, size, self.status, isCached);
        };

        this.addEventListener('load', onComplete, { once: true });
        this.addEventListener('error', onComplete, { once: true });
        return originalXSend.apply(this, arguments);
    };

    if (originalFetch) {
        window.fetch = async function (resource, init) {
            const startTime = performance.now();
            let url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
            let method = init && init.method ? init.method : 'GET';

            try {
                const response = await originalFetch.apply(this, arguments);
                const duration = performance.now() - startTime;
                let size = 0;
                try { size = parseInt(response.headers.get('content-length') || '0', 10); } catch (e) { }

                let isCached = false;
                try {
                    if (response.__smoothIIQ_cached) {
                        isCached = true;
                    } else if (response.headers && typeof response.headers.has === 'function' && response.headers.has('X-SmoothIIQ-Cache')) {
                        isCached = response.headers.get('X-SmoothIIQ-Cache') === 'HIT';
                    }
                } catch (e) { }

                recordRequest(url, method, startTime, duration, size, response.status, isCached);
                return response;
            } catch (err) {
                const duration = performance.now() - startTime;
                recordRequest(url, method, startTime, duration, 0, 0, false);
                throw err;
            }
        };
    }

    // --- 2. Long Task & Main-Thread Freeze Observer ---
    try {
        if (typeof PerformanceObserver !== 'undefined') {
            const longTaskObserver = new PerformanceObserver((list) => {
                list.getEntries().forEach((entry) => {
                    const dur = Math.round(entry.duration);
                    AuditStore.longTasks.push({
                        duration: dur,
                        startTime: Math.round(entry.startTime)
                    });
                    if (activeFlightRecorder) {
                        activeFlightRecorder.events.push({
                            offsetMs: Math.round(performance.now() - activeFlightRecorder.startTime),
                            type: 'THREAD_FREEZE',
                            detail: `UI Thread Blocked / Freeze`,
                            durationMs: dur
                        });
                    }
                });
            });
            longTaskObserver.observe({ type: 'longtask', buffered: true });
        }
    } catch (e) { }

    // --- 3. Forced Reflow / Layout Thrashing Detector ---
    const layoutProps = ['offsetHeight', 'offsetWidth', 'clientHeight', 'clientWidth', 'scrollHeight'];
    let lastDomMutation = 0;

    const mutationObserver = new MutationObserver(() => {
        lastDomMutation = performance.now();
    });
    if (document.documentElement) {
        mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    }

    layoutProps.forEach(prop => {
        try {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
            if (descriptor && descriptor.get) {
                const originalGetter = descriptor.get;
                Object.defineProperty(HTMLElement.prototype, prop, {
                    get: function () {
                        const now = performance.now();
                        // If layout is queried within 2ms of a DOM mutation, flag potential thrash
                        if (now - lastDomMutation < 2) {
                            AuditStore.forcedReflows++;
                        }
                        return originalGetter.call(this);
                    }
                });
            }
        } catch (e) { }
    });

    // --- 4. AngularJS / Framework Diagnostics ---
    function inspectAngular() {
        if (typeof angular === 'undefined') {
            return { detected: false, watchers: 0, scopes: 0, avgDigestMs: 0 };
        }

        let totalWatchers = 0;
        let totalScopes = 0;
        const heavyContainers = [];

        try {
            const root = document.querySelector('[ng-app], [data-ng-app], body');
            const rootScope = root && angular.element(root).scope() ? angular.element(root).scope().$root : null;

            if (rootScope) {
                const queue = [rootScope];
                const seen = new Set();

                while (queue.length > 0) {
                    const scope = queue.shift();
                    if (!scope || seen.has(scope.$id)) continue;
                    seen.add(scope.$id);
                    totalScopes++;

                    const watcherCount = scope.$$watchers ? scope.$$watchers.length : 0;
                    totalWatchers += watcherCount;

                    if (watcherCount > 50 && scope.$$element) {
                        try {
                            const el = scope.$$element[0];
                            const tag = el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''}` : 'Unknown';
                            heavyContainers.push({ element: tag, watchers: watcherCount });
                        } catch (e) { }
                    }

                    if (scope.$$childHead) queue.push(scope.$$childHead);
                    if (scope.$$nextSibling) queue.push(scope.$$nextSibling);
                }

                // Digest cycle hook
                if (!rootScope.__smoothiiq_hooked__) {
                    rootScope.__smoothiiq_hooked__ = true;
                    const originalDigest = rootScope.$digest;
                    rootScope.$digest = function () {
                        const start = performance.now();
                        try {
                            return originalDigest.apply(this, arguments);
                        } finally {
                            const elapsed = performance.now() - start;
                            AuditStore.totalDigests++;
                            AuditStore.digestTimes.push(elapsed);
                            if (elapsed > AuditStore.maxDigestTime) AuditStore.maxDigestTime = elapsed;
                            if (AuditStore.digestTimes.length > 50) AuditStore.digestTimes.shift();
                        }
                    };
                }
            }
        } catch (e) { }

        const avgDigest = AuditStore.digestTimes.length > 0
            ? Math.round(AuditStore.digestTimes.reduce((a, b) => a + b, 0) / AuditStore.digestTimes.length)
            : 0;

        return {
            detected: true,
            version: angular.version ? angular.version.full : '1.x',
            watchers: totalWatchers,
            scopes: totalScopes,
            heavyContainers: heavyContainers.sort((a, b) => b.watchers - a.watchers).slice(0, 5),
            avgDigestMs: avgDigest,
            maxDigestMs: Math.round(AuditStore.maxDigestTime)
        };
    }

    // --- 5. DOM & Virtualization Detector ---
    function inspectDOM() {
        const allElements = document.getElementsByTagName('*');
        const nodeCount = allElements.length;
        let maxDepth = 0;

        try {
            const computeDepth = (el, currentDepth) => {
                if (currentDepth > maxDepth) maxDepth = currentDepth;
                const children = el.children;
                for (let i = 0; i < children.length; i++) {
                    computeDepth(children[i], currentDepth + 1);
                }
            };
            if (document.body) computeDepth(document.body, 1);
        } catch (e) { }

        // Find unvirtualized long lists
        const candidates = [];
        const tables = document.querySelectorAll('table, .k-grid, [ng-repeat], ul, ol, .list-group');
        tables.forEach(container => {
            const rows = container.querySelectorAll('tr, .k-grid-row, li, .list-group-item, div[ng-repeat]');
            if (rows.length >= 40) {
                candidates.push({
                    selector: `${container.tagName.toLowerCase()}${container.id ? '#' + container.id : ''}${container.className ? '.' + container.className.split(' ').slice(0, 2).join('.') : ''}`,
                    renderedChildren: rows.length
                });
            }
        });

        AuditStore.unvirtualizedLists = candidates;

        return {
            totalNodes: nodeCount,
            maxDepth: maxDepth,
            unvirtualizedLists: candidates
        };
    }

    // --- 6. Comprehensive Report Generator ---
    function generateReport() {
        const dom = inspectDOM();
        const ang = inspectAngular();

        // Process request statistics
        const urlStats = {};
        AuditStore.requests.forEach(r => {
            const base = r.url.split('?')[0];
            const key = `${r.method} ${base}`;
            if (!urlStats[key]) {
                urlStats[key] = {
                    endpoint: key,
                    sampleUrl: r.url,
                    count: 0,
                    totalDuration: 0,
                    maxDuration: 0,
                    totalSize: 0,
                    hits: 0
                };
            }
            urlStats[key].count++;
            urlStats[key].totalDuration += r.duration;
            urlStats[key].totalSize += r.size;
            if (r.duration > urlStats[key].maxDuration) urlStats[key].maxDuration = r.duration;
            if (r.isCached) urlStats[key].hits++;
        });

        const endpoints = Object.values(urlStats).map(e => ({
            endpoint: e.endpoint,
            sampleUrl: e.sampleUrl,
            count: e.count,
            avgDurationMs: Math.round(e.totalDuration / e.count),
            maxDurationMs: e.maxDuration,
            totalBytes: e.totalSize,
            hits: e.hits
        }));

        // Redundant / Duplicate calls
        const duplicates = [];
        AuditStore.duplicates.forEach((count, key) => {
            if (count > 1) {
                duplicates.push({ endpoint: key, occurrences: count });
            }
        });
        duplicates.sort((a, b) => b.occurrences - a.occurrences);

        const slowest = [...endpoints].sort((a, b) => b.avgDurationMs - a.avgDurationMs).slice(0, 8);
        const frequent = [...endpoints].sort((a, b) => b.count - a.count).slice(0, 8);

        // Candidate Cache Endpoints (called >1 time or slow GETs that aren't cached)
        const candidates = endpoints
            .filter(e => e.hits === 0 && e.endpoint.startsWith('GET'))
            .filter(e => e.count >= 2 || e.avgDurationMs > 300)
            .sort((a, b) => (b.count * b.avgDurationMs) - (a.count * a.avgDurationMs))
            .slice(0, 8);

        // Compute Actionable Recommendations
        const recommendations = [];

        if (duplicates.length > 0) {
            recommendations.push({
                type: 'HIGH_IMPACT',
                title: 'Duplicate API Calls Detected',
                detail: `Found ${duplicates.length} duplicate endpoints being requested repeatedly. Caching or de-duping these will eliminate ${duplicates.reduce((a, b) => a + (b.occurrences - 1), 0)} network calls.`,
                targets: duplicates.slice(0, 3)
            });
        }

        if (ang.detected && ang.watchers > 2000) {
            recommendations.push({
                type: 'CRITICAL',
                title: 'Angular Watcher Overload',
                detail: `Page has ${ang.watchers.toLocaleString()} active $$watchers (safe threshold is < 2,000). Every click and keystroke evaluates all watchers, causing input lag.`,
                targets: ang.heavyContainers
            });
        }

        if (dom.unvirtualizedLists.length > 0) {
            recommendations.push({
                type: 'MEDIUM',
                title: 'Unvirtualized Large Lists',
                detail: `Found ${dom.unvirtualizedLists.length} containers rendering 40+ DOM rows simultaneously. Applying 'content-visibility: auto' will skip offscreen rendering cost.`,
                targets: dom.unvirtualizedLists
            });
        }

        if (candidates.length > 0) {
            recommendations.push({
                type: 'CACHE_OPPORTUNITY',
                title: 'New High-Value Cache Candidates',
                detail: `These uncached GET endpoints are either called repeatedly or take >300ms to respond.`,
                targets: candidates.map(c => `${c.endpoint} (Calls: ${c.count}, Avg: ${c.avgDurationMs}ms)`)
            });
        }

        const totalLongTaskDuration = AuditStore.longTasks.reduce((acc, t) => acc + t.duration, 0);

        return {
            summary: {
                url: window.location.href,
                auditTimestamp: new Date().toISOString(),
                totalRequestsCaptured: AuditStore.requests.length,
                uniqueEndpoints: endpoints.length,
                longTasksCount: AuditStore.longTasks.length,
                totalFreezeTimeMs: totalLongTaskDuration,
                potentialReflows: AuditStore.forcedReflows
            },
            recommendations,
            network: {
                slowestEndpoints: slowest,
                frequentEndpoints: frequent,
                duplicateCalls: duplicates,
                cacheCandidates: candidates
            },
            angular: ang,
            dom: dom
        };
    }

    // --- 7. Floating Diagnostic HUD Widget ---
    let hudElement = null;

    function createHUD() {
        if (hudElement || !document.body) return;

        hudElement = document.createElement('div');
        hudElement.id = 'smoothiiq-audit-hud';
        hudElement.innerHTML = `
            <style>
                #smoothiiq-audit-hud {
                    position: fixed;
                    bottom: 24px;
                    left: 24px;
                    z-index: 2147483646;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                }
                .s-pill {
                    background: #0f172a;
                    color: #38bdf8;
                    border: 1px solid #334155;
                    border-radius: 9999px;
                    padding: 8px 14px;
                    font-size: 12px;
                    font-weight: 700;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    cursor: pointer;
                    box-shadow: 0 4px 14px rgba(0,0,0,0.3);
                    transition: all 0.2s;
                }
                .s-pill:hover {
                    background: #1e293b;
                    transform: translateY(-2px);
                }
                .s-pill .s-dot {
                    width: 8px;
                    height: 8px;
                    background: #10b981;
                    border-radius: 50%;
                    animation: s-pulse 2s infinite;
                }
                @keyframes s-pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.4; transform: scale(0.85); }
                }
                .s-modal {
                    display: none;
                    position: fixed;
                    bottom: 70px;
                    left: 24px;
                    width: 440px;
                    max-height: 520px;
                    background: #0f172a;
                    color: #e2e8f0;
                    border: 1px solid #334155;
                    border-radius: 12px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                    padding: 16px;
                    box-sizing: border-box;
                    overflow-y: auto;
                    font-size: 12px;
                }
                .s-modal.open { display: block; }
                .s-title {
                    font-size: 14px;
                    font-weight: 700;
                    color: #fff;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid #334155;
                    padding-bottom: 8px;
                    margin-bottom: 12px;
                }
                .s-btn-group {
                    display: flex;
                    gap: 6px;
                    margin-top: 12px;
                }
                .s-btn {
                    flex: 1;
                    background: #2563eb;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    padding: 8px;
                    font-weight: 600;
                    font-size: 11px;
                    cursor: pointer;
                    text-align: center;
                }
                .s-btn:hover { background: #1d4ed8; }
                .s-btn.sec {
                    background: #334155;
                    color: #94a3b8;
                }
                .s-btn.sec:hover { background: #475569; color: #fff; }
                .s-stat-row {
                    display: flex;
                    justify-content: space-between;
                    padding: 4px 0;
                    border-bottom: 1px solid #1e293b;
                }
                .s-stat-label { color: #94a3b8; }
                .s-stat-val { font-weight: 600; color: #f8fafc; }
                .s-recs {
                    margin-top: 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .s-rec-item {
                    background: #1e293b;
                    border-left: 3px solid #3b82f6;
                    padding: 8px;
                    border-radius: 4px;
                }
                .s-rec-item.CRITICAL { border-left-color: #ef4444; }
                .s-rec-item.HIGH_IMPACT { border-left-color: #f97316; }
                .s-rec-title { font-weight: 700; color: #fff; margin-bottom: 2px; }
                .s-rec-desc { font-size: 11px; color: #cbd5e1; line-height: 1.3; }
            </style>
            <div id="smoothiiq-pill" class="s-pill">
                <div class="s-dot"></div>
                <span>SmoothIIQ Auditor (<span id="s-req-count">0</span> calls)</span>
            </div>
            <div id="smoothiiq-modal" class="s-modal">
                <div class="s-title">
                    <span>⚡ SmoothIIQ Diagnostic Lab</span>
                    <span id="s-close-btn" style="cursor: pointer; opacity: 0.7;">✕</span>
                </div>
                <div id="s-stats-container"></div>
                <div class="s-btn-group">
                    <button id="s-record-btn" class="s-btn" style="background: #dc2626;">🔴 Record Next Click (4s Trace)</button>
                    <button id="s-copy-btn" class="s-btn">📋 Copy Report</button>
                    <button id="s-log-btn" class="s-btn sec">📊 Console</button>
                </div>
                <div id="s-recs-container" class="s-recs"></div>
            </div>
        `;
        document.body.appendChild(hudElement);

        const pill = document.getElementById('smoothiiq-pill');
        const modal = document.getElementById('smoothiiq-modal');
        const closeBtn = document.getElementById('s-close-btn');
        const copyBtn = document.getElementById('s-copy-btn');
        const logBtn = document.getElementById('s-log-btn');
        const recordBtn = document.getElementById('s-record-btn');

        pill.addEventListener('click', () => {
            modal.classList.toggle('open');
            if (modal.classList.contains('open')) refreshModalContent();
        });

        closeBtn.addEventListener('click', () => modal.classList.remove('open'));

        copyBtn.addEventListener('click', () => {
            const report = generateReport();
            navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => {
                copyBtn.textContent = '✅ Copied!';
                setTimeout(() => { copyBtn.textContent = '📋 Copy Report'; }, 2000);
            });
        });

        logBtn.addEventListener('click', () => {
            printConsoleSummary();
        });

        recordBtn.addEventListener('click', () => {
            recordBtn.textContent = '⏺ Waiting... Click Users Explorer now!';
            recordBtn.style.background = '#ea580c';
            modal.classList.remove('open');

            const onNextClick = (e) => {
                window.removeEventListener('click', onNextClick, true);
                const target = e.target;
                const targetInfo = {
                    tag: target ? target.tagName : 'unknown',
                    className: target ? String(target.className) : '',
                    text: target ? (target.textContent || '').trim().slice(0, 50) : '',
                    href: target ? (target.getAttribute('href') || '') : '',
                    uiSref: target ? (target.getAttribute('ui-sref') || '') : ''
                };

                activeFlightRecorder = {
                    startTime: performance.now(),
                    initialUrl: window.location.href,
                    clickedElement: targetInfo,
                    events: [],
                    sidebarSnapshots: []
                };

                const takeSnapshot = (label) => {
                    if (!activeFlightRecorder) return;

                    // Query the left rail container specifically
                    let railContainer = document.querySelector('.navigation-rail, [class*="navigation-rail"], .side-rail, aside [class*="rail"], [class*="left-rail"]');
                    if (!railContainer) {
                        railContainer = document.querySelector('aside, nav, [class*="sidebar"]');
                    }
                    const activeRailEl = railContainer ? railContainer.querySelector('.active, .selected, .iq-active, [aria-selected="true"]') : null;

                    // Query the secondary sidebar drawer heading
                    const drawerHeadingEl = document.querySelector('.navigation-area-header, [class*="navigation-area"] h2, .sidebar-header, aside h2, aside h3, [class*="drawer"] h2');

                    let routerState = 'unknown';
                    try {
                        const root = document.querySelector('[ng-app], [data-ng-app], body');
                        const injector = root && window.angular ? window.angular.element(root).injector() : null;
                        if (injector && injector.has('$state')) {
                            routerState = injector.get('$state').current.name;
                        }
                    } catch (e) { }

                    activeFlightRecorder.sidebarSnapshots.push({
                        offsetMs: Math.round(performance.now() - activeFlightRecorder.startTime),
                        checkpoint: label,
                        currentUrl: window.location.href,
                        routerState: routerState,
                        activeRailText: activeRailEl ? (activeRailEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30) : 'none',
                        drawerHeading: drawerHeadingEl ? (drawerHeadingEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30) : 'none'
                    });
                };

                takeSnapshot('0s (click)');
                setTimeout(() => takeSnapshot('1s'), 1000);
                setTimeout(() => takeSnapshot('2s'), 2000);
                setTimeout(() => takeSnapshot('3s'), 3000);

                setTimeout(() => {
                    takeSnapshot('4s (done)');
                    const finalTrace = activeFlightRecorder;
                    activeFlightRecorder = null;

                    // Collect all rail items for inspection
                    const railButtons = [];
                    const railScope = document.querySelector('.navigation-rail, [class*="navigation-rail"], .side-rail, aside');
                    if (railScope) {
                        railScope.querySelectorAll('button, a, [role="button"], li, iq-navigation-rail-item').forEach(el => {
                            const txt = (el.textContent || '').trim().replace(/\s+/g, ' ');
                            if (txt && txt.length < 25) {
                                railButtons.push({
                                    text: txt,
                                    tag: el.tagName,
                                    class: String(el.className || ''),
                                    uiSref: el.getAttribute('ui-sref') || '',
                                    active: el.classList.contains('active') || el.classList.contains('selected') || el.classList.contains('iq-active') || el.getAttribute('aria-selected') === 'true'
                                });
                            }
                        });
                    }
                    finalTrace.railItems = railButtons;

                    console.group('%c [SmoothIIQ Flight Recorder] 🎬 Action Trace Captured', 'color: #38bdf8; font-weight: bold; font-size: 14px;');
                    console.log('Clicked Element:', finalTrace.clickedElement);
                    console.log('Sidebar Snapshots:', finalTrace.sidebarSnapshots);
                    console.log('Rail Items:', finalTrace.railItems);
                    console.table(finalTrace.events);
                    console.groupEnd();

                    navigator.clipboard.writeText(JSON.stringify(finalTrace, null, 2)).then(() => {
                        recordBtn.textContent = '✅ Trace Copied to Clipboard!';
                        recordBtn.style.background = '#16a34a';
                        modal.classList.add('open');
                        refreshModalContent();
                    }).catch(() => {
                        recordBtn.textContent = '✅ Trace Captured (in Console)';
                        modal.classList.add('open');
                    });

                    setTimeout(() => {
                        recordBtn.textContent = '🔴 Record Next Click (4s Trace)';
                        recordBtn.style.background = '#dc2626';
                    }, 4000);
                }, 4000);
            };

            window.addEventListener('click', onNextClick, true);
        });
    }

    function updateBadgeCounter() {
        const counter = document.getElementById('s-req-count');
        if (counter) counter.textContent = AuditStore.requests.length;
    }

    function refreshModalContent() {
        const report = generateReport();
        const statsEl = document.getElementById('s-stats-container');
        const recsEl = document.getElementById('s-recs-container');
        if (!statsEl || !recsEl) return;

        statsEl.innerHTML = `
            <div class="s-stat-row"><span class="s-stat-label">Total API Calls</span><span class="s-stat-val">${report.summary.totalRequestsCaptured}</span></div>
            <div class="s-stat-row"><span class="s-stat-label">Duplicate Calls</span><span class="s-stat-val" style="color: ${report.network.duplicateCalls.length > 0 ? '#f87171' : '#4ade80'}">${report.network.duplicateCalls.length}</span></div>
            <div class="s-stat-row"><span class="s-stat-label">Angular Watchers</span><span class="s-stat-val" style="color: ${report.angular.watchers > 2000 ? '#f87171' : '#4ade80'}">${report.angular.watchers.toLocaleString()}</span></div>
            <div class="s-stat-row"><span class="s-stat-label">DOM Total Nodes</span><span class="s-stat-val">${report.dom.totalNodes} (Depth: ${report.dom.maxDepth})</span></div>
            <div class="s-stat-row"><span class="s-stat-label">Thread Freezes (>50ms)</span><span class="s-stat-val">${report.summary.longTasksCount} (${report.summary.totalFreezeTimeMs}ms)</span></div>
        `;

        if (report.recommendations.length === 0) {
            recsEl.innerHTML = '<div style="color: #4ade80; text-align: center; padding: 10px;">No critical bottlenecks detected yet! Click around more pages to gather data.</div>';
        } else {
            recsEl.innerHTML = report.recommendations.map(r => `
                <div class="s-rec-item ${r.type}">
                    <div class="s-rec-title">${r.title}</div>
                    <div class="s-rec-desc">${r.detail}</div>
                </div>
            `).join('');
        }
    }

    function printConsoleSummary() {
        const report = generateReport();
        console.group('%c [SmoothIIQ] 🚀 Live Performance Diagnostic Audit', 'color: #38bdf8; font-size: 14px; font-weight: bold;');
        console.log('Page URL:', report.summary.url);
        console.log(`Requests: ${report.summary.totalRequestsCaptured} | Duplicates: ${report.network.duplicateCalls.length} | Watchers: ${report.angular.watchers} | Nodes: ${report.dom.totalNodes}`);

        if (report.recommendations.length > 0) {
            console.log('%c ⚡ Actionable Recommendations:', 'color: #f59e0b; font-weight: bold;');
            report.recommendations.forEach(r => console.log(`• [${r.type}] ${r.title}: ${r.detail}`, r.targets));
        }

        if (report.network.duplicateCalls.length > 0) {
            console.log('%c ⚠️ Duplicate Calls (Highest ROI for Caching):', 'color: #ef4444; font-weight: bold;');
            console.table(report.network.duplicateCalls);
        }

        if (report.network.slowestEndpoints.length > 0) {
            console.log('%c ⏱️ Slowest Endpoints:', 'color: #eab308; font-weight: bold;');
            console.table(report.network.slowestEndpoints);
        }

        if (report.network.cacheCandidates.length > 0) {
            console.log('%c 💡 Recommended Endpoints to Add to Cache:', 'color: #10b981; font-weight: bold;');
            console.table(report.network.cacheCandidates);
        }
        console.groupEnd();
        return report;
    }

    // Expose Global Console API
    window.SmoothIIQ_Audit = {
        report: generateReport,
        log: printConsoleSummary,
        store: AuditStore
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createHUD, { once: true });
    } else {
        createHUD();
    }

    console.log('%c[SmoothIIQ Auditor] 🔍 Engine loaded. Type SmoothIIQ_Audit.log() in Console or click the bottom-left badge.', 'color: #10b981; font-weight: bold;');
})();
