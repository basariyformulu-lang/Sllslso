import { NextResponse } from 'next/server';
import { requireSystemAdmin } from '@/lib/auth-server';

export async function GET() {
  const { error, db } = await requireSystemAdmin();
  if (error || !db) return error!;

  const { data: logs, error: err } = await db
    .from('audit_logs')
    .select('*, businesses(name, business_code)')
    .eq('scope', 'admin')
    .order('created_at', { ascending: false })
    .limit(150);

  if (err) return NextResponse.json({ error: err.message }, { status: 500 });
  return NextResponse.json({ logs: logs ?? [] });
}
