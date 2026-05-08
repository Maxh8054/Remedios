import { NextResponse } from 'next/server';
import webpush from 'web-push';

// ---------------------------------------------------------------------------
// Lazy VAPID initialization
// ---------------------------------------------------------------------------
let vapidInitialized = false;

function ensureVapidInit() {
  if (vapidInitialized) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:pos-operatorio@app.com';
  if (publicKey && privateKey) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }
  vapidInitialized = true;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const WHATSAPP_SERVICE_URL = process.env.WHATSAPP_SERVICE_URL || 'http://localhost:3040';
const WHATSAPP_NUMBERS = ['5562981206800', '5562982093453', '5562983068941'];

// ---------------------------------------------------------------------------
// Treatment definitions (same as frontend)
// ---------------------------------------------------------------------------
const TRATAMENTOS = [
  { nome: "Sinot Clav", freq: "12 em 12 horas", dias: 14, inicio: "2026-05-07", horarios: ["08:39", "20:39"] },
  { nome: "Prednisolona", freq: "1x ao dia", dias: 5, inicio: "2026-05-07", horarios: ["08:39"] },
  { nome: "Traumeel", freq: "8 em 8 horas", dias: 7, inicio: "2026-05-08", horarios: ["08:00", "16:00", "00:00"] },
  { nome: "Dipirona", freq: "6 em 6 horas se dor", dias: 30, inicio: "2026-05-07", horarios: ["00:00", "06:00", "12:00", "18:00"] },
  { nome: "Bactroban", freq: "3x por dia", dias: 90, inicio: "2026-05-08", horarios: ["08:00", "14:00", "20:00"] },
  { nome: "Soro Fisiológico", freq: "5x por dia", dias: 30, inicio: "2026-05-08", horarios: ["08:00", "12:00", "16:00", "20:00", "00:00"] },
  { nome: "Nasoar", freq: "2x por dia", dias: 21, inicio: "2026-05-08", horarios: ["08:00", "20:00"] },
  { nome: "Cloridrato de Nafazolina", freq: "8 em 8 horas", dias: 7, inicio: "2026-05-08", horarios: ["08:00", "16:00", "00:00"] },
  { nome: "Hirudoid", freq: "4 em 4 horas", dias: 30, inicio: "2026-05-08", horarios: ["08:00", "12:00", "16:00", "20:00"] },
  { nome: "Gelo nos roxos", freq: "20 min de 2 em 2 horas", dias: 14, inicio: "2026-05-08", horarios: ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00", "00:00"] },
  { nome: "Kelo-Cote UV Gel", freq: "2x ao dia", dias: 90, inicio: "2026-05-20", horarios: ["08:00", "20:00"] }
];

// ---------------------------------------------------------------------------
// Notification schedule: at these times BEFORE the scheduled time
// ---------------------------------------------------------------------------
const ALERT_MINUTES_BEFORE = [60, 30, 15, 5]; // 1h, 30min, 15min, 5min before + exact time

// ---------------------------------------------------------------------------
// In-memory deduplication (resets on cold start — acceptable trade-off)
// ---------------------------------------------------------------------------
const sentNotifications = new Set<string>();

// Clean old entries every hour
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const key of sentNotifications) {
      const parts = key.split('_');
      const timestamp = parseInt(parts[parts.length - 1] || '0');
      if (timestamp < oneHourAgo) sentNotifications.delete(key);
    }
  }, 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

async function getPrisma() {
  try {
    const { db } = await import('@/lib/db');
    return db;
  } catch {
    return null;
  }
}

async function getSubscriptions() {
  try {
    const db = await getPrisma();
    if (db) {
      const subs = await db.pushSubscription.findMany();
      return subs;
    }
    return [];
  } catch {
    return [];
  }
}

async function deleteSubscription(endpoint: string) {
  try {
    const db = await getPrisma();
    if (db) {
      await db.pushSubscription.deleteMany({ where: { endpoint } });
    }
  } catch { /* ignore */ }
}

async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: object
) {
  try {
    ensureVapidInit();
    await webpush.sendNotification({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth }
    }, JSON.stringify(payload));
  } catch (error: any) {
    if (error?.statusCode === 410) {
      await deleteSubscription(subscription.endpoint);
    }
  }
}

