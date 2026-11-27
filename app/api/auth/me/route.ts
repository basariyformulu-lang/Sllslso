import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-server';
import { isDatabaseConfigured, queryOne } from '@/lib/db';

export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ configured: false, user: null });
  }

  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ configured: true, user: null });
  }

  let unreadNotifications = 0;
  if (ctx.business) {
    const row = await queryOne<{ c: number }>(
      'SELECT COUNT(*) AS c FROM notifications WHERE business_id = ? AND is_read = 0',
      [ctx.business.id]
    );
    unreadNotifications = Number(row?.c ?? 0);
  }

  return NextResponse.json({
    configured: true,
    user: {
      id: ctx.userId,
      email: ctx.email,
      isSystemAdmin: ctx.isSystemAdmin,
      adminName: ctx.adminName,
      member: ctx.member,
      business: ctx.business,
      isSubscriptionActive: ctx.isSubscriptionActive,
      unreadNotifications,
    },
  });
}
