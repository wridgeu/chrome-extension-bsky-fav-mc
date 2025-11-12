// MV3 service worker: rasterizes SVG path to ImageData icons and toggles per-tab

const SVG_VIEWBOX_SIZE = 640; // from the provided FontAwesome SVG viewBox
const ICON_SIZES = [16, 32];

// FontAwesome Bluesky path (provided)
const BLUESKY_PATH_D = "M439.8 358.7C436.5 358.3 433.1 357.9 429.8 357.4C433.2 357.8 436.5 358.3 439.8 358.7zM320 291.1C293.9 240.4 222.9 145.9 156.9 99.3C93.6 54.6 69.5 62.3 53.6 69.5C35.3 77.8 32 105.9 32 122.4C32 138.9 41.1 258 47 277.9C66.5 343.6 136.1 365.8 200.2 358.6C203.5 358.1 206.8 357.7 210.2 357.2C206.9 357.7 203.6 358.2 200.2 358.6C106.3 372.6 22.9 406.8 132.3 528.5C252.6 653.1 297.1 501.8 320 425.1C342.9 501.8 369.2 647.6 505.6 528.5C608 425.1 533.7 372.5 439.8 358.6C436.5 358.2 433.1 357.8 429.8 357.3C433.2 357.7 436.5 358.2 439.8 358.6C503.9 365.7 573.4 343.5 593 277.9C598.9 258 608 139 608 122.4C608 105.8 604.7 77.7 586.4 69.5C570.6 62.4 546.4 54.6 483.2 99.3C417.1 145.9 346.1 240.4 320 291.1z";

function rasterizeSvgPathToImageData(size, fill) {
	const scale = size / SVG_VIEWBOX_SIZE;
	const canvas = new OffscreenCanvas(size, size);
	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, size, size);
	ctx.scale(scale, scale);
	const path = new Path2D(BLUESKY_PATH_D);
	ctx.fillStyle = fill;
	ctx.fill(path);
	return ctx.getImageData(0, 0, size, size);
}

function generateIconImages(state /* 'enabled' | 'disabled' */, count) {
	const color = state === 'enabled' ? "#2196F3" : "#A0A0A0";
	const images = {};
	const label = count > 99 ? "99" : (count > 0 ? String(count) : "");
	for (const size of ICON_SIZES) {
		const canvas = new OffscreenCanvas(size, size);
		const ctx = canvas.getContext('2d');

		// Base glyph
		ctx.save();
		const scale = size / SVG_VIEWBOX_SIZE;
		ctx.scale(scale, scale);
		const path = new Path2D(BLUESKY_PATH_D);
		ctx.fillStyle = color;
		ctx.fill(path);
		ctx.restore();

		// Draw count in the center if present
		if (label) {
			// Reset transform for text (so it's not scaled)
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			const fontSize = Math.max(8, Math.floor(size * 0.7));
			ctx.font = `700 ${fontSize}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			// Outline for contrast
			ctx.lineWidth = Math.max(1, Math.ceil(size * 0.15));
			ctx.strokeStyle = 'rgba(0,0,0,0.75)';
			ctx.strokeText(label, size / 2, size / 2);
			ctx.fillStyle = '#fff';
			ctx.fillText(label, size / 2, size / 2);
		}

		images[size] = ctx.getImageData(0, 0, size, size);
	}
	return images;
}

const tabIdToCount = new Map();

async function setIconForTab(tabId, state /* 'enabled' | 'disabled' */, count = 0) {
	try {
		const images = generateIconImages(state, count);
		await chrome.action.setIcon({
			tabId,
			imageData: images,
		});
		await chrome.action.setTitle({
			tabId,
			title: state === "enabled" ? "Bluesky Saved: posts detected" : "Bluesky Saved: no posts detected",
		});
	} catch (e) {
		// No-op: avoid crashing the worker on certain navigations
	}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (!sender?.tab?.id) return;
	const tabId = sender.tab.id;
	if (message && message.type === "FOUND_COUNT") {
		tabIdToCount.set(tabId, message.count || 0);
		const state = message.count > 0 ? "enabled" : "disabled";
		setIconForTab(tabId, state, message.count || 0);
	}
	// No async response expected
});

// Try to default to disabled icon on install/activate
chrome.runtime.onInstalled.addListener(() => {
	// no-op
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (changeInfo.status === "loading" || changeInfo.url) {
		tabIdToCount.set(tabId, 0);
		setIconForTab(tabId, "disabled", 0);
	}
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
	try {
		const tab = await chrome.tabs.get(tabId);
		const url = tab?.url || "";
		const isSavedPage = /^https:\/\/bsky\.app\/saved/.test(url);
		const count = tabIdToCount.get(tabId) ?? 0;
		if (isSavedPage) {
			await setIconForTab(tabId, count > 0 ? "enabled" : "disabled", count);
		} else {
			tabIdToCount.set(tabId, 0);
			await setIconForTab(tabId, "disabled", 0);
		}
	} catch {
		// ignore
	}
});

chrome.tabs.onRemoved.addListener((tabId) => {
	tabIdToCount.delete(tabId);
});

