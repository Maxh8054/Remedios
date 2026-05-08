import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { medicationKey, timeKey, takenAt } = body;

    if (!medicationKey) {
      return NextResponse.json({ error: 'medicationKey required' }, { status: 400 });
    }

    const log = await db.medicationLog.create({
      data: {
        medicationKey,
        takenAt: takenAt ? new Date(takenAt) : new Date()
      }
    });

    return NextResponse.json({ success: true, log });
  } catch (error) {
    console.error('Error logging medication:', error);
    return NextResponse.json({ error: 'Failed to log medication' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const medicationKey = searchParams.get('medicationKey');

    const where = medicationKey ? { medicationKey } : {};
    const logs = await db.medicationLog.findMany({
      where,
      orderBy: { takenAt: 'desc' },
      take: 100
    });

    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Error fetching medication logs:', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}
