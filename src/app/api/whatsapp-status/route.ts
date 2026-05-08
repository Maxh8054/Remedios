import { NextResponse } from 'next/server';

const WHATSAPP_SERVICE_URL = process.env.WHATSAPP_SERVICE_URL || 'http://localhost:3040';

export async function GET() {
  try {
    const response = await fetch(`${WHATSAPP_SERVICE_URL}/status`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({
      status: 'unavailable',
      message: 'WhatsApp service is not running. Push notifications will still work.',
    });
  }
}
