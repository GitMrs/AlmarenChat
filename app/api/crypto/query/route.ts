import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { cryptoMarketTools, queryCryptoMarket } from '@/lib/crypto/market-tools';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    requireAuth(request);
    const body = await request.json();
    if (!cryptoMarketTools.includes(body.tool) || typeof body.symbol !== 'string' || !/^[a-z0-9]{2,12}(?:[-_/]?USDT)?(?:[-_/]?SWAP)?$/i.test(body.symbol)) {
      return NextResponse.json({ error: '请提供有效的行情工具名称和币种代码' }, { status: 400 });
    }
    const result = await queryCryptoMarket(body.tool, { symbol: body.symbol });
    if (!result) return NextResponse.json({ error: '行情暂不可用或交易对不存在' }, { status: 502 });
    return NextResponse.json({ success: true, tool: body.tool, data: result });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: '行情查询失败' }, { status: 502 });
  }
}
