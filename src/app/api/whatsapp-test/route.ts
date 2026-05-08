import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const response = await fetch('http://localhost:3040/send-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phones: ['5562981206800', '5562982093453', '5562983068941'],
        message: `🧪 *TESTE - PÓS OPERATÓRIO*\n\nSistema de notificações WhatsApp está funcionando!\n\n📅 ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({ success: true, data });
    } else {
      const text = await response.text();
      return NextResponse.json({ success: false, error: text.substring(0, 200) }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'WhatsApp service não está disponível'
    }, { status: 503 });
  }
}
