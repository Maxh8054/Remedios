import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const response = await fetch('http://localhost:3040/status', {
      signal: AbortSignal.timeout(3000),
    });
    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    // When WhatsApp service is not available (e.g., on Vercel)
    return NextResponse.json({
      status: 'unavailable',
      message: 'WhatsApp service is not running. Push notifications will still work.',
    });
  }
}
