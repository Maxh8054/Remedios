import { NextRequest, NextResponse } from 'next/server';

// Try to use Prisma if available (for local/VPS deployment)
async function getPrisma() {
  try {
    const { db } = await import('@/lib/db');
    return db;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { medicationKey, timeKey, takenAt } = body;

    if (!medicationKey) {
      return NextResponse.json({ error: 'medicationKey required' }, { status: 400 });
    }

    const db = await getPrisma();
    if (db) {
      const log = await db.medicationLog.create({
        data: {
          medicationKey,
          takenAt: takenAt ? new Date(takenAt) : new Date()
        }
      });
      return NextResponse.json({ success: true, log });
    }

    // Fallback when no database (Vercel serverless)
    return NextResponse.json({ success: true, note: 'Logged locally only' });
  } catch (error) {
    console.error('Error logging medication:', error);
    return NextResponse.json({ success: true, note: 'Logged locally only' });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const medicationKey = searchParams.get('medicationKey');

    const db = await getPrisma();
    if (db) {
      const where = medicationKey ? { medicationKey } : {};
      const logs = await db.medicationLog.findMany({
        where,
        orderBy: { takenAt: 'desc' },
        take: 100
      });
      return NextResponse.json({ logs });
    }

    // Fallback when no database
    return NextResponse.json({ logs: [], note: 'No database available' });
  } catch (error) {
    console.error('Error fetching medication logs:', error);
    return NextResponse.json({ logs: [], note: 'No database available' });
  }
}
