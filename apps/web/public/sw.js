/* Dhvaj Portal service worker: quick-task alerts when the portal is not open.
 *
 * The API pushes { kind, taskId, title, body, urgent, url, ring } (encrypted
 * by Web Push). If the portal is open and in front of the person, the page's
 * own full-screen alert already has it; otherwise this shows a system
 * notification — with the device's sound — that stays up for an urgent task
 * and opens the task when clicked.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let a = null;
  try {
    a = event.data ? event.data.json() : null;
  } catch {
    a = null;
  }
  if (!a || !a.taskId) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const inFront = wins.some((w) => w.visibilityState === 'visible' && w.focused);
      if (inFront) return undefined;
      return self.registration.showNotification(a.title || 'Dhvaj Portal', {
        body: a.body || '',
        // One notification per task: a newer one replaces it, and sounds again.
        tag: 'quick-task-' + a.taskId,
        renotify: true,
        requireInteraction: !!a.urgent,
        vibrate: a.urgent ? [400, 150, 400, 150, 400] : [200],
        timestamp: a.at ? Date.parse(a.at) : Date.now(),
        data: { url: a.url || '/quick-tasks' },
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const same = wins.find((w) => new URL(w.url).origin === url.origin);
      if (same) {
        return same.focus().then((w) => (w && 'navigate' in w ? w.navigate(url.href) : w));
      }
      return self.clients.openWindow(url.href);
    }),
  );
});
