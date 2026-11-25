import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSystemAdmin } from '@/lib/auth-server';

const reviewSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    requestId: z.string().uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    action: z.literal('reject'),
    requestId: z.string().uuid(),
    rejectedReason: z.string().trim().min(3, 'Reddetme sebebini yazınız.').max(300),
  }),
]);

export async function GET() {
  const { error, db } = await requireSystemAdmin();
  if (error || !db) return error!;

  const { data: requests, error: err } = await db
    .from('payment_requests')
    .select('*, businesses(name, business_code, email, phone), plan:subscription_plans(name, monthly_price)')
    .order('created_at', { ascending: false });

  if (err) return NextResponse.json({ error: err.message }, { status: 500 });
  return NextResponse.json({ requests: requests ?? [] });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx, db } = await requireSystemAdmin();
  if (error || !ctx || !db) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'İşlem bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const payload = parsed.data;

  if (payload.action === 'approve') {
    const startISO = `${payload.startDate}T00:00:00+03:00`;
    const endISO = `${payload.endDate}T23:59:59+03:00`;

    const { data: rpcRes, error: rpcErr } = await db.rpc('admin_approve_payment_request', {
      p_request_id: payload.requestId,
      p_admin_id: ctx.userId,
      p_start_at: startISO,
      p_end_at: endISO,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 409 });
    }

    return NextResponse.json({ success: true, result: rpcRes });
  }

  // Reddetme
  const { data: reqRow } = await db
    .from('payment_requests')
    .select('*')
    .eq('id', payload.requestId)
    .maybeSingle();

  if (!reqRow) {
    return NextResponse.json({ error: 'Ödeme talebi bulunamadı.' }, { status: 404 });
  }

  if (reqRow.status !== 'pending') {
    return NextResponse.json(
      { error: 'Bu ödeme talebi zaten sonuçlandırılmış.' },
      { status: 409 }
    );
  }

  await db
    .from('payment_requests')
    .update({
      status: 'rejected',
      rejected_reason: payload.rejectedReason,
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', reqRow.id);

  await db
    .from('businesses')
    .update({ subscription_status: 'payment_pending', updated_at: new Date().toISOString() })
    .eq('id', reqRow.business_id);

  await db
    .from('subscriptions')
    .update({ status: 'payment_pending', updated_at: new Date().toISOString() })
    .eq('business_id', reqRow.business_id);

  await db.from('notifications').insert({
    business_id: reqRow.business_id,
    type: 'payment_rejected',
    title: 'Ödeme Talebi Reddedildi',
    message: `Ödeme bildiriminiz reddedildi. Sebep: ${payload.rejectedReason}`,
    link: '/odeme',
  });

  await db.from('audit_logs').insert({
    scope: 'admin',
    business_id: reqRow.business_id,
    actor_user_id: ctx.userId,
    actor_name: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'payment_rejected',
    entity_type: 'payment_requests',
    entity_id: reqRow.id,
    old_values: { status: 'pending' },
    new_values: { status: 'rejected', rejected_reason: payload.rejectedReason },
    description: `Ödeme talebi reddedildi: ${payload.rejectedReason}`,
  });

  return NextResponse.json({ success: true });
}
