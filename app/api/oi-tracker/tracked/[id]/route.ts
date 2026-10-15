import { NextRequest, NextResponse } from 'next/server';
import { guardOi, serverError } from '@/lib/oiTrackerApi';
import { deleteTracked, updateTracked, TrackError, type TrackedPatch } from '@/lib/oiTracked';

export const dynamic = 'force-dynamic';

/**
 * Edit one of the user's positions: { qty?, entryPrice?, note?, close?: { date?, price? }, reopen? }.
 * 404 when the id doesn't exist *for this user* (other users' ids look missing).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, blocked } = await guardOi(true);
  if (blocked) return blocked;
  const { id } = await params;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }
  const patch: TrackedPatch = {};
  if (body?.qty !== undefined) patch.qty = body.qty;
  if (body?.entryPrice !== undefined) patch.entryPrice = body.entryPrice;
  if (body?.note !== undefined) patch.note = body.note;
  if (body?.close) patch.close = { date: body.close.date ?? null, price: body.close.price ?? null };
  if (body?.reopen === true) patch.reopen = true;
  try {
    const position = await updateTracked(ctx.userId!, id, patch);
    if (!position) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: { position } });
  } catch (error) {
    if (error instanceof TrackError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    return serverError('update position', error);
  }
}

/** Delete one position (?group=1: its whole strategy group). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, blocked } = await guardOi();
  if (blocked) return blocked;
  const { id } = await params;
  try {
    const n = await deleteTracked(ctx.userId!, id, request.nextUrl.searchParams.get('group') === '1');
    if (n === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: { deleted: n } });
  } catch (error) {
    return serverError('delete position', error);
  }
}
