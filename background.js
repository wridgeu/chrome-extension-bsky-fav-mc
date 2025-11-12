// MV3 service worker: renders SVG path to ImageData and syncs the action badge

const ICON_SIZES = [16, 32];
const FILL_COLORS = {
	enabled: '#2196F3',
	disabled: '#A0A0A0',
};
const MAX_SHOWN_COUNT = 99;
const SVG_ICON_PATH = 'icons/icon-blue.svg';
const SVG_VIEWBOX_SIZE = 640;

let svgPathData = null;

const tabCounts = new Map();

/**
 * Formats the count for display in the badge, capping at MAX_SHOWN_COUNT.
 * @param {number} count - The post count
 * @returns {string} Formatted label or empty string if count is 0
 * @why Badge space is limited, so we cap at 99+ for readability. Empty string hides the badge when there are no posts.
 */
const limitCountLabel = (count = 0) => {
	if (count <= 0 || !Number.isFinite(count)) return '';
	if (count > MAX_SHOWN_COUNT) return `${MAX_SHOWN_COUNT}+`;
	return String(count);
};

/**
 * Loads and parses the SVG icon file to extract the path data.
 * @why Chrome extensions don't support SVG files directly for action icons. We need to extract the path data from the SVG file and render it using OffscreenCanvas to create ImageData that Chrome can use.
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
 * @param {'enabled' | 'disabled'} state - Icon state
 * @returns {Promise<Object<number, ImageData>>} Dictionary of size -> ImageData for each icon size
 * @why Service workers can't use regular canvas elements (no DOM access). OffscreenCanvas is the only way to render graphics in a service worker. We render the SVG path with different colors (blue for enabled, gray for disabled) and convert to ImageData that Chrome's action API accepts.
 * @see https://developer.chrome.com/docs/extensions/reference/api/action#method-setIcon
 */
async function getIconImages(state) {
	await ensureSvgPathLoaded();
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
 * @param {number} tabId - Chrome tab ID
 * @param {number} count - Number of saved posts found
 * @why This is the central function that updates all visual indicators (icon color, badge count, tooltip) based on the current post count. It's called whenever the count changes or when switching tabs.
 */
async function applyIcon(tabId, count) {
	const state = count > 0 ? 'enabled' : 'disabled';
	const badgeText = limitCountLabel(count);
	try {
		const imageData = await getIconImages(state);
		await chrome.action.setIcon({ tabId, imageData });
		await chrome.action.setBadgeBackgroundColor({
			tabId,
			color: state === 'enabled' ? '#1976D2' : '#616161',
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

/**
 * Stores the count for a tab and updates the icon.
 * @param {number} tabId - Chrome tab ID
 * @param {number} count - Number of saved posts
 * @returns {Promise<void>}
 * @why We maintain per-tab counts so each tab shows its own accurate count. This function updates both the stored count and the visual icon.
 */
function setTabCount(tabId, count) {
	tabCounts.set(tabId, count);
	return applyIcon(tabId, count);
}

/**
 * Resets a tab's count to 0 and updates the icon.
 * @param {number} tabId - Chrome tab ID
 * @returns {Promise<void>}
 * @why When navigating away from the saved page or when a tab starts loading, we reset the count to 0 so the icon shows the disabled state.
 */
function resetTab(tabId) {
	tabCounts.set(tabId, 0);
	return applyIcon(tabId, 0);
}

// Listen for count updates from content script
// @why The content script scans the page and sends FOUND_COUNT messages whenever the post count changes. This keeps the icon badge synchronized with the actual number of visible saved posts.
chrome.runtime.onMessage.addListener((message, sender) => {
	if (!sender?.tab?.id || !message || message.type !== 'FOUND_COUNT') {
		return;
	}
	const { id: tabId } = sender.tab;
	const count = Number.isFinite(message.count) ? Number(message.count) : 0;
	setTabCount(tabId, count);
});

// Reset icon when tab navigates or starts loading
// @why When a user navigates to a different page or the tab starts loading, we reset the count to 0 so the icon shows the disabled state immediately, rather than showing stale data.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status === 'loading' || changeInfo.url) {
		resetTab(tabId);
	}
});

// Update icon when switching to a different tab
// @why Each tab maintains its own count. When you switch tabs, we need to restore the correct icon state for that tab (blue with count if on saved page, gray if not).
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
	try {
		const currentCount = tabCounts.get(tabId) ?? 0;
		await applyIcon(tabId, currentCount);
	} catch (error) {
		console.error('Failed to update icon for activated tab', error);
	}
});

// Clean up count when tab is closed
// @why Prevent memory leaks by removing stored counts for tabs that no longer exist.
chrome.tabs.onRemoved.addListener((tabId) => {
	tabCounts.delete(tabId);
});

