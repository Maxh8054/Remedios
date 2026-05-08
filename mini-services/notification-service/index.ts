// Notification Scheduler Service
// Checks every 30 seconds which medications are due and sends:
// 1. Push notifications
// 2. WhatsApp messages to configured numbers

import webpush from 'web-push';

const PORT = 3030;
const MAIN_APP_URL = 'http://localhost:3000';
const WHATSAPP_SERVICE_URL = 'http://localhost:3040';

// WhatsApp phone numbers
const WHATSAPP_NUMBERS = [
  '5562981206800',
  '5562982093453',
  '5562983068941'
];

// Configure VAPID
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BLrYiVWZqsJEwU27pe37U6NVZJRH9oZoEdN-GAC4geqN4INO6C5TgMpbGy0eo4awZpjqWLJiMrh-Y3DCGtf9TVo';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'TBb802EsQ5PF3nZ5Bqe1m7d-LVBNf_qfh1Ba1GZxrd4';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:pos-operatorio@app.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const TRATAMENTOS = [
  { nome: "Sinot Clav", freq: "12 em 12 horas", dias: 14, inicio: "2026-05-07", horarios: ["08:39", "20:39"] },
  { nome: "Prednisolona", freq: "1x ao dia", dias: 5, inicio: "2026-05-07", horarios: ["08:39"] },
  { nome: "Traumeel", freq: "8 em 8 horas", dias: 7, inicio: "2026-05-07", horarios: ["08:42", "16:42", "00:42"] },
  { nome: "Dipirona", freq: "6 em 6 horas se dor", dias: 30, inicio: "2026-05-07", horarios: ["00:00", "06:00", "12:00", "18:00"] },
  { nome: "Bactroban", freq: "4x por dia", dias: 90, inicio: "2026-05-07", horarios: ["18:00", "00:00", "06:00", "12:00"] },
  { nome: "Soro Fisiológico", freq: "6x por dia", dias: 30, inicio: "2026-05-07", horarios: ["18:00", "21:00", "00:00", "03:00", "06:00", "09:00"] },
  { nome: "Nasoar", freq: "2x por dia", dias: 21, inicio: "2026-05-07", horarios: ["18:00", "06:00"] },
  { nome: "Cloridrato de Nafazolina", freq: "8 em 8 horas", dias: 7, inicio: "2026-05-07", horarios: ["18:00", "02:00", "10:00"] },
  { nome: "Hirudoid", freq: "4 em 4 horas", dias: 30, inicio: "2026-05-07", horarios: ["18:00", "22:00", "02:00", "06:00"] },
  { nome: "Gelo nos roxos", freq: "20 min de 2 em 2 horas", dias: 14, inicio: "2026-05-07", horarios: ["20:00", "22:00", "00:00"] },
  { nome: "Kelo-Cote UV Gel", freq: "2x ao dia", dias: 90, inicio: "2026-05-20", horarios: ["08:00", "20:00"] }
];

const sentNotifications = new Set<string>();

// Clean old entries every hour
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const key of sentNotifications) {
    const parts = key.split('_');
    const timestamp = parseInt(parts[parts.length - 1] || '0');
    if (timestamp < oneHourAgo) sentNotifications.delete(key);
  }
}, 60 * 60 * 1000);

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

async function getSubscriptions() {
  try {
    const response = await fetch(`${MAIN_APP_URL}/api/subscribe`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.subscriptions || [];
  } catch { return []; }
}

async function deleteSubscription(endpoint: string) {
  try {
    await fetch(`${MAIN_APP_URL}/api/subscribe`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint })
    });
  } catch { /* ignore */ }
}

async function sendPushNotification(subscription: { endpoint: string; p256dh: string; auth: string }, payload: object) {
  try {
    await webpush.sendNotification({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth }
    }, JSON.stringify(payload));
    console.log('[NotifService] Push sent to', subscription.endpoint.substring(0, 50) + '...');
  } catch (error: any) {
    console.error('[NotifService] Push failed:', error?.statusCode);
    if (error?.statusCode === 410) await deleteSubscription(subscription.endpoint);
  }
}

