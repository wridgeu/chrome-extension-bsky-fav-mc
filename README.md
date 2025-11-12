# Bluesky Saved Middle-Click Opener

## Overview
This Chrome extension enhances the `https://bsky.app/saved` page by detecting saved posts, enabling middle-click navigation, and surfacing a live badge count in the browser toolbar. It is built on Manifest V3 with a background service worker and a single content script.

## Key Features
- **Per-tab saved post count**  
  The toolbar icon lights up (blue) and shows the number of visible saved posts on the current tab. When no posts are detected, the icon stays gray with an empty badge.
- **Middle-click navigation**  
  Saved post cards and their timestamp anchors can be opened in a new tab with a middle mouse button press (or trackpad equivalent) without triggering the browser’s auto-scroll behavior.
- **Robust DOM monitoring**  
  Works with Bluesky’s client-side routing, infinite scrolling, and shadow DOM. Counts refresh automatically when bouncing between Bluesky tabs or other sites in the same tab.

## Installation
1. Visit `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and choose the repository folder (`chrome-extension-bsky-mm`).
4. Navigate to `https://bsky.app/saved` to see the extension in action.

## How It Works

### Content Script (`content.js`)
- Runs on all `https://bsky.app/*` routes but activates only when the path starts with `/saved`.
- Locates saved post anchors that match `/profile/<handle>/post/<cid>` using a selector plus regex guard.
- Traverses shadow DOM and filters out hidden elements within the main content container to avoid counting off-route markup.
- Wraps both the anchor and its focusable parent (`div[role="link"][tabindex]`) with capture-phase listeners that:
  - Cancel the browser’s default middle-button auto-scroll.
  - Open the post URL in a new tab on middle-click.
- Debounces DOM scans, reports unique post counts to the background worker, and patches history APIs (`pushState`, `replaceState`) so client-side navigation triggers rescans.

### Background Service Worker (`background.js`)
- Lazy-loads and parses `icons/icon-blue.svg` to retrieve the Bluesky glyph path.
- Renders two icon states (enabled/disabled) on demand via `OffscreenCanvas`, caches the resulting bitmaps, and sets them with `chrome.action.setIcon`.
- Maintains per-tab counts, resets on navigation events, and updates the badge background/text alongside the icon.
- Responds to `FOUND_COUNT` messages from the content script to keep icon state accurate whenever the saved post list changes.

### Manifest (`manifest.json`)
- Manifest V3 configuration with:
  - `host_permissions` for `https://bsky.app/*`.
  - A service worker (`background.js`) as the background script.
  - A single content script (`content.js`) injected at `document_idle`.
- No optional permissions or UI pages; functionality is entirely automatic once loaded.

## Development Notes
- **Tooling:** Plain JavaScript (ES2022), no build step required. Icons live under `icons/`.
- **Caching:** The background worker caches rendered icon ImageData keyed by state, minimizing redraws.
- **Resilience:** Content script gracefully handles Bluesky’s React hydration, shadow roots, and BFCache restores. History patching is idempotent to survive multiple injections.
- **Middle-click behavior:** Uses capture-phase listeners on both the anchor and its clickable container to ensure middle-click navigation always works even if Bluesky changes internal handlers.

## Testing & Verification
Manual testing checklist:
- Load the unpacked extension and open `https://bsky.app/saved`.
- Confirm the toolbar icon turns blue and shows the saved post count.
- Middle-click saved post cards to verify they open in new tabs.
- Navigate to `https://bsky.app/` or another site in the same tab; icon should reset to gray with no badge.
- Navigate back to `/saved` without refreshing; icon should update automatically with the correct count.
- Scroll to load more saved posts; count and badge update accordingly.

## Known Limitations / Future Ideas
- The extension is scoped to the `/saved` route. If Bluesky redesigns that page, selectors may require updates.
- Badge counts cap at `99+` for readability; scrolling beyond that still tracks but displays the capped value.
- Currently no automated tests; adding puppeteer-based integration tests could help catch regressions.

## Credits
- Bluesky glyph SVG sourced from Font Awesome Free v7.1.0.

