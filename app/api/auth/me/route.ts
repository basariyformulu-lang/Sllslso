import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-server';
import { createServiceRoleSupabase, isServiceRoleConfigured, isSupabaseConfigured } from '@/lib/supabase/server';

export async function GET() {
  if (!isSupabaseConfigured() || !isServiceRoleConfigured()) {
    return NextResponse.json({ configured: false, user: null });
  }

  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ configured: true, user: null });
  }

  const db = createServiceRoleSupabase()!;
  let unreadNotifications = 0;

  if (ctx.business) {
    const { count } = await db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', ctx.business.id)
      .eq('is_read', false);
    unreadNotifications = count ?? 0;
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
