// Runs on https://bsky.app/*
// When on /saved, finds anchors matching /profile/*/post/* and enables middle-click handlers,
// and reports counts to the background for icon rendering.

const PROFILE_POST_SELECTOR = 'a[href^="/profile/"][href*="/post/"]';
const HANDLED_FLAG = 'bskySavedHandled';
const CANCEL_LISTENER_KEY = 'bskySavedCancelListener';
const HANDLED_FLAG_ANCHOR = 'bskySavedHandledAnchor';

let lastCountReported = -1;
let scanScheduled = false;

function isOnSavedPage() {
	return location.hostname === 'bsky.app' && location.pathname.startsWith('/saved');
}

function toAbsoluteUrl(href) {
	try {
		return new URL(href, location.origin).toString();
	} catch {
		return href;
	}
}

function attachMiddleClick(container, anchor) {
	if (!container || container.dataset[HANDLED_FLAG] === '1') return;
	container.dataset[HANDLED_FLAG] = '1';
	container.style.cursor = 'pointer';

	const href = anchor.getAttribute('href') || '';
	const url = toAbsoluteUrl(href);

	const cancelMiddle = (ev) => {
		if (ev.button === 1) {
			ev.preventDefault();
			ev.stopPropagation();
			if (typeof ev.stopImmediatePropagation === 'function') {
				ev.stopImmediatePropagation();
			}
		}
	};

	const openOnAuxClick = (ev) => {
		if (ev.button === 1) {
			ev.preventDefault();
			ev.stopPropagation();
			window.open(url, '_blank', 'noopener');
		}
	};

	container.addEventListener('pointerdown', cancelMiddle, true);
	container.addEventListener('pointerup', cancelMiddle, true);
	container.addEventListener('mousedown', cancelMiddle, true);
	container.addEventListener('mouseup', cancelMiddle, true);
	container.addEventListener('auxclick', openOnAuxClick, true);

	// Store references so we could remove later if needed (not required now but avoids duplicates)
	container.dataset[CANCEL_LISTENER_KEY] = '1';
}

function findInteractiveContainer(element) {
	// Prefer the focusable clickable wrapper
	return element.closest('div[role="link"][tabindex]');
}

function attachMiddleClickToAnchor(anchor) {
	if (!anchor || anchor.dataset[HANDLED_FLAG_ANCHOR] === '1') return;
	anchor.dataset[HANDLED_FLAG_ANCHOR] = '1';
	const href = anchor.getAttribute('href') || '';
	const url = toAbsoluteUrl(href);

	const cancelMiddle = (ev) => {
		if (ev.button === 1) {
			ev.preventDefault();
			ev.stopPropagation();
			if (typeof ev.stopImmediatePropagation === 'function') {
				ev.stopImmediatePropagation();
			}
		}
	};
	const openOnAuxClick = (ev) => {
		if (ev.button === 1) {
			ev.preventDefault();
			ev.stopPropagation();
			window.open(url, '_blank', 'noopener');
		}
	};
	anchor.addEventListener('pointerdown', cancelMiddle, true);
	anchor.addEventListener('pointerup', cancelMiddle, true);
	anchor.addEventListener('mousedown', cancelMiddle, true);
	anchor.addEventListener('mouseup', cancelMiddle, true);
	anchor.addEventListener('auxclick', openOnAuxClick, true);
}

function collectProfileAnchors(root) {
	const results = [];
	const visit = (node) => {
		if (!node) return;
		if (node.nodeType === Node.ELEMENT_NODE) {
			const el = /** @type {Element} */ (node);
			if (el.matches && el.matches(PROFILE_POST_SELECTOR)) {
				results.push(el);
			}
			// Traverse shadow DOM if present
			if (el.shadowRoot) {
				visit(el.shadowRoot);
			}
		}
		const children = node.children || node.childNodes;
		for (const child of children) {
			visit(child);
		}
	};
	visit(root);
	return results;
}

