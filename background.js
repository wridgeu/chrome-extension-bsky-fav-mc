// MV3 service worker: renders the Bluesky glyph, swaps icon state, and syncs the action badge

const ICON_SIZES = [16, 32];
const FILL_COLORS = {
	enabled: '#2196F3',
	disabled: '#A0A0A0',
};
const MAX_SHOWN_COUNT = 99;

let svgPathData = null;
let svgViewBoxSize = 640;

const renderedIconCache = new Map(); // state => {16: ImageData, 32: ImageData}
const tabCounts = new Map();

const limitCountLabel = (count = 0) => {
	if (count <= 0 || !Number.isFinite(count)) return '';
	if (count > MAX_SHOWN_COUNT) return `${MAX_SHOWN_COUNT}+`;
	return String(count);
};

async function ensureSvgPathLoaded() {
	if (svgPathData) return;
	const svgUrl = chrome.runtime.getURL('icons/icon-blue.svg');
	const res = await fetch(svgUrl);
	if (!res.ok) {
		throw new Error(`Failed to fetch icon SVG: ${res.status} ${res.statusText}`);
	}
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
	if (!pathMatch || !pathMatch[1]) {
		throw new Error('Failed to parse SVG path data from icon-blue.svg');
	}
	svgPathData = pathMatch[1];
}

async function getIconImages(state) {
	await ensureSvgPathLoaded();
	if (renderedIconCache.has(state)) {
		return renderedIconCache.get(state);
	}

	const images = {};
	for (const size of ICON_SIZES) {
		const canvas = new OffscreenCanvas(size, size);
		const ctx = canvas.getContext('2d', { alpha: true });
		if (!ctx) {
			continue;
		}
		ctx.clearRect(0, 0, size, size);

		ctx.save();
		const scale = size / svgViewBoxSize;
		ctx.scale(scale, scale);
		const path = new Path2D(svgPathData);
		ctx.fillStyle = FILL_COLORS[state];
		ctx.fill(path);
		ctx.restore();

		images[size] = ctx.getImageData(0, 0, size, size);
	}

	renderedIconCache.set(state, images);
	return images;
}

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
		const currentCount = tabCounts.get(tabId) ?? 0;
		await applyIcon(tabId, currentCount);
	} catch (error) {
		console.error('Failed to update icon for activated tab', error);
	}
});

chrome.tabs.onRemoved.addListener((tabId) => {
	tabCounts.delete(tabId);
});

