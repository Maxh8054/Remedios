// Notification Scheduler Service
// Checks every 30 seconds which medications are due and sends push notifications
// Uses HTTP calls to the main Next.js app for database access

import webpush from 'web-push';

const PORT = 3030;
const MAIN_APP_URL = 'http://localhost:3000';

// Configure VAPID
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BLrYiVWZqsJEwU27pe37U6NVZJRH9oZoEdN-GAC4geqN4INO6C5TgMpbGy0eo4awZpjqWLJiMrh-Y3DCGtf9TVo';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'TBb802EsQ5PF3nZ5Bqe1m7d-LVBNf_qfh1Ba1GZxrd4';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:pos-operatorio@app.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Treatment definitions (same as frontend)
const TRATAMENTOS = [
  {
    nome: "Sinot Clav",
    freq: "12 em 12 horas",
    dias: 14,
    inicio: "2026-05-07",
    horarios: ["08:39", "20:39"]
  },
  {
    nome: "Prednisolona",
    freq: "1x ao dia",
    dias: 5,
    inicio: "2026-05-07",
    horarios: ["08:39"]
  },
  {
    nome: "Traumeel",
    freq: "8 em 8 horas",
    dias: 7,
    inicio: "2026-05-07",
    horarios: ["08:42", "16:42", "00:42"]
  },
  {
    nome: "Dipirona",
    freq: "6 em 6 horas se dor",
    dias: 30,
    inicio: "2026-05-07",
    horarios: ["00:00", "06:00", "12:00", "18:00"]
  },
  {
    nome: "Bactroban",
    freq: "4x por dia",
    dias: 90,
    inicio: "2026-05-07",
    horarios: ["18:00", "00:00", "06:00", "12:00"]
  },
  {
    nome: "Soro Fisiológico",
    freq: "6x por dia",
    dias: 30,
    inicio: "2026-05-07",
    horarios: ["18:00", "21:00", "00:00", "03:00", "06:00", "09:00"]
  },
  {
    nome: "Nasoar",
    freq: "2x por dia",
    dias: 21,
    inicio: "2026-05-07",
    horarios: ["18:00", "06:00"]
  },
  {
    nome: "Cloridrato de Nafazolina",
    freq: "8 em 8 horas",
    dias: 7,
    inicio: "2026-05-07",
    horarios: ["18:00", "02:00", "10:00"]
  },
  {
    nome: "Hirudoid",
    freq: "4 em 4 horas",
    dias: 30,
    inicio: "2026-05-07",
    horarios: ["18:00", "22:00", "02:00", "06:00"]
  },
  {
    nome: "Gelo nos roxos",
    freq: "20 min de 2 em 2 horas",
    dias: 14,
    inicio: "2026-05-07",
    horarios: ["20:00", "22:00", "00:00"]
  },
  {
    nome: "Kelo-Cote UV Gel",
    freq: "2x ao dia",
    dias: 90,
    inicio: "2026-05-20",
    horarios: ["08:00", "20:00"]
  }
];

// Track which notifications we've already sent (avoid duplicates)
const sentNotifications = new Set<string>();

// Clean old entries from sentNotifications every hour
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const key of sentNotifications) {
    const parts = key.split('_');
    const timestamp = parseInt(parts[parts.length - 1] || '0');
    if (timestamp < oneHourAgo) {
      sentNotifications.delete(key);
    }
  }
}, 60 * 60 * 1000);

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

async function getSubscriptions(): Promise<Array<{ endpoint: string; p256dh: string; auth: string }>> {
  try {
    const response = await fetch(`${MAIN_APP_URL}/api/subscribe`);
    if (!response.ok) {
      console.error('[NotificationService] Error fetching subscriptions:', response.status);
      return [];
    }
    const data = await response.json();
    return data.subscriptions || [];
  } catch (error) {
    console.error('[NotificationService] Error fetching subscriptions:', error);
    return [];
  }
}

async function getRecentLogs(): Promise<Set<string>> {
  try {
    const response = await fetch(`${MAIN_APP_URL}/api/medication-log`);
    if (!response.ok) return new Set();
    const data = await response.json();
    const keys = (data.logs || []).map((log: any) => log.medicationKey);
    return new Set(keys);
  } catch (error) {
    console.error('[NotificationService] Error fetching medication logs:', error);
    return new Set();
  }
}

async function deleteSubscription(endpoint: string) {
  try {
    await fetch(`${MAIN_APP_URL}/api/subscribe`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint })
    });
  } catch (error) {
    console.error('[NotificationService] Error deleting subscription:', error);
  }
}

async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: object
) {
  try {
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth
      }
    };

    await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
    console.log('[NotificationService] Push sent to', subscription.endpoint.substring(0, 50) + '...');
  } catch (error: any) {
    console.error('[NotificationService] Push failed:', error?.statusCode, error?.message?.substring(0, 100));
    // If subscription is expired or invalid, remove it
    if (error?.statusCode === 410) {
      console.log('[NotificationService] Subscription expired, removing...');
      await deleteSubscription(subscription.endpoint);
    }
  }
}

