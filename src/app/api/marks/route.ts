import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// /api/marks — Synchronized medication marks (replaces localStorage)
// ---------------------------------------------------------------------------

async function getPrisma() {
  try {
    const { db } = await import('@/lib/db');
    return db;
  } catch {
    return null;
  }
}

// GET — Fetch all marks
export async function GET() {
  try {
    const db = await getPrisma();
    if (!db) {
      return NextResponse.json({ marks: {} });
    }

    const marks = await db.medicationMark.findMany();
    const marksMap: Record<string, boolean> = {};
    for (const m of marks) {
      marksMap[m.markKey] = m.taken;
    }

    return NextResponse.json({ marks: marksMap });
  } catch (error) {
    console.error('Error fetching marks:', error);
    return NextResponse.json({ marks: {} });
  }
}

// POST — Toggle or set a mark
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { markKey, taken } = body;

    if (!markKey) {
      return NextResponse.json({ error: 'markKey required' }, { status: 400 });
    }

    const db = await getPrisma();
    if (!db) {
      return NextResponse.json({ error: 'Database not available' }, { status: 503 });
    }

    const isTaken = taken !== undefined ? taken : true;

    const existing = await db.medicationMark.findUnique({
      where: { markKey }
    });

    if (existing) {
      // Toggle: if already taken, untake it; otherwise update
      await db.medicationMark.update({
        where: { markKey },
        data: {
          taken: isTaken,
          takenAt: isTaken ? new Date() : existing.takenAt,
          updatedAt: new Date()
        }
      });
    } else {
      await db.medicationMark.create({
        data: {
          markKey,
          taken: isTaken,
          takenAt: new Date()
        }
      });
    }

    return NextResponse.json({ success: true, markKey, taken: isTaken });
  } catch (error) {
    console.error('Error saving mark:', error);
    return NextResponse.json({ error: 'Failed to save mark' }, { status: 500 });
  }
}

// DELETE — Remove a mark (untake)
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { markKey } = body;

    if (!markKey) {
      return NextResponse.json({ error: 'markKey required' }, { status: 400 });
    }

    const db = await getPrisma();
    if (!db) {
      return NextResponse.json({ error: 'Database not available' }, { status: 503 });
    }

    await db.medicationMark.deleteMany({
      where: { markKey }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting mark:', error);
    return NextResponse.json({ error: 'Failed to delete mark' }, { status: 500 });
  }
}

// PUT — Bulk sync: receive all local marks and return server state
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { marks }: { marks: Record<string, boolean> } = body;

    if (!marks || typeof marks !== 'object') {
      return NextResponse.json({ error: 'marks object required' }, { status: 400 });
    }

    const db = await getPrisma();
    if (!db) {
      return NextResponse.json({ error: 'Database not available' }, { status: 503 });
    }

    // Sync local marks to server (only add new ones, don't remove server ones)
    for (const [key, value] of Object.entries(marks)) {
      if (!value) continue; // Skip untaken marks

      const existing = await db.medicationMark.findUnique({
        where: { markKey: key }
      });

      if (!existing) {
        await db.medicationMark.create({
          data: {
            markKey: key,
            taken: true,
            takenAt: new Date()
          }
        });
      }
    }

    // Return full server state
    const allMarks = await db.medicationMark.findMany();
    const marksMap: Record<string, boolean> = {};
    for (const m of allMarks) {
      marksMap[m.markKey] = m.taken;
    }

    return NextResponse.json({ marks: marksMap });
  } catch (error) {
    console.error('Error syncing marks:', error);
    return NextResponse.json({ error: 'Failed to sync marks' }, { status: 500 });
  }
}