async function sendWhatsApp(message: string) {
  try {
    const response = await fetch(`${WHATSAPP_SERVICE_URL}/send-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phones: WHATSAPP_NUMBERS, message }),
      signal: AbortSignal.timeout(15000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main notification check logic
// ---------------------------------------------------------------------------
async function checkAndNotify() {
  const now = new Date();
  let notificationsSent = 0;
  let whatsappSent = 0;

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

        // ---- EXACT TIME notification (±30 seconds) ----
        if (diff >= -30000 && diff <= 30000) {
          const notifKey = `exact_${t.nome}_${d}_${h}_${Math.floor(now.getTime() / 60000)}`;
          if (!sentNotifications.has(notifKey)) {
            sentNotifications.add(notifKey);

            const logKey = `${TRATAMENTOS.indexOf(t)}_${d}_${h}`;

            const payload = {
              title: `💊 Hora de ${t.nome}!`,
              body: `${t.nome} - ${t.freq}\nHorário: ${horario} (Dia ${d + 1})`,
              icon: '/icon-192.png', badge: '/icon-192.png',
              medicationKey: logKey, timeKey: horario,
              requireInteraction: true,
              vibrate: [500, 300, 500, 300, 500, 300, 500],
              renotify: true, url: '/'
            };

            for (const sub of subscriptions) {
              await sendPushNotification(sub, payload);
            }
            notificationsSent++;

            // WhatsApp message at exact time
            const whatsappMsg = `💊 *PÓS-OPERATÓRIO - HORA DO MEDICAMENTO*\n\n` +
              `*${t.nome}*\n` +
              `Frequência: ${t.freq}\n` +
              `Horário: ${horario}\n` +
              `Dia: ${d + 1}\n\n` +
              `⚠️ Não esqueça de tomar!`;
            const waOk = await sendWhatsApp(whatsappMsg);
            if (waOk) whatsappSent++;
          }
        }

        // ---- EARLY WARNING notifications (1h, 30min, 15min, 5min before) ----
        for (const minutesBefore of ALERT_MINUTES_BEFORE) {
          const alertTime = scheduledTime.getTime() - minutesBefore * 60 * 1000;
          const diffAlert = alertTime - now.getTime();

          if (diffAlert >= -30000 && diffAlert <= 30000) {
            const notifKey = `early${minutesBefore}_${t.nome}_${d}_${h}_${Math.floor(now.getTime() / 60000)}`;
            if (sentNotifications.has(notifKey)) continue;
            sentNotifications.add(notifKey);

            const logKey = `${TRATAMENTOS.indexOf(t)}_${d}_${h}`;

            let label = '';
            if (minutesBefore === 60) label = '1 hora';
            else if (minutesBefore === 30) label = '30 minutos';
            else if (minutesBefore === 15) label = '15 minutos';
            else if (minutesBefore === 5) label = '5 minutos';

            const payload = {
              title: `⏰ Em ${label}: ${t.nome}`,
              body: `${t.nome} - ${t.freq}\nHorário: ${horario} (Dia ${d + 1})`,
              icon: '/icon-192.png', badge: '/icon-192.png',
              medicationKey: logKey, timeKey: horario,
              requireInteraction: minutesBefore <= 15,
              vibrate: minutesBefore <= 5 ? [500, 300, 500, 300, 500] : [200, 100, 200],
              renotify: true, url: '/'
            };

            for (const sub of subscriptions) {
              await sendPushNotification(sub, payload);
            }
            notificationsSent++;

            // WhatsApp only at 5min and exact time (not at 1h, 30min, 15min)
            if (minutesBefore === 5) {
              const whatsappMsg = `⏰ *AVISO - 5 MINUTOS*\n\n` +
                `Em 5 minutos é hora de tomar:\n` +
                `*${t.nome}*\n` +
                `Horário: ${horario}\n` +
                `Dia: ${d + 1}`;
              const waOk = await sendWhatsApp(whatsappMsg);
              if (waOk) whatsappSent++;
            }
          }
        }
      }
    }
  }

  return { notificationsSent, whatsappSent, subscriptions: subscriptions.length };
}

// ---------------------------------------------------------------------------
// GET /api/check-notifications — Called by background scheduler every 30s
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const result = await checkAndNotify();
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error('[CheckNotifications] Error:', error);
    return NextResponse.json({ ok: false, error: 'Check failed' }, { status: 500 });
  }
}