async function checkAndNotify() {
  const now = new Date();

  console.log(`[NotificationService] Checking at ${now.toISOString()}`);

  const subscriptions = await getSubscriptions();
  const recentLogs = await getRecentLogs();

  if (subscriptions.length === 0) {
    console.log('[NotificationService] No subscriptions registered');
    return;
  }

  for (const t of TRATAMENTOS) {
    for (let d = 0; d < t.dias; d++) {
      const baseDate = addDays(new Date(t.inicio + 'T00:00:00'), d);

      for (let h = 0; h < t.horarios.length; h++) {
        const horario = t.horarios[h];
        const [hours, minutes] = horario.split(':').map(Number);

        const scheduledTime = new Date(baseDate);
        scheduledTime.setHours(hours, minutes, 0, 0);

        // Check if this medication time is within the current minute (±30 seconds window)
        const diff = scheduledTime.getTime() - now.getTime();

        if (diff >= -30000 && diff <= 30000) {
          const notifKey = `${t.nome}_${d}_${h}_${Math.floor(now.getTime() / 60000)}`;

          if (sentNotifications.has(notifKey)) {
            continue; // Already sent
          }

          // Check if recently logged as taken
          const logKey = `${TRATAMENTOS.indexOf(t)}_${d}_${h}`;
          if (recentLogs.has(logKey)) {
            console.log(`[NotificationService] ${t.nome} at ${horario} already taken, skipping`);
            continue;
          }

          console.log(`[NotificationService] 🔔 TIME FOR: ${t.nome} at ${horario} (Day ${d + 1})`);

          sentNotifications.add(notifKey);

          const payload = {
            title: `💊 Hora de ${t.nome}!`,
            body: `${t.nome} - ${t.freq}\nHorário: ${horario} (Dia ${d + 1})`,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            medicationKey: logKey,
            timeKey: horario,
            requireInteraction: true,
            vibrate: [500, 300, 500, 300, 500, 300, 500],
            renotify: true,
            url: '/'
          };

          // Send to all subscriptions
          for (const sub of subscriptions) {
            await sendPushNotification(sub, payload);
          }
        }
      }
    }
  }
}

// Early warning 5 minutes before
async function checkEarlyWarning() {
  const now = new Date();
  const subscriptions = await getSubscriptions();

  if (subscriptions.length === 0) return;

  for (const t of TRATAMENTOS) {
    for (let d = 0; d < t.dias; d++) {
      const baseDate = addDays(new Date(t.inicio + 'T00:00:00'), d);

      for (let h = 0; h < t.horarios.length; h++) {
        const horario = t.horarios[h];
        const [hours, minutes] = horario.split(':').map(Number);

        const scheduledTime = new Date(baseDate);
        scheduledTime.setHours(hours, minutes, 0, 0);

        // 5 minutes before
        const fiveMinBefore = scheduledTime.getTime() - 5 * 60 * 1000;
        const diff = fiveMinBefore - now.getTime();

        if (diff >= -30000 && diff <= 30000) {
          const notifKey = `early_${t.nome}_${d}_${h}_${Math.floor(now.getTime() / 60000)}`;

          if (sentNotifications.has(notifKey)) continue;

          sentNotifications.add(notifKey);

          console.log(`[NotificationService] ⏰ EARLY WARNING: ${t.nome} at ${horario}`);

          const logKey = `${TRATAMENTOS.indexOf(t)}_${d}_${h}`;
          const payload = {
            title: `⏰ Em 5 minutos: ${t.nome}`,
            body: `${t.nome} - ${t.freq}\nHorário: ${horario} (Dia ${d + 1})`,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            medicationKey: logKey,
            timeKey: horario,
            requireInteraction: false,
            vibrate: [200, 100, 200],
            renotify: true,
            url: '/'
          };

          for (const sub of subscriptions) {
            await sendPushNotification(sub, payload);
          }
        }
      }
    }
  }
}

// Simple HTTP health check server
const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'notification-service', uptime: process.uptime() });
    }
    if (url.pathname === '/status') {
      return Response.json({
        status: 'running',
        sentCount: sentNotifications.size,
        treatments: TRATAMENTOS.length,
        timestamp: new Date().toISOString()
      });
    }
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[NotificationService] 🚀 Health check server on port ${PORT}`);
console.log('[NotificationService] 🚀 Starting notification scheduler...');
console.log('[NotificationService] Checking medications every 30 seconds');

// Initial check
checkAndNotify();
checkEarlyWarning();

// Run checks every 30 seconds
setInterval(() => {
  checkAndNotify();
  checkEarlyWarning();
}, 30000);

// Keep the process alive
process.on('SIGINT', () => {
  console.log('[NotificationService] Shutting down...');
  server.stop();
  process.exit(0);
});
