// MV3 service worker: renders SVG path to ImageData and syncs the action badge

/**
 * Creates a tab count manager with methods to get, set, and delete tab counts.
 * The tabCounts Map, icon rendering functions, and related state are encapsulated in a closure to prevent direct access.
 * @returns {Object} Object with methods to manage tab counts: setTabCount, getTabCount, deleteTabCount
 */
function createTabCountManager() {
	const tabCounts = new Map();
	const MAX_SHOWN_COUNT = 99;
	let svgPathData = null;

	// Icon rendering constants
	const ICON_SIZES = [16, 32];
	const FILL_COLORS = {
		enabled: '#2196F3', // Material Blue 500
		disabled: '#A0A0A0', // Medium gray
	};
	const BADGE_BACKGROUND_COLORS = {
		enabled: '#1976D2', // Material Blue 700 (darker blue)
		disabled: '#616161', // Material Gray 700 (darker gray)
	};
	const SVG_ICON_PATH = 'icons/icon-blue.svg';
	const SVG_VIEWBOX_SIZE = 640;

	/**
	 * Formats the count for display in the badge, capping at MAX_SHOWN_COUNT.
	 * Badge space is limited, so we cap at 99+ for readability. Empty string hides the badge when there are no posts.
	 * @param {number} count - The post count
	 * @returns {string} Formatted label or empty string if count is 0
	 */
	function limitCountLabel(count = 0) {
		if (count <= 0 || !Number.isFinite(count)) return '';
		if (count > MAX_SHOWN_COUNT) return `${MAX_SHOWN_COUNT}+`;
		return String(count);
	}

	/**
	 * Loads and parses the SVG icon file to extract the path data.
	 * Chrome extensions don't support SVG files directly for action icons. We need to extract the path data from the SVG file and render it using OffscreenCanvas to create ImageData that Chrome can use.
	 * @returns {Promise<void>}
	 * @throws {Error} If the SVG file fails to fetch or parse
	 */
	async function ensureSvgPathLoaded() {
		if (svgPathData) return;
		const svgUrl = chrome.runtime.getURL(SVG_ICON_PATH);
		const res = await fetch(svgUrl);
		if (!res.ok) {
			throw new Error(`Failed to fetch icon SVG: ${res.status} ${res.statusText}`);
		}
		const svgText = await res.text();
		const pathMatch = svgText.match(/<path[^>]*\sd=["']([^"']+)["']/i);
		if (!pathMatch || !pathMatch[1]) {
			throw new Error(`Failed to parse SVG path data from ${SVG_ICON_PATH}`);
		}
		svgPathData = pathMatch[1];
	}

	/**
	 * Renders the Bluesky icon as ImageData for the given state (enabled/disabled).
	 * Service workers can't use regular canvas elements (no DOM access). OffscreenCanvas is the only way to render graphics in a service worker. We render the SVG path with different colors (blue for enabled, gray for disabled) and convert to ImageData that Chrome's action API accepts.
	 * @param {'enabled' | 'disabled'} state - Icon state
	 * @returns {Promise<Object<number, ImageData>>} Dictionary of size -> ImageData for each icon size
	 * @throws {Error} If SVG path loading fails or no valid canvas contexts can be created
	 * @see https://developer.chrome.com/docs/extensions/reference/api/action#method-setIcon
	 */
	async function getIconImages(state) {
		await ensureSvgPathLoaded();
		/** @type {{ [size: number]: ImageData }} */
		const images = {};
		for (const size of ICON_SIZES) {
			const canvas = new OffscreenCanvas(size, size);
			const ctx = canvas.getContext('2d', { alpha: true });
			if (!ctx) {
				continue;
			}
			ctx.clearRect(0, 0, size, size);

		ctx.save();
		const scale = size / SVG_VIEWBOX_SIZE;
		ctx.scale(scale, scale);
		const path = new Path2D(svgPathData);
		ctx.fillStyle = FILL_COLORS[state];
		ctx.fill(path);
		ctx.restore();

			images[size] = ctx.getImageData(0, 0, size, size);
		}
		return images;
	}

	/**
	 * Updates the extension icon, badge, and title for a specific tab.
	 * This is the central function that updates all visual indicators (icon color, badge count, tooltip) based on the current post count. It's called whenever the count changes or when switching tabs.
	 * @param {number} tabId - Chrome tab ID
	 * @param {number} count - Number of saved posts found
	 * @returns {Promise<void>} Resolves when icon update completes, or rejects if icon rendering fails
	 */
	async function applyIcon(tabId, count) {
		const state = count > 0 ? 'enabled' : 'disabled';
		const badgeText = limitCountLabel(count);
		try {
			const imageData = await getIconImages(state);
			await chrome.action.setIcon({ tabId, imageData });
			await chrome.action.setBadgeBackgroundColor({
				tabId,
				color: BADGE_BACKGROUND_COLORS[state],
			});
			await chrome.action.setBadgeText({ tabId, text: badgeText });
			await chrome.action.setTitle({
				tabId,
				title: state === 'enabled' ? 'Bluesky Saved: posts detected' : 'Bluesky Saved: no posts detected',
			});
		} catch (error) {
			console.error('Failed to set action icon', error);
		}
	}

	return {
		/**
		 * Stores the count for a tab and updates the icon.
		 * @param {number} tabId - Chrome tab ID
		 * @param {number} count - Number of saved posts
		 * @returns {Promise<void>} Resolves when icon update completes
		 */
		setTabCount(tabId, count) {
			tabCounts.set(tabId, count);
			return applyIcon(tabId, count);
		},

		/**
		 * Gets the count for a tab, defaulting to 0 if not found.
		 * @param {number} tabId - Chrome tab ID
		 * @returns {number} The count for the tab, or 0 if not found
		 */
		getTabCount(tabId) {
			return tabCounts.get(tabId) ?? 0;
		},

		/**
		 * Removes the count for a tab.
		 * @param {number} tabId - Chrome tab ID
		 * @returns {void}
		 */
		deleteTabCount(tabId) {
			tabCounts.delete(tabId);
		},
	};
}

const tabCountManager = createTabCountManager();

// Listen for count updates from content script
// The content script scans the page and sends FOUND_COUNT messages whenever the post count changes. This keeps the icon badge synchronized with the actual number of visible saved posts.
chrome.runtime.onMessage.addListener((message, sender) => {
	if (!sender?.tab?.id || !message || message.type !== 'FOUND_COUNT') {
		return;
	}
	const { id: tabId } = sender.tab;
	const count = Number.isFinite(message.count) ? Number(message.count) : 0;
	tabCountManager.setTabCount(tabId, count);
});

// Reset icon when tab navigates or starts loading
// When a user navigates to a different page or the tab starts loading, we reset the count to 0 so the icon shows the disabled state immediately, rather than showing stale data.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status === 'loading' || changeInfo.url) {
		tabCountManager.setTabCount(tabId, 0);
	}
});

// Update icon when switching to a different tab
// Each tab maintains its own count. When you switch tabs, we need to restore the correct icon state for that tab (blue with count if on saved page, gray if not).
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
	try {
		const currentCount = tabCountManager.getTabCount(tabId);
		// In theory we're setting the count to the same value, which is unnecessary,
		// but it's negligible and reduces redundant code by reusing setTabCount.
		await tabCountManager.setTabCount(tabId, currentCount);
	} catch (error) {
		console.error('Failed to update icon for activated tab', error);
	}
});

// Clean up count when tab is closed
// Prevent memory leaks by removing stored counts for tabs that no longer exist.
chrome.tabs.onRemoved.addListener((tabId) => {
	tabCountManager.deleteTabCount(tabId);
});

