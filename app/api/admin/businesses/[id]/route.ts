import { NextRequest, NextResponse } from 'next/server';
import { requireSystemAdmin } from '@/lib/auth-server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, db } = await requireSystemAdmin();
  if (error || !db) return error!;

  const { id } = await params;
  const [{ data: business }, { data: subscription }, { data: members }, { data: payments }, { data: auditLogs }] =
    await Promise.all([
      db.from('businesses').select('*').eq('id', id).maybeSingle(),
      db.from('subscriptions').select('*, plan:subscription_plans(*)').eq('business_id', id).maybeSingle(),
      db
        .from('business_members')
        .select('*, profile:profiles(id, first_name, last_name, email, phone)')
        .eq('business_id', id)
        .order('is_owner', { ascending: false }),
      db
        .from('payment_requests')
        .select('*')
        .eq('business_id', id)
        .order('created_at', { ascending: false }),
      db
        .from('audit_logs')
        .select('*')
        .eq('business_id', id)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

  if (!business) {
    return NextResponse.json({ error: 'İşletme bulunamadı.' }, { status: 404 });
  }

  return NextResponse.json({
    business,
    subscription,
    members: members ?? [],
    payments: payments ?? [],
    auditLogs: auditLogs ?? [],
  });
}
