import { NextResponse } from 'next/server';
import { runNetworkDiagnostics } from '@/lib/network/proxy';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const result = await runNetworkDiagnostics();
    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error: any) {
    console.error('[network-check] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || 'Failed to run network diagnostics',
      },
      { status: 500 }
    );
  }
}
