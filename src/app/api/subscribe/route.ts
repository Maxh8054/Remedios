import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';

// Lazy initialization of web-push VAPID details
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

// In-memory storage for push subscriptions
// This works for serverless (Vercel) - subscriptions are lost on cold start
// but re-register automatically when the user opens the app
const subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }> = [];

// Try to use Prisma if available (for local/VPS deployment)
async function getPrisma() {
  try {
    const { db } = await import('@/lib/db');
    return db;
  } catch {
    return null;
  }
}

// GET - List all subscriptions (used by notification service)
export async function GET() {
  try {
    const db = await getPrisma();
    if (db) {
      const subs = await db.pushSubscription.findMany();
      return NextResponse.json({ subscriptions: subs });
    }
    // Fallback to in-memory
    return NextResponse.json({ subscriptions });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    // Fallback to in-memory
    return NextResponse.json({ subscriptions });
  }
}

// POST - Save a new push subscription
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { subscription, oldEndpoint } = body;

    // Handle subscription update (old endpoint replaced)
    if (oldEndpoint) {
      const db = await getPrisma();
      if (db) {
        await db.pushSubscription.deleteMany({
          where: { endpoint: oldEndpoint }
        });
      }
      // Also remove from in-memory
      const idx = subscriptions.findIndex(s => s.endpoint === oldEndpoint);
      if (idx !== -1) subscriptions.splice(idx, 1);
    }

    if (!subscription || !subscription.endpoint) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }

    // Try Prisma first
    const db = await getPrisma();
    if (db) {
      const existing = await db.pushSubscription.findUnique({
        where: { endpoint: subscription.endpoint }
      });

      if (existing) {
        await db.pushSubscription.update({
          where: { endpoint: subscription.endpoint },
          data: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
            updatedAt: new Date()
          }
        });
      } else {
        await db.pushSubscription.create({
          data: {
            endpoint: subscription.endpoint,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth
          }
        });
      }
    }

    // Always also store in memory as backup
    const memIdx = subscriptions.findIndex(s => s.endpoint === subscription.endpoint);
    if (memIdx !== -1) {
      subscriptions[memIdx] = {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth
      };
    } else {
      subscriptions.push({
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving subscription:', error);
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
  }
}

// DELETE - Remove a push subscription
export async function DELETE(request: NextRequest) {
  try {
    ensureVapidInit();
    const body = await request.json();
    const { endpoint } = body;

    if (!endpoint) {
      return NextResponse.json({ error: 'Endpoint required' }, { status: 400 });
    }

    // Try Prisma first
    const db = await getPrisma();
    if (db) {
      await db.pushSubscription.deleteMany({
        where: { endpoint }
      });
    }

    // Also remove from in-memory
    const idx = subscriptions.findIndex(s => s.endpoint === endpoint);
    if (idx !== -1) subscriptions.splice(idx, 1);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting subscription:', error);
    return NextResponse.json({ error: 'Failed to delete subscription' }, { status: 500 });
  }
}