// Send WhatsApp message to all configured numbers
async function sendWhatsApp(message: string) {
  try {
    const response = await fetch(`${WHATSAPP_SERVICE_URL}/send-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phones: WHATSAPP_NUMBERS, message })
    });
    if (response.ok) {
      console.log('[NotifService] ✅ WhatsApp messages sent to all numbers');
    } else {
      const text = await response.text();
      console.log('[NotifService] ⚠️ WhatsApp service not available:', text.substring(0, 100));
    }
  } catch (error) {
    console.log('[NotifService] ⚠️ WhatsApp service not reachable - messages will be sent via push only');
  }
}

async function checkAndNotify() {
  const now = new Date();
  console.log(`[NotifService] Checking at ${now.toISOString()}`);

  const subscriptions = await getSubscriptions();

  for (const t of TRATAMENTOS) {
    for (let d = 0; d < t.dias; d++) {
      const baseDate = addDays(new Date(t.inicio + 'T00:00:00'), d);

      for (let h = 0; h < t.horarios.length; h++) {
        const horario = t.horarios[h];
        const [hours, minutes] = horario.split(':').map(Number);
        const scheduledTime = new Date(baseDate);
        scheduledTime.setHours(hours, minutes, 0, 0);

        const diff = scheduledTime.getTime() - now.getTime();

        // Exact time notification (±30 seconds)
        if (diff >= -30000 && diff <= 30000) {
          const notifKey = `${t.nome}_${d}_${h}_${Math.floor(now.getTime() / 60000)}`;
          if (sentNotifications.has(notifKey)) continue;
          sentNotifications.add(notifKey);

          const logKey = `${TRATAMENTOS.indexOf(t)}_${d}_${h}`;
          console.log(`[NotifService] 🔔 TIME FOR: ${t.nome} at ${horario}`);

          const payload = {
            title: `💊 Hora de ${t.nome}!`,
            body: `${t.nome} - ${t.freq}\nHorário: ${horario} (Dia ${d + 1})`,
            icon: '/icon-192.png', badge: '/icon-192.png',
            medicationKey: logKey, timeKey: horario,
            requireInteraction: true,
            vibrate: [500, 300, 500, 300, 500, 300, 500],
            renotify: true, url: '/'
          };

          // Send push to all subscriptions
          for (const sub of subscriptions) {
            await sendPushNotification(sub, payload);
          }

          // Send WhatsApp message
          const whatsappMsg = `💊 *PÓS-OPERATÓRIO - HORA DO MEDICAMENTO*\n\n` +
            `*${t.nome}*\n` +
            `Frequência: ${t.freq}\n` +
            `Horário: ${horario}\n` +
            `Dia: ${d + 1}\n\n` +
            `⚠️ Não esqueça de tomar!`;
          await sendWhatsApp(whatsappMsg);
        }

        // Early warning 5 minutes before
        const fiveMinBefore = scheduledTime.getTime() - 5 * 60 * 1000;
        const diffEarly = fiveMinBefore - now.getTime();
        if (diffEarly >= -30000 && diffEarly <= 30000) {
          const notifKey = `early_${t.nome}_${d}_${h}_${Math.floor(now.getTime() / 60000)}`;
          if (sentNotifications.has(notifKey)) continue;
          sentNotifications.add(notifKey);

          const logKey = `${TRATAMENTOS.indexOf(t)}_${d}_${h}`;
          const payload = {
            title: `⏰ Em 5 minutos: ${t.nome}`,
            body: `${t.nome} - ${t.freq}\nHorário: ${horario} (Dia ${d + 1})`,
            icon: '/icon-192.png', badge: '/icon-192.png',
            medicationKey: logKey, timeKey: horario,
            requireInteraction: false,
            vibrate: [200, 100, 200], renotify: true, url: '/'
          };

          for (const sub of subscriptions) {
            await sendPushNotification(sub, payload);
          }

          // WhatsApp early warning
          const whatsappMsg = `⏰ *AVISO - 5 MINUTOS*\n\n` +
            `Em 5 minutos é hora de tomar:\n` +
            `*${t.nome}*\n` +
            `Horário: ${horario}\n` +
            `Dia: ${d + 1}`;
          await sendWhatsApp(whatsappMsg);
        }
      }
    }
  }

  if (subscriptions.length === 0) {
    console.log('[NotifService] No push subscriptions - only WhatsApp will be used');
  }
}

// HTTP server
const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'notification-service', uptime: process.uptime() });
    }
    if (url.pathname === '/status') {
      return Response.json({
        status: 'running', sentCount: sentNotifications.size,
        treatments: TRATAMENTOS.length, whatsappNumbers: WHATSAPP_NUMBERS,
        timestamp: new Date().toISOString()
      });
    }
    // Manual trigger for testing
    if (url.pathname === '/trigger-test' && req.method === 'POST') {
      const msg = `🧪 *TESTE DE NOTIFICAÇÃO*\n\nSistema de notificações do Pós-Operatório está funcionando!\n\n${new Date().toLocaleString('pt-BR')}`;
      sendWhatsApp(msg);
      return Response.json({ ok: true, message: 'Test WhatsApp sent' });
    }
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[NotifService] 🚀 Health check on port ${PORT}`);
console.log('[NotifService] 🚀 Starting scheduler (checks every 30s)');
console.log(`[NotifService] 📱 WhatsApp numbers: ${WHATSAPP_NUMBERS.join(', ')}`);

checkAndNotify();
setInterval(checkAndNotify, 30000);

process.on('SIGINT', () => { server.stop(); process.exit(0); });
