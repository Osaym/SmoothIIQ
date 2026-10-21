# SmoothIIQ ⚡

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Version](https://img.shields.io/badge/Version-1.4.0-blue.svg)](manifest.json)
[![Platform](https://img.shields.io/badge/Platform-IncidentIQ-orange.svg)](https://incidentiq.com)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Available-4285F4.svg)](https://chromewebstore.google.com/detail/osayms-smoothiiq/odacipeffkmakacijjkbabgaannhbpba)

**SmoothIIQ** is a high-performance Chrome Extension (Manifest V3) specifically engineered to accelerate [IncidentIQ](https://incidentiq.com). It eliminates UI lag, reduces layout thrashing, silences non-essential telemetry, introduces power-user keyboard shortcuts, and delivers zero-latency data access through a dual-tier (RAM + IndexedDB) caching architecture.

---

## 🌟 Key Features

### ⏱️ Performance Impact & Savings Tracker
- **Wait Time Saved**: Real-time counter in the popup showing cumulative seconds/minutes saved by serving cached data locally and eliminating network round-trips.
- **Bandwidth Saved**: Measures exact data transfer saved (e.g., ~154 KB per location query, 5–15 KB per room set).
- **Accelerated Requests**: Tracks total API requests served locally without server round-trips.
- **Trackers Blocked**: Counts external analytics pings and telemetry loops silenced with instant `204 No Content` responses.
- **Installed Since & Active Time Tracker**: Tracks the exact installation date and cumulative active time spent on IncidentIQ pages.
- **Export & Import (Bragging Rights & Backup)**:
  - **Export**: Copies a formatted bragging report directly to your clipboard (ready to paste into Google Docs, Slack, or email) and automatically downloads a JSON backup file.
  - **Import**: Allows restoring your cumulative metrics on a new machine or browser profile by pasting the backup JSON or exported report.
- **Multi-Device Metrics Sync**: Automatically aggregates your performance metrics across all devices signed into your Google Chrome profile via `chrome.storage.sync` with device isolation and conflict-free merging.
- **Persistent & Resettable**: Stats accumulate across sessions in `chrome.storage.local` and Chrome Sync, with an in-popup **Reset** button.

### ⌨️ Power-User Keyboard Shortcuts
- **Rapid Save (`Cmd + Enter` on Mac / `Ctrl + Enter` on Windows/Linux)**:
  - Instantly saves tickets and assets.
  - Automatically blurs active form inputs prior to submit, guaranteeing Angular's `$scope` two-way data bindings commit their state cleanly.
- **Contextual Guidance Hint**:
  - Displays a clean, non-intrusive toast informing agents of the shortcut when editing an asset form.
  - Scoped strictly to asset editing fields (never fires on global search bars or navigation inputs).
  - Remembers dismissal in `sessionStorage` to avoid nagging.

### 🧠 Dual-Tier High-Speed Caching (L1 RAM + L2 IndexedDB)
- **L1 In-Memory Cache**: 0ms synchronous lookups for master lists (locations, asset statuses) during active sessions.
- **L2 Persistent IndexedDB**: Connection-pooled storage that survives browser restarts with zero database lock contention.
- **Dual XHR & Fetch Interception**: Seamlessly hooks both modern `window.fetch` and `XMLHttpRequest`.
- **Search-Aware Dynamic Filtering**: Evaluates client-side search queries (e.g., location/room search parameters) against cached master datasets on the fly.
- **Mutation-Aware Invalidation**: Automatically invalidates stale caches when mutations (`POST`, `PUT`, `DELETE`) are executed.

### 🎨 Safe Rendering & Reflow Containment
- **Layout Thrashing Elimination**: Replaces heavy backdrop filters, runaway animations, and transition overhead with instantaneous CSS containment.
- **Safe Virtualization**: Targets long table rows and activity timeline feeds with `content-visibility: auto` and `contain-intrinsic-size` without affecting dynamic navigation drawers or collapsible sidebars.

### 🚫 Telemetry Silencing (Zero Latency)
- Intercepts external analytics and tracking pings (Gainsight PX `/rte/v1/command`, FullStory, Pendo, Google Analytics) and returns instantaneous responses.
- Eliminates tracking round-trips and prevents third-party analytics from blocking browser CPU.

### 🔬 Developer Diagnostics & Flight Recorder (`tools/audit_engine.js`)
- Included in the repository under `tools/` for advanced benchmarking and profiling:
  - Live flight recording of network waterfalls and concurrent request coalescing.
  - Angular `$digest` cycle latency and active watcher monitoring.
  - DOM reflow detection and layout thrashing analysis.
  - Excluded from the production Chrome Web Store bundle to ensure zero overhead for end users.

### 🔄 Auto-Update & Freshness Checks
- In-popup notifications automatically check the Chrome Web Store and GitHub Releases every 6 hours, alerting agents when updates are published.

---

## 📊 Real-World Performance Impact

| Metric | Before SmoothIIQ | With SmoothIIQ | Improvement |
| :--- | :---: | :---: | :---: |
| **Main Thread Freeze Time** | `4,097 ms` | `754 ms` | **81% Faster** |
| **Potential Reflows** | `69,248` | `75` | **99.9% Less Layout Thrashing** |
| **Angular Digest Latency** | High / Laggy | `2 ms` | **Near-Instantaneous** |
| **Network Requests (Dashboard)** | `1,600+` | `205` | **~87% Network Reduction** |
| **Location Query Response Time** | `150–250 ms` | `0 ms (RAM)` | **Instantaneous** |

---

## 🏗️ Architecture & How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                       IncidentIQ Page                       │
│                                                             │
│   [ Form Input ] ──( Cmd/Ctrl+Enter )──> [ Blur + Save ]    │
│                                                             │
│   [ Network Request ]                                       │
│          │                                                  │
│          ▼                                                  │
│   ┌─────────────────────────────────────────────────────┐   │
│   │   SmoothIIQ Cache Interceptor (MAIN World)          │   │
│   │                                                     │   │
│   │   1. Telemetry? ────────────> Instant 204 No Content│   │
│   │   2. In L1 RAM? ────────────> 0ms Instant Response  │   │
│   │   3. In L2 IndexedDB? ──────> Instant Hit & Save RAM│   │
│   │   4. Miss? ─────────────────> Fetch & Cache Response│   │
│   └──────────────────────┬──────────────────────────────┘   │
│                          │                                  │
│                     (postMessage)                           │
│                          │                                  │
│                          ▼                                  │
│   ┌─────────────────────────────────────────────────────┐   │
│   │      SmoothIIQ Content Script (ISOLATED World)      │   │
│   │                                                     │   │
│   │   - Batches savings (Time Saved, Bytes, Requests)   │   │
│   │   - Manages CSS containment class injection         │   │
│   │   - Syncs state to chrome.storage.local             │   │
│   └──────────────────────┬──────────────────────────────┘   │
└──────────────────────────┼──────────────────────────────────┘
                           ▼
               ┌───────────────────────┐
               │    Popup Interface    │
               │  - Wait Time Saved    │
               │  - Data Saved (MB/KB) │
               │  - Cache Controls     │
               │  - Update Alerts      │
               └───────────────────────┘
```

---

## 🛡️ Permissions & Security

SmoothIIQ strictly adheres to the principle of least privilege required by Chrome Manifest V3:

- **`storage`**: Used solely to persist local preferences (enabled/paused state), cache timestamps, and cumulative savings statistics on the user's machine.
- **`*://*.incidentiq.com/*`**: Restricted specifically to IncidentIQ tenant domains. No code runs on any other website.
- **`https://api.github.com/*`**: Periodically checks for public release tag updates to notify users when a new version is available.
- **Zero Remote Code Execution**: All scripts are bundled locally inside the extension. No external scripts are loaded or executed.
- **Privacy-First**: No user data, passwords, ticket contents, or credentials are ever transmitted outside the browser.

---

## 📦 Installation

### Option 1: Chrome Web Store (Recommended)
Install the verified release directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/osayms-smoothiiq/odacipeffkmakacijjkbabgaannhbpba).

### Option 2: Developer / Unpacked Mode
1. Clone or download this repository:
   ```bash
   git clone https://github.com/osaym/SmoothIIQ.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Toggle on **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the `SmoothIIQ` root directory.

---

## 🎮 Usage & Keyboard Shortcuts

| Shortcut / Control | Platform | Action |
| :--- | :---: | :--- |
| **`Cmd + Enter`** | macOS | In Ticket Comments: Opens quick modal to submit with **[1]** Private Comment, **[2]** Visible to Requestor, or **[3]** Visible & Waiting on Requestor. Everywhere else: Saves active form / asset changes. |
| **`Ctrl + Enter`** | Windows / Linux | In Ticket Comments: Opens quick modal to submit with **[1]** Private Comment, **[2]** Visible to Requestor, or **[3]** Visible & Waiting on Requestor. Everywhere else: Saves active form / asset changes. |
| **`1` / `2` / `3`** | All | Instantly selects and posts comment with chosen visibility and response toggle while modal is open. |
| **`Esc`** | All | Cancels modal and restores cursor focus to the comment editor. |
| **Pause Optimization** | Popup | Temporarily disables all CSS containment and style modifications. |
| **Refresh Cache Now** | Popup | Triggers a fresh background resynchronization of location and status tables. |
| **Reset** | Popup | Resets the cumulative "Performance Impact" counters back to zero. |

---

## 👨‍💻 Author & Support

- **Created by**: [Osaym Omar](https://osaym.com)
- **GitHub**: [@osaym](https://github.com/osaym)
- **Repository**: [github.com/osaym/SmoothIIQ](https://github.com/osaym/SmoothIIQ)
- **Feedback & Issues**: Please report bugs or submit feature suggestions via [GitHub Issues](https://github.com/osaym/SmoothIIQ/issues).
