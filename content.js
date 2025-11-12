// Runs on https://bsky.app/*
// When the current route is /saved, scans for saved post anchors that match /profile/*/post/*
// Enables middle-click to open the post in a new tab and notifies the background page with the count.

const PROFILE_POST_SELECTOR = 'a[href^="/profile/"][href*="/post/"]';
const HANDLED_CONTAINER_FLAG = 'bskySavedHandled';
const SCAN_DEBOUNCE_MS = 100;
const MIDDLE_BUTTON = 1;

const state = {
	lastReportedCount: -1,
	/** @type {ReturnType<typeof setTimeout> | null} */
	scanTimer: null,
};

/**
 * Checks if the current page is the Bluesky saved posts page.
 * @returns {boolean} True if on /saved route
 * @why We only want to scan and count posts on the saved page, not on other Bluesky pages.
 */
const isOnSavedPage = () => location.hostname === 'bsky.app' && location.pathname.startsWith('/saved');

/**
 * Converts a relative URL to an absolute URL.
 * @param {string} href - Relative URL path
 * @returns {string} Absolute URL
 * @why window.open() needs absolute URLs to work correctly, and post links are relative paths.
 */
const toAbsoluteUrl = (href) => {
	try {
		return new URL(href, location.origin).toString();
	} catch {
		return href;
	}
};

/**
 * Prevents the default browser behavior for middle-click (autoscroll).
 * @param {MouseEvent} event - Mouse event
 * @why Middle-click normally triggers autoscroll in browsers. We need to prevent this so our custom handler can open the post instead.
 */
const preventMiddleClickDefaults = (event) => {
	if (event.button !== MIDDLE_BUTTON) return;
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation?.();
};

/**
 * Creates an event handler that opens a URL in a new tab on middle-click.
 * @param {string} url - URL to open
 * @returns {(event: MouseEvent) => void} Event handler function
 * @why This is the actual action we want: middle-click should open the saved post in a new tab.
 */
const handleAuxClick = (url) => (event) => {
	if (event.button !== MIDDLE_BUTTON) return;
	event.preventDefault();
	event.stopPropagation();
	window.open(url, '_blank', 'noopener');
};

/**
 * Attaches middle-click handlers to a saved post container element.
 * @param {HTMLElement} container - The interactive container div
 * @param {HTMLAnchorElement} anchor - The post link anchor element
 * @why The container is the clickable area users interact with. We attach handlers here so middle-click anywhere on the post card opens it.
 */
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

/**
 * Checks if an element is visible on the page.
 * @param {Element} element - Element to check
 * @returns {boolean} True if element is visible
 * @why We only want to count and enable middle-click on posts that are actually visible. Hidden posts (from other routes or collapsed) shouldn't be counted.
 */
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

/**
 * Sends the post count to the background script to update the extension icon.
 * @param {number} count - Number of saved posts found
 * @why The background script needs to know the count to update the icon badge and color. We skip sending if the count hasn't changed to avoid unnecessary updates.
 */
function sendCount(count) {
	if (state.lastReportedCount === count) return;
	state.lastReportedCount = count;
	try {
		chrome.runtime.sendMessage({ type: 'FOUND_COUNT', count });
	} catch {
		// Ignore: runtime might be unavailable during shutdown
	}
}

/**
 * Scans the DOM for saved posts, attaches middle-click handlers to them, and reports the count.
 * @why This is the main function that finds all saved posts, enables middle-click functionality, and keeps the icon count accurate. It only counts top-level posts (not nested quoted posts). The name reflects that it both scans the DOM structure and attaches (binds) event handlers to the found elements.
 */
function scanDOMAndAttachHandlers() {
	if (state.scanTimer !== null) {
		clearTimeout(state.scanTimer);
		state.scanTimer = null;
	}
	if (!isOnSavedPage()) {
		sendCount(0);
		return;
	}

	const scope = document.querySelector('main') ?? document;
	// Find all top-level saved post containers first
	const topLevelContainers = /** @type {HTMLElement[]} */ (
		Array.from(scope.querySelectorAll('div[role="link"][tabindex]'))
	).filter((container) => {
		// Only count containers that are visible and don't have another container as a parent
		if (!isVisible(container)) return false;
		// Check if this container is nested inside another container (exclude nested posts)
		const parentContainer = container.parentElement?.closest('div[role="link"][tabindex]');
		return !parentContainer;
	});

	const uniqueHrefs = new Set();

	for (const container of topLevelContainers) {
		// Find the post link within this container
		const anchor = /** @type {HTMLAnchorElement | null} */ (container.querySelector(PROFILE_POST_SELECTOR));
		if (!anchor) continue;

		const href = anchor.getAttribute('href') ?? '';
		if (!/^\/profile\/[^/]+\/post\/[^/]+/.test(href)) continue;
		if (!isVisible(anchor)) continue;

		uniqueHrefs.add(href);
		ensureMiddleClick(container, anchor);
	}

	sendCount(uniqueHrefs.size);
}

/**
 * Schedules a debounced scan of the page.
 * @why Prevents excessive scanning when the DOM changes rapidly (e.g., during scrolling). Only one scan will run after changes settle.
 */
function scheduleScan() {
	if (state.scanTimer !== null) return;
	state.scanTimer = setTimeout(scanDOMAndAttachHandlers, SCAN_DEBOUNCE_MS);
}

/**
 * Initializes DOM mutation observers and event listeners to detect page changes.
 * @why The saved posts page loads content dynamically as you scroll. We need to watch for new posts being added to the DOM and re-scan when the page becomes visible again (e.g., when switching tabs back to Bluesky).
 */
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

/**
 * Initializes the extension by setting up observers and running the initial scan.
 * @why This is the entry point that sets up all the necessary infrastructure (DOM watching, event listeners) and performs the first scan to find saved posts.
 */
function bootstrap() {
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
