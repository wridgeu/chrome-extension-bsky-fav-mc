// MV3 service worker: renders SVG path loaded from icons/ and overlays count; toggles per-tab

const ICON_SIZES = [16, 32];

let SVG_PATH_D = null;
let SVG_VIEWBOX_SIZE = 640;

async function ensureSvgPathLoaded() {
	if (SVG_PATH_D) return;
	// Load one of the icon SVGs and extract the path "d" and viewBox values
	const svgUrl = chrome.runtime.getURL('icons/icon-blue.svg');
	const res = await fetch(svgUrl);
	const svgText = await res.text();
	// Simple extraction; assumes single path and square viewBox
	const viewBoxMatch = svgText.match(/viewBox=["']\s*0\s+0\s+(\d+)\s+(\d+)\s*["']/i);
	if (viewBoxMatch) {
		const w = parseInt(viewBoxMatch[1], 10);
		const h = parseInt(viewBoxMatch[2], 10);
		SVG_VIEWBOX_SIZE = Math.max(w || 640, h || 640);
	}
	const pathMatch = svgText.match(/<path[^>]*d=["']([^"']+)["']/i);
	if (pathMatch) {
		SVG_PATH_D = pathMatch[1];
	} else {
		// Fallback to a simple circle if parsing fails
		SVG_PATH_D = "M320 0a320 320 0 1 0 0.0001 0Z";
		SVG_VIEWBOX_SIZE = 640;
	}
}

async function generateIconImages(state /* 'enabled' | 'disabled' */, count) {
	await ensureSvgPathLoaded();
	const color = state === 'enabled' ? "#2196F3" : "#A0A0A0";
	const images = {};
	const label = count > 99 ? "99" : (count > 0 ? String(count) : "");
	for (const size of ICON_SIZES) {
		const canvas = new OffscreenCanvas(size, size);
		const ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, size, size);

		// Draw glyph from parsed path
		ctx.save();
		const scale = size / SVG_VIEWBOX_SIZE;
		ctx.scale(scale, scale);
		const path = new Path2D(SVG_PATH_D);
		ctx.fillStyle = color;
		ctx.fill(path);
		ctx.restore();

		// Draw count in the center if present
		if (label) {
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
		const images = await generateIconImages(state, count);
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

