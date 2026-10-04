/* Service worker: precaches the app shell and shows push reminders.
   Built by vite-plugin-pwa (injectManifest); self.__WB_MANIFEST is filled in at build time. */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// Any navigation (including /#calls from a home-screen shortcut) gets the cached shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));
clientsClaim();

// Update mode is "prompt": the app asks before switching. It sends SKIP_WAITING when you tap Reload.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Push reminders sent by the Supabase "reminders" function.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Life Command Center';
  e.waitUntil((async () => {
    try {
      await self.registration.showNotification(title, {
        body: d.body || '',
        tag: d.tag || 'lcc',
        renotify: !!d.renotify,
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        data: { url: d.url || '/' },
      });
    } catch (err) { /* permission withdrawn; the app still gets the message below */ }
    // If the app is open, let it show the nudge inline too.
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    cs.forEach((c) => c.postMessage({ type: 'lcc-push', title, body: d.body || '', url: d.url || '/' }));
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) {
        if (c.navigate && new URL(c.url).pathname === new URL(url, self.location.origin).pathname) {
          return c.focus().then(() => c.navigate(url).catch(() => {}));
        }
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
