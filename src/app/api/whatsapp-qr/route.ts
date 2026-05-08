import { NextResponse } from 'next/server';

const WHATSAPP_SERVICE_URL = process.env.WHATSAPP_SERVICE_URL || 'http://localhost:3040';

export async function GET() {
  try {
    const response = await fetch(`${WHATSAPP_SERVICE_URL}/qr`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();

    if (data.connected) {
      return NextResponse.json({ connected: true });
    }

    if (data.qr) {
      return NextResponse.json({
        qr: data.qr,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({ error: 'QR code not available yet' }, { status: 404 });
  } catch {
    return NextResponse.json({ error: 'WhatsApp service not available' }, { status: 503 });
  }
}
