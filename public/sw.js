// Service Worker for Push Notifications - Pós Operatório

const CACHE_NAME = 'pos-operatorio-v1';

// Install event
self.addEventListener('install', (event) => {
  console.log('[SW] Service Worker installed');
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('[SW] Service Worker activated');
  event.waitUntil(clients.claim());
});

// Push event - receive push notification from server
self.addEventListener('push', (event) => {
  console.log('[SW] Push received', event);

  let data = {
    title: 'Hora do Medicamento!',
    body: 'Está na hora de tomar seu remédio.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'medication-reminder',
    requireInteraction: true,
    vibrate: [500, 300, 500, 300, 500, 300, 500],
    renotify: true,
    sound: 'default'
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      data = { ...data, ...payload };
    } catch (e) {
      data.body = event.data.text() || data.body;
    }
  }

  // Create unique tag per medication to allow multiple notifications
  if (data.medicationKey) {
    data.tag = `med-${data.medicationKey}-${data.timeKey || Date.now()}`;
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      tag: data.tag,
      requireInteraction: data.requireInteraction,
      vibrate: data.vibrate,
      renotify: data.renotify,
      silent: false,
      actions: [
        { action: 'taken', title: '✅ Tomei' },
        { action: 'snooze', title: '⏰ Lembre em 15min' }
      ],
      data: {
        medicationKey: data.medicationKey || '',
        timeKey: data.timeKey || '',
        url: data.url || '/'
      }
    })
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked', event.action);

  const notification = event.notification;
  notification.close();

  if (event.action === 'taken') {
    // Mark medication as taken via API
    const medicationKey = notification.data?.medicationKey;
    const timeKey = notification.data?.timeKey;
    if (medicationKey) {
      fetch('/api/medication-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medicationKey, timeKey, takenAt: new Date().toISOString() })
      }).catch(err => console.error('[SW] Error logging medication:', err));
    }
    // Focus or open the app
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        if (clientList.length > 0) {
          return clientList[0].focus();
        }
        return clients.openWindow(notification.data?.url || '/');
      })
    );
  } else if (event.action === 'snooze') {
    // Schedule a new notification in 15 minutes
    const medicationKey = notification.data?.medicationKey;
    const timeKey = notification.data?.timeKey;
    const title = notification.title || 'Hora do Medicamento!';
    const body = notification.body || '';

    setTimeout(() => {
      self.registration.showNotification(title, {
        body: body + ' (lembrete)',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: `snooze-${medicationKey}-${Date.now()}`,
        requireInteraction: true,
        vibrate: [500, 300, 500, 300, 500, 300, 500],
        renotify: true,
        silent: false,
        actions: [
          { action: 'taken', title: '✅ Tomei' },
          { action: 'snooze', title: '⏰ Lembre em 15min' }
        ],
        data: notification.data || {}
      });
    }, 15 * 60 * 1000); // 15 minutes
  } else {
    // Default click - open the app
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        if (clientList.length > 0) {
          return clientList[0].focus();
        }
        return clients.openWindow(notification.data?.url || '/');
      })
    );
  }
});

// Push subscription change event
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[SW] Push subscription changed');
  event.waitUntil(
    fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldEndpoint: event.oldSubscription?.endpoint,
        subscription: event.newSubscription
      })
    }).catch(err => console.error('[SW] Error updating subscription:', err))
  );
});
