import { NextResponse } from 'next/server';
import { requireSystemAdmin } from '@/lib/auth-server';
import { parseJsonField, query, toIsoString } from '@/lib/db';

export async function GET() {
  const { error } = await requireSystemAdmin();
  if (error) return error;

  const rows = await query<Record<string, unknown>>(
    `SELECT a.*, b.name AS b_name, b.business_code AS b_code
     FROM audit_logs a
     LEFT JOIN businesses b ON b.id = a.business_id
     WHERE a.scope = 'admin'
     ORDER BY a.created_at DESC
     LIMIT 150`
  );

  const logs = rows.map((r) => ({
    ...r,
    old_values: parseJsonField(r.old_values, null),
    new_values: parseJsonField(r.new_values, null),
    created_at: toIsoString(r.created_at),
    businesses: r.b_name ? { name: r.b_name, business_code: r.b_code } : null,
  }));

  return NextResponse.json({ logs });
}
