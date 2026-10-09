import { NextResponse } from 'next/server';
import {
  getCryptoMarketData,
  analyzeCryptoTrap,
  formatCryptoContextForPrompt,
  extractCryptoSymbolFromText,
} from '@/lib/crypto/okx-service';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('symbol') || searchParams.get('q') || 'BTC';
    const symbol = extractCryptoSymbolFromText(query) || query.trim() || 'BTC';

    const snapshot = await getCryptoMarketData(symbol);
    if (!snapshot) {
      return NextResponse.json(
        {
          success: false,
          error: `无法获取 ${symbol} 的实盘行情或当前交易对不可用`,
        },
        { status: 404 }
      );
    }

    const analysis = analyzeCryptoTrap(snapshot);
    const promptContext = formatCryptoContextForPrompt(snapshot);

    return NextResponse.json({
      success: true,
      symbol: snapshot.symbol,
      instId: snapshot.instId,
      data: snapshot,
      analysis,
      promptContext,
    });
  } catch (error: any) {
    console.error('[api/crypto/market] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || '获取加密行情失败',
      },
      { status: 500 }
    );
  }
}
