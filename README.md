# SmoothIIQ

SmoothIIQ is a Chrome Extension that improves IncidentIQ responsiveness by reducing UI overhead and caching frequently requested API data in the browser.

## Complete Feature List

- Optimization toggle in popup (`Pause Optimization` / `Re-enable Optimization`)
- Animation and transition suppression across IncidentIQ pages when enabled
- Reduced paint-heavy visual effects (e.g., shadows/backdrop filters) for faster rendering
- Injected cache interceptor for IncidentIQ API `GET` requests
- IndexedDB-based cache layer for key IncidentIQ datasets
- Automatic cache refresh on a timed interval (every 15 minutes)
- Initial delayed sync after page load
- Manual force refresh from popup (`Refresh Cache Now`)
- Cache freshness status in popup (`Last cached: ...`)
- Live stats surfaced in popup:
	- Asset statuses count
	- Locations count
	- Per-location room counts
- Room breakdown selector in popup
- In-page sync toast notifications with:
	- Spinner/loading indicator
	- Per-category progress bar
	- Overall progress bar
- Search-aware cached response filtering for room/location search patterns
- Canonicalized cache keys for selected endpoints to improve cache hit rate
- Cache TTL expiration logic (60-minute validity window)
- Automatic cleanup of expired cache entries on retrieval
- Location-change room-selection clearer helper for IncidentIQ UI flows
- Local extension state persistence via `chrome.storage.local`

## How It Works

1. `content.js` runs at `document_start` on IncidentIQ pages.
2. It injects `cache_interceptor.js` into the page context.
3. The interceptor watches eligible `XMLHttpRequest GET` calls.
4. If cache exists and is fresh, cached data is returned immediately.
5. If not, network data is fetched and stored to IndexedDB.
6. Popup UI reads sync metadata and cache stats from `chrome.storage.local`.

## Current Cached Endpoint Families

- Locations
- Asset status types
- Rooms per location

## Permissions

- `storage`: stores extension settings and stats metadata.
- `*://*.incidentiq.com/*`: allows operation on IncidentIQ tenant domains (ex. lowellpublic).

## Installation (Developer Mode)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.

## Usage

1. Open an IncidentIQ page.
2. Click the SmoothIIQ extension icon.
3. Use:
	 - **Pause Optimization** to disable optimization styles.
	 - **Refresh Cache Now** to force a full cache sync.
4. Watch popup cache status and stats update after sync.

## Notes

- SmoothIIQ is designed specifically for IncidentIQ domains.
- Cache sync/resync only runs when you are logged in to IncidentIQ (active authenticated session).
- If there is no cache yet, stats populate after the first successful sync.
