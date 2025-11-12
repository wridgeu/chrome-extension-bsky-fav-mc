# 🦋 Bluesky "Saved Posts" Middle-Click Opener

## 📋 Overview
This Chrome extension enhances the `https://bsky.app/saved` page by detecting saved posts, enabling middle-click navigation, and surfacing a live badge count in the browser toolbar. It is built on Manifest V3 with a background service worker and a single content script.

### 🧑 Learnings
The extension use-case seemed trivial enough to do it with Cursor and as pair programming in Agent mode. I didn't want to spend too much time setting up an extension myself so this was perfect. I even learned a few things. For example:
- `OffscreenCanvas`
  - That the `setIcon` API doesn't accept SVGs
- `querySelector`-selector usage like a regex (fun!) `a[href^="/profile/"][href*="/post/"]`

What would I do differently next time? Well under the cirumstances I just wanted to get started and simply started prompting. I'd love to check out SDD and more testing of chrome extensions not only in general but especially in combination with AI "pair programming".

## ✨ Key Features
- **Per-tab saved post count**  
  The toolbar icon lights up (blue) and shows the number of visible saved posts on the current tab. When no posts are detected, the icon stays gray with an empty badge.
- **Middle-click navigation**  
  Saved post cards and their timestamp anchors can be opened in a new tab with a middle mouse button press (or trackpad equivalent) without triggering the browser’s auto-scroll behavior.
- **Robust DOM monitoring**  
  Works with Bluesky’s client-side routing, infinite scrolling, and shadow DOM. Counts refresh automatically when bouncing between Bluesky tabs or other sites in the same tab.

## 📥 Installation
1. Visit `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and choose the repository folder (`chrome-extension-bsky-fav-mc`).
4. Navigate to `https://bsky.app/saved` to see the extension in action.

## ⚙️ How It Works

### 📜 Content Script (`content.js`)
- Runs on all `https://bsky.app/*` routes but activates only when the path starts with `/saved`.
- Finds top-level saved post containers (`div[role="link"][tabindex]`) that aren't nested inside other containers, ensuring only actual saved posts are counted (not quoted/reposted content within posts).
- Locates post anchors matching `/profile/<handle>/post/<cid>` within each container using a selector plus regex guard.
- Filters out hidden elements and only counts visible posts within the main content area to avoid counting off-route markup.
- Attaches capture-phase listeners to the post container (`div[role="link"][tabindex]`) that:
  - Cancel the browser's default middle-button auto-scroll behavior.
  - Open the post URL in a new tab on middle-click.
- Uses a `MutationObserver` to watch for DOM changes (new posts loaded via infinite scroll, route changes, etc.).
- Debounces DOM scans and reports unique post counts to the background worker via `FOUND_COUNT` messages.
- Listens to `popstate`, `pageshow`, `focus`, and `visibilitychange` events to detect navigation and tab switches.

### ⚡ Background Service Worker (`background.js`)
- Lazy-loads and parses `icons/icon-blue.svg` at runtime to extract the Bluesky glyph path data.
- Renders two icon states (enabled/disabled) on demand via `OffscreenCanvas` with different fill colors (blue `#2196F3` for enabled, gray `#A0A0A0` for disabled).
- Converts rendered icons to `ImageData` and sets them with `chrome.action.setIcon` (Chrome doesn't support SVG files directly for action icons).
- Maintains per-tab counts in a `Map`, resets on navigation events, and updates the badge background/text alongside the icon.
- Responds to `FOUND_COUNT` messages from the content script to keep icon state accurate whenever the saved post list changes.
- Handles tab switching, navigation, and cleanup to ensure each tab shows its own accurate count.

### 📦 Manifest (`manifest.json`)
- Manifest V3 configuration with:
  - `host_permissions` for `https://bsky.app/*`.
  - A service worker (`background.js`) as the background script.
  - A single content script (`content.js`) injected at `document_idle`.
- No optional permissions or UI pages; functionality is entirely automatic once loaded.

## 🛠️ Development Notes
- **Tooling:** Plain JavaScript (ES2022), no build step required. Icons live under `icons/`.
- **Static icons:** `icons/default/icon-blue-16.png`, `icons/default/icon-blue-32.png`, `icons/default/icon-blue-48.png`, and `icons/default/icon-blue-128.png` are bundled for Chrome Web Store submission and as the default action icon. The runtime renders the dynamic butterfly icon with count badge overlay.
- **Icon rendering:** Icons are rendered on-demand using `OffscreenCanvas` (required in service workers since regular canvas isn't available). The SVG path is loaded from `icons/icon-blue.svg` at runtime and rendered with different colors based on state.
- **Route detection:** Relies on `MutationObserver` and event listeners (`popstate`, `pageshow`, `focus`, `visibilitychange`) to detect route changes. No history API patching needed - Bluesky's DOM updates trigger rescans automatically.
- **Post counting:** Only counts top-level saved posts by finding containers that aren't nested inside other containers. This prevents counting quoted/reposted content within saved posts as separate posts.
- **Resilience:** Content script gracefully handles Bluesky's React hydration, shadow roots, and BFCache restores. Type assertions at variable origin ensure correct types throughout.
- **Middle-click behavior:** Uses capture-phase listeners on the clickable container to ensure middle-click navigation works across the entire post card, even if Bluesky changes internal handlers.

### 📦 Packaging for the Chrome Web Store
1. Ensure the repo contains only runtime assets (manifest, scripts, `icons/`, `README.md`).
2. Run `zip -r bsky-saved-middle-click.zip manifest.json background.js content.js icons README.md`.
3. In the Chrome Web Store Developer Console, upload the ZIP, provide listing assets (screenshots, description, privacy statement), and submit for review.

## ✅ Testing & Verification
Manual testing checklist:
- Load the unpacked extension and open `https://bsky.app/saved`.
- Confirm the toolbar icon turns blue and shows the saved post count.
- Middle-click saved post cards to verify they open in new tabs.
- Verify that saved posts containing quoted/reposted content are counted as one post (not two).
- Navigate to `https://bsky.app/` or another site in the same tab; icon should reset to gray with no badge.
- Navigate back to `/saved` without refreshing; icon should update automatically with the correct count.
- Scroll to load more saved posts; count and badge update accordingly.

## ⚠️ Known Limitations / 💡 Future Ideas
- The extension is scoped to the `/saved` route. If Bluesky redesigns that page, selectors may require updates.
- Badge counts cap at `99+` for readability; scrolling beyond that still tracks but displays the capped value.
- Currently no automated tests; adding puppeteer-based integration tests could help catch regressions.

## 🙏 Credits
- Bluesky glyph SVG sourced from Font Awesome Free v7.1.0.

---

<p align="center">Created with 🤖 and a bit of ❤️ using AI</p>