function isElementVisible(el) {
	try {
		const style = window.getComputedStyle(el);
		if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) {
			return false;
		}
		// offsetParent is null for display:none or fixed-position body children in some cases;
		// fall back to rect size.
		const rect = el.getBoundingClientRect();
		if ((rect.width || rect.right - rect.left) <= 0 || (rect.height || rect.bottom - rect.top) <= 0) {
			return false;
		}
		return true;
	} catch {
		return true;
	}
}

function scanAndBind() {
	scanScheduled = false;

	// If not on /saved, report 0 and bail
	if (!isOnSavedPage()) {
		if (lastCountReported !== 0) {
			lastCountReported = 0;
			try {
				chrome.runtime.sendMessage({ type: 'FOUND_COUNT', count: 0 });
			} catch {}
		}
		return;
	}

	// Limit search to main content area if present to avoid counting hidden/off-route content
	const scope = document.querySelector('main') || document;
	const anchors = collectProfileAnchors(scope);
	let boundCount = 0;

	// Deduplicate by href to avoid double counting across reused/memoized DOM nodes
	const hrefSet = new Set();

	anchors.forEach((anchor) => {
		const a = /** @type {HTMLAnchorElement} */ (anchor);
		const href = a.getAttribute('href') || '';
		// Ensure it actually matches /profile/.../post/... (guard against false positives)
		if (!/^\/profile\/[^/]+\/post\/[^/]+/.test(href)) return;
		// Require visibility to avoid counting hidden off-route DOM
		if (!isElementVisible(a)) return;
		const container = findInteractiveContainer(a);
		if (container && !isElementVisible(container)) return;
		hrefSet.add(href);
		attachMiddleClickToAnchor(a);
		if (container) {
			const before = container.dataset[HANDLED_FLAG] === '1';
			attachMiddleClick(container, a);
			if (!before) boundCount += 1;
		}
	});

	const totalDetected = hrefSet.size;
	if (totalDetected !== lastCountReported) {
		lastCountReported = totalDetected;
		try {
			chrome.runtime.sendMessage({ type: 'FOUND_COUNT', count: totalDetected });
		} catch {
			// Ignore if messaging is not available yet
		}
	}
}

function scheduleScan() {
	if (scanScheduled) return;
	scanScheduled = true;
	// Debounce rapid DOM mutations
	setTimeout(scanAndBind, 100);
}

// Initial scan
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', scheduleScan, { once: true });
} else {
	scheduleScan();
}

// Detect client-side route changes (pushState/replaceState) and re-scan when path changes
(function patchHistory() {
	const dispatch = () => window.dispatchEvent(new Event('locationchange'));
	const origPush = history.pushState;
	const origReplace = history.replaceState;
	history.pushState = function () {
		const ret = origPush.apply(this, arguments);
		// Force next report regardless of previous value to avoid stale counts
		lastCountReported = -1;
		dispatch();
		return ret;
	};
	history.replaceState = function () {
		const ret = origReplace.apply(this, arguments);
		lastCountReported = -1;
		dispatch();
		return ret;
	};
	window.addEventListener('popstate', dispatch);
	window.addEventListener('locationchange', () => {
		lastCountReported = -1;
		scheduleScan();
	});
})();

// Observe dynamic changes (the page is client-rendered and updates as you scroll)
const observer = new MutationObserver((mutations) => {
	for (const m of mutations) {
		if (m.addedNodes && m.addedNodes.length > 0) {
			scheduleScan();
			break;
		}
	}
});

try {
	observer.observe(document.documentElement || document.body, {
		childList: true,
		subtree: true,
	});
} catch {
	// In rare cases, observing can fail; the initial scan still works.
}

// Re-scan on BFCache restore or same-tab back/forward without full reload
window.addEventListener('pageshow', (ev) => {
	// When coming back from another site, BFCache restore may skip DOM events
	// Always re-scan when page is shown again
	scheduleScan();
});

// Re-scan on history navigation inside same tab
window.addEventListener('popstate', () => {
	scheduleScan();
});

// Re-scan when tab becomes visible again
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible') {
		scheduleScan();
	}
});

// Re-scan on window focus (covers some edge cases)
window.addEventListener('focus', () => {
	scheduleScan();
});


