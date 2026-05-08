import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET() {
  try {
    const qrDataPath = join(process.cwd(), 'public', 'whatsapp-qr-data.txt');
    const qrData = await readFile(qrDataPath, 'utf-8');

    if (!qrData || qrData.trim().length === 0) {
      return NextResponse.json({ error: 'QR code not available yet' }, { status: 404 });
    }

    // Return the raw QR data string so the frontend can render it
    return NextResponse.json({
      qr: qrData.trim(),
      timestamp: new Date().toISOString(),
    });
  } catch {
    // No QR data file yet
    return NextResponse.json({ error: 'QR code not available yet. Start the WhatsApp service first.' }, { status: 404 });
  }
}
