import { NextRequest, NextResponse } from 'next/server';
import { getExpiryDates } from '@/lib/db';
import { getCurrentUserContext } from '@/lib/appUsers';
import { filterExpiries, standardExpiryOnly } from '@/lib/expiryAccess';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'Symbol parameter is required' },
        { status: 400 }
      );
    }

    // `all=true` returns the unexpired list plus the expired one
    // (`historicalExpiryDates`) in one response — the stock page needs both
    // on first load and would otherwise pay for two function invocations.
    const searchParams = request.nextUrl.searchParams;
    const all = searchParams.get('all') === 'true';
    const historical = searchParams.get('historical') === 'true';

    const [ctx, expiryDates, historicalExpiryDates] = await Promise.all([
      getCurrentUserContext(),
      getExpiryDates(symbol, { historical: historical && !all }),
      all ? getExpiryDates(symbol, { historical: true }) : Promise.resolve(undefined),
    ]);

    // Plans limited to monthly/quarterly expiries never see the weeklies (lib/expiryAccess.ts).
    return NextResponse.json({
      success: true,
      data: {
        symbol: symbol.toUpperCase(),
        expiryDates: filterExpiries(ctx.features, expiryDates),
        ...(historicalExpiryDates ? { historicalExpiryDates: filterExpiries(ctx.features, historicalExpiryDates) } : {}),
        standardExpiryOnly: standardExpiryOnly(ctx.features),
      },
    });
  } catch (error) {
    console.error('Error fetching expiry dates:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch expiry dates',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
