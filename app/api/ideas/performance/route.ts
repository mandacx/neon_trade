import { NextRequest, NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse } from '@/lib/ideasApi';
import { desk } from '@/lib/ideas';
import { METRIC_DEFINITIONS } from '@/lib/ideaStats';
import { IDEA_DISCLAIMER } from '@/lib/ideaDisclaimer';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Desk performance over the terms the viewer's plan covers: hit rate, average R, expectancy, streaks, equity
 * curve in R, breakdowns and the closed-ideas table, all with `coverage` (counted vs excluded, and why).
 * `?horizon=&direction=&from=&to=` (published dates).
 */
export async function GET(request: NextRequest) {
  const { access, blocked } = await guardIdeas();
  if (blocked) return blocked;
  const sp = request.nextUrl.searchParams;
  const from = sp.get('from');
  const to = sp.get('to');
  if ((from && !YMD.test(from)) || (to && !YMD.test(to))) return NextResponse.json({ success: false, error: 'from/to must be YYYY-MM-DD' }, { status: 400 });
  try {
    const data = await desk(access, { horizon: sp.get('horizon'), direction: sp.get('direction'), from, to });
    return NextResponse.json({
      success: true,
      data: { ...data, terms: access.terms, meta: { definitions: METRIC_DEFINITIONS, basis: 'Daily bars. Stop first when one bar touches both stop and a target. R = profit / risk from the worst fill in the entry zone.' }, disclaimer: IDEA_DISCLAIMER },
    });
  } catch (error) {
    return ideaErrorResponse('performance', error);
  }
}
