// MV3 service worker: renders the Bluesky glyph, overlays the count, and keeps tab badges in sync

const ICON_SIZES = [16, 32];
const FILL_COLORS = {
	enabled: '#2196F3',
	disabled: '#A0A0A0',
};
const FALLBACK_PATH =
	'M320 0A320 320 0 1 0 640 320 320 320 0 0 0 320 0Z'; // simple circle in case parsing fails
const MAX_SHOWN_COUNT = 99;

let svgPathData = null;
let svgViewBoxSize = 640;

const renderedIconCache = new Map(); // key => {16: ImageData, 32: ImageData}
const tabCounts = new Map();

const isSavedUrl = (url = '') => /^https:\/\/bsky\.app\/saved/.test(url);
const cacheKey = (state, label) => `${state}:${label}`;
const limitCountLabel = (count = 0) =>
	count > MAX_SHOWN_COUNT ? String(MAX_SHOWN_COUNT) : count > 0 ? String(count) : '';

async function ensureSvgPathLoaded() {
	if (svgPathData) return;
	try {
		const svgUrl = chrome.runtime.getURL('icons/icon-blue.svg');
		const res = await fetch(svgUrl);
		const svgText = await res.text();
		const viewBoxMatch = svgText.match(/viewBox=["']\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*["']/i);
		if (viewBoxMatch) {
			const width = Number(viewBoxMatch[1]);
			const height = Number(viewBoxMatch[2]);
			const maxSize = Math.max(width || 0, height || 0);
			if (maxSize > 0) {
				svgViewBoxSize = maxSize;
			}
		}
		const pathMatch = svgText.match(/<path[^>]*\sd=["']([^"']+)["']/i);
		svgPathData = pathMatch ? pathMatch[1] : FALLBACK_PATH;
	} catch (error) {
		console.error('Failed to load icon SVG; falling back to circle.', error);
		svgPathData = FALLBACK_PATH;
		svgViewBoxSize = 640;
	}
}

async function getIconImages(state, count) {
	await ensureSvgPathLoaded();
	const label = limitCountLabel(count);
	const key = cacheKey(state, label);
	if (renderedIconCache.has(key)) {
		return renderedIconCache.get(key);
	}

	const images = {};
	for (const size of ICON_SIZES) {
		const canvas = new OffscreenCanvas(size, size);
		const ctx = canvas.getContext('2d', { alpha: true });
		ctx.clearRect(0, 0, size, size);

		ctx.save();
		const scale = size / svgViewBoxSize;
		ctx.scale(scale, scale);
		const path = new Path2D(svgPathData);
		ctx.fillStyle = FILL_COLORS[state];
		ctx.fill(path);
		ctx.restore();

		if (label) {
			const fontSize = Math.max(8, Math.floor(size * 0.7));
			ctx.font = `700 ${fontSize}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.lineWidth = Math.max(1, Math.ceil(size * 0.15));
			ctx.strokeStyle = 'rgba(0,0,0,0.75)';
			ctx.strokeText(label, size / 2, size / 2);
			ctx.fillStyle = '#FFFFFF';
			ctx.fillText(label, size / 2, size / 2);
		}

		images[size] = ctx.getImageData(0, 0, size, size);
	}

	renderedIconCache.set(key, images);
	return images;
}

async function applyIcon(tabId, count) {
	const state = count > 0 ? 'enabled' : 'disabled';
	try {
		const imageData = await getIconImages(state, count);
		await chrome.action.setIcon({ tabId, imageData });
		await chrome.action.setTitle({
			tabId,
			title: state === 'enabled' ? 'Bluesky Saved: posts detected' : 'Bluesky Saved: no posts detected',
		});
	} catch (error) {
		console.error('Failed to set action icon', error);
	}
}

function setTabCount(tabId, count) {
	tabCounts.set(tabId, count);
	return applyIcon(tabId, count);
}

function resetTab(tabId) {
	tabCounts.set(tabId, 0);
	return applyIcon(tabId, 0);
}

chrome.runtime.onMessage.addListener((message, sender) => {
	if (!sender?.tab?.id || !message || message.type !== 'FOUND_COUNT') {
		return;
	}
	const { id: tabId } = sender.tab;
	const count = Number.isFinite(message.count) ? Number(message.count) : 0;
	setTabCount(tabId, count);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status === 'loading' || changeInfo.url) {
		resetTab(tabId);
	}
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
	try {
		const tab = await chrome.tabs.get(tabId);
		if (!isSavedUrl(tab?.url)) {
			resetTab(tabId);
			return;
		}
		const currentCount = tabCounts.get(tabId) ?? 0;
		await applyIcon(tabId, currentCount);
	} catch (error) {
		console.error('Failed to update icon for activated tab', error);
	}
});

chrome.tabs.onRemoved.addListener((tabId) => {
	tabCounts.delete(tabId);
});

