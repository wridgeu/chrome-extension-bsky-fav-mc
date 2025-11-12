// Runs on https://bsky.app/*
// When the current route is /saved, scans for saved post anchors that match /profile/*/post/*
// Enables middle-click to open the post in a new tab and notifies the background page with the count.

const PROFILE_POST_SELECTOR = 'a[href^="/profile/"][href*="/post/"]';
const HISTORY_PATCH_FLAG = '__bskySavedHistoryPatched';
const HANDLED_CONTAINER_FLAG = 'bskySavedHandled';
const HANDLED_ANCHOR_FLAG = 'bskySavedHandledAnchor';
const SCAN_DEBOUNCE_MS = 100;
const MIDDLE_BUTTON = 1;

const state = {
	lastReportedCount: -1,
	scanTimer: null,
};

const isOnSavedPage = () => location.hostname === 'bsky.app' && location.pathname.startsWith('/saved');

const toAbsoluteUrl = (href) => {
	try {
		return new URL(href, location.origin).toString();
	} catch {
		return href;
	}
};

const preventMiddleClickDefaults = (event) => {
	if (event.button !== MIDDLE_BUTTON) return;
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation?.();
};

const handleAuxClick = (url) => (event) => {
	if (event.button !== MIDDLE_BUTTON) return;
	event.preventDefault();
	event.stopPropagation();
	window.open(url, '_blank', 'noopener');
};

function ensureMiddleClick(container, anchor) {
	if (!container || container.dataset[HANDLED_CONTAINER_FLAG] === '1') return;
	const href = anchor.getAttribute('href') ?? '';
	const absoluteUrl = toAbsoluteUrl(href);

	container.dataset[HANDLED_CONTAINER_FLAG] = '1';
	container.style.cursor = 'pointer';

	container.addEventListener('pointerdown', preventMiddleClickDefaults, true);
	container.addEventListener('pointerup', preventMiddleClickDefaults, true);
	container.addEventListener('mousedown', preventMiddleClickDefaults, true);
	container.addEventListener('mouseup', preventMiddleClickDefaults, true);
	container.addEventListener('auxclick', handleAuxClick(absoluteUrl), true);
}

function ensureAnchorMiddleClick(anchor) {
	if (!anchor || anchor.dataset[HANDLED_ANCHOR_FLAG] === '1') return;
	const href = anchor.getAttribute('href') ?? '';
	const absoluteUrl = toAbsoluteUrl(href);

	anchor.dataset[HANDLED_ANCHOR_FLAG] = '1';
	anchor.addEventListener('pointerdown', preventMiddleClickDefaults, true);
	anchor.addEventListener('pointerup', preventMiddleClickDefaults, true);
	anchor.addEventListener('mousedown', preventMiddleClickDefaults, true);
	anchor.addEventListener('mouseup', preventMiddleClickDefaults, true);
	anchor.addEventListener('auxclick', handleAuxClick(absoluteUrl), true);
}

function findInteractiveContainer(element) {
	return element.closest('div[role="link"][tabindex]');
}

function isVisible(element) {
	try {
		const style = window.getComputedStyle(element);
		if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity ?? '1') === 0) {
			return false;
		}
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	} catch {
		return true;
	}
}

function collectProfileAnchors(root) {
	const collected = [];
	const stack = [root];
	while (stack.length) {
		const node = stack.pop();
		if (!node) continue;
		if (node.nodeType === Node.ELEMENT_NODE) {
			const element = /** @type {Element} */ (node);
			if (element.matches?.(PROFILE_POST_SELECTOR)) {
				collected.push(element);
			}
			if (element.shadowRoot) {
				stack.push(element.shadowRoot);
			}
			stack.push(...element.children);
		} else if (node.childNodes?.length) {
			stack.push(...node.childNodes);
		}
	}
	return collected;
}

function sendCount(count) {
	if (state.lastReportedCount === count) return;
	state.lastReportedCount = count;
	try {
		chrome.runtime.sendMessage({ type: 'FOUND_COUNT', count });
	} catch {
		// Ignore: runtime might be unavailable during shutdown
	}
}

function scanAndBind() {
	state.scanTimer = null;
	if (!isOnSavedPage()) {
		sendCount(0);
		return;
	}

	const scope = document.querySelector('main') ?? document;
	// Find all top-level saved post containers first
	const topLevelContainers = Array.from(scope.querySelectorAll('div[role="link"][tabindex]')).filter(
		(container) => {
			// Only count containers that are visible and don't have another container as a parent
			if (!isVisible(container)) return false;
			// Check if this container is nested inside another container (exclude nested posts)
			const parentContainer = container.parentElement?.closest('div[role="link"][tabindex]');
			return !parentContainer;
		},
	);

	const uniqueHrefs = new Set();

	for (const container of topLevelContainers) {
		// Find the post link within this container
		const anchor = container.querySelector(PROFILE_POST_SELECTOR);
		if (!anchor) continue;

		const href = anchor.getAttribute('href') ?? '';
		if (!/^\/profile\/[^/]+\/post\/[^/]+/.test(href)) continue;
		if (!isVisible(anchor)) continue;

		uniqueHrefs.add(href);
		ensureAnchorMiddleClick(anchor);
		ensureMiddleClick(container, anchor);
	}

	sendCount(uniqueHrefs.size);
}

function scheduleScan() {
	if (state.scanTimer !== null) return;
	state.scanTimer = setTimeout(scanAndBind, SCAN_DEBOUNCE_MS);
}

function patchHistoryOnce() {
	if (window[HISTORY_PATCH_FLAG]) return;
	window[HISTORY_PATCH_FLAG] = true;
	const dispatch = () => window.dispatchEvent(new Event('locationchange'));
	const originalPush = history.pushState;
	const originalReplace = history.replaceState;

	history.pushState = function pushStatePatched() {
		const result = originalPush.apply(this, arguments);
		state.lastReportedCount = -1;
		dispatch();
		return result;
	};

	history.replaceState = function replaceStatePatched() {
		const result = originalReplace.apply(this, arguments);
		state.lastReportedCount = -1;
		dispatch();
		return result;
	};

	window.addEventListener('popstate', () => {
		state.lastReportedCount = -1;
		scheduleScan();
	});
	window.addEventListener('locationchange', () => {
		state.lastReportedCount = -1;
		scheduleScan();
	});
}

function initObservers() {
	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.addedNodes?.length) {
				scheduleScan();
				break;
			}
		}
	});

	try {
		observer.observe(document.documentElement ?? document.body, {
			childList: true,
			subtree: true,
		});
	} catch {
		// Observing may fail in rare cases; rely on other signals
	}

	window.addEventListener('pageshow', scheduleScan, { passive: true });
	window.addEventListener('popstate', scheduleScan, { passive: true });
	window.addEventListener('focus', scheduleScan, { passive: true });
	document.addEventListener(
		'visibilitychange',
		() => {
			if (document.visibilityState === 'visible') scheduleScan();
		},
		{ passive: true },
	);
}

function bootstrap() {
	patchHistoryOnce();
	initObservers();
	if (document.readyState === 'loading') {
		document.addEventListener(
			'DOMContentLoaded',
			() => {
				state.lastReportedCount = -1;
				scheduleScan();
			},
			{ once: true },
		);
	} else {
		scheduleScan();
	}
}

bootstrap();
