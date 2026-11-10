/* Service worker for Trade Ideas browser notifications (docs/trade-ideas.md). It only handles push and clicks;
   it caches nothing and does not intercept requests. The payload is { title, body, url, tag, icon, badge } from buildPush() in lib/ideaMessages.ts. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// SAFE-PATH-START (extracted and tested by scripts/test-idea-alerts.mjs)
// Same-origin only: resolve against our origin, reject backslashes / control characters, keep path + query + hash.
function safePath(url, fallback) {
  if (typeof url !== 'string' || /[\\\u0000-\u001f\u007f]/.test(url) || !url.startsWith('/')) return fallback;
  try {
    const u = new URL(url, self.location.origin);
    if (u.origin !== self.location.origin) return fallback;
    const out = u.pathname + u.search + u.hash;
    // Dot segments can normalise to a protocol-relative path ('/.//evil.example' -> '//evil.example').
    if (!out.startsWith('/') || out.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(out)) return fallback;
    // Belt and braces: the result must itself resolve to our origin (idempotent, safe for any later new URL(out, origin)).
    if (new URL(out, self.location.origin).origin !== self.location.origin) return fallback;
    return out;
  } catch { return fallback; }
}
// SAFE-PATH-END

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Trade Ideas';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    lang: 'en',
    // Hand-written SVG artwork (public/idea-alert-*.svg). Browser support for SVG notification icons varies; a
    // notification without a loadable icon still shows its title and body.
    icon: safePath(data.icon, '/idea-alert-icon.svg'),
    badge: safePath(data.badge, '/idea-alert-badge.svg'),
    // Same-site paths only: reject protocol-relative URLs ("//host").
    data: { url: safePath(data.url, '/ideas') },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = safePath(event.notification.data && event.notification.data.url, '/ideas');
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if ('focus' in c) { c.navigate(url); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
