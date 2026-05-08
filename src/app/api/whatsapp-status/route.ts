import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const response = await fetch('http://localhost:3040/status', {
      signal: AbortSignal.timeout(3000),
    });
    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({
      status: 'offline',
      message: 'WhatsApp service is not running',
    }, { status: 503 });
  }
}
