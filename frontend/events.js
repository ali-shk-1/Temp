/**
 * events.js — shared client for live cross-tab updates via Server-Sent
 * Events (see backend/sse.js for the server side).
 *
 * Usage on any page, after api.js + nav.js are loaded and checkAuth() has
 * already run:
 *
 *   connectLiveUpdates({
 *     'students.changed': () => loadStudents(),
 *     'left-students.changed': () => loadStudents(),
 *   });
 *
 * Design notes:
 *   - One EventSource per page load. Browsers auto-reconnect EventSource
 *     on drop (the backend also sends a `retry:` hint), so no manual
 *     reconnect logic is needed here.
 *   - Handlers are looked up by event name; a page only listens for the
 *     events it registered, everything else is ignored — no double
 *     dispatch across pages, no unnecessary refetching.
 *   - Failures here must never break the page: if EventSource isn't
 *     supported, or the connection fails, the page still works exactly
 *     as before (manual refresh), just without the live-update bonus.
 *   - Debounced per event name (300ms) so a burst of related writes
 *     doesn't trigger a refetch storm.
 */

let _liveSource = null;
const _debounceTimers = {};

function connectLiveUpdates(handlers) {
  if (!handlers || typeof handlers !== 'object') return;
  if (typeof EventSource === 'undefined') return; // very old browser — fail silently, no live updates

  // Avoid opening a second connection if this is somehow called twice on
  // the same page (e.g. hot module reload during dev).
  if (_liveSource) {
    try { _liveSource.close(); } catch (e) {}
    _liveSource = null;
  }

  const token = getToken();
  if (!token) return; // checkAuth() will already have redirected to login

  let source;
  try {
    source = new EventSource(`${BASE_URL}/api/events?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.warn('Live updates unavailable:', err.message);
    return;
  }
  _liveSource = source;

  Object.entries(handlers).forEach(([eventName, handler]) => {
    source.addEventListener(eventName, () => {
      // Debounce: if several of the same event arrive in quick
      // succession (e.g. a bulk operation), only refetch once.
      clearTimeout(_debounceTimers[eventName]);
      _debounceTimers[eventName] = setTimeout(() => {
        try {
          handler();
        } catch (err) {
          console.warn(`Live update handler for "${eventName}" failed:`, err.message);
        }
      }, 300);
    });
  });

  source.onerror = () => {
    // EventSource retries automatically; nothing to do here except avoid
    // an unhandled/noisy error. Connection state can be inspected via
    // source.readyState if ever needed for a "reconnecting…" indicator.
  };

  // Close the connection cleanly when the tab is closed/navigated away,
  // rather than leaving the server to detect it via a dropped socket.
  window.addEventListener('beforeunload', () => {
    try { source.close(); } catch (e) {}
  });
}
