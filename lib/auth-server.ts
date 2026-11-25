import { NextResponse } from 'next/server';
import {
  createServerSupabase,
  createServiceRoleSupabase,
  isServiceRoleConfigured,
  isSupabaseConfigured,
} from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions';
import type { Business, BusinessMember } from '@/lib/types';

export interface AuthContext {
  userId: string;
  email: string;
  isSystemAdmin: boolean;
  adminName: string | null;
  member: BusinessMember | null;
  business: Business | null;
  isSubscriptionActive: boolean;
}

export async function getAuthContext(): Promise<AuthContext | null> {
  if (!isSupabaseConfigured() || !isServiceRoleConfigured()) {
    return null;
  }

  const supabase = await createServerSupabase();
  const adminDb = createServiceRoleSupabase();
  if (!supabase || !adminDb) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: adminRow } = await adminDb
    .from('system_admins')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();

  const { data: memberRow } = await adminDb
    .from('business_members')
    .select('*, profile:profiles(id, first_name, last_name, phone, email)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();

  let business: Business | null = null;
  let isSubscriptionActive = false;

  if (memberRow) {
    const { data: bizRow } = await adminDb
      .from('businesses')
      .select('*')
      .eq('id', memberRow.business_id)
      .maybeSingle();

    if (bizRow) {
      business = bizRow as Business;

      // Süresi dolmuş aboneliği otomatik güncelle
      if (
        business.subscription_status === 'active' &&
        business.subscription_end_at &&
        new Date(business.subscription_end_at).getTime() <= Date.now()
      ) {
        await adminDb
          .from('businesses')
          .update({ subscription_status: 'expired', updated_at: new Date().toISOString() })
          .eq('id', business.id);
        await adminDb
          .from('subscriptions')
          .update({ status: 'expired', updated_at: new Date().toISOString() })
          .eq('business_id', business.id);
        business.subscription_status = 'expired';
      }

      isSubscriptionActive =
        business.is_active &&
        business.subscription_status === 'active' &&
        (!business.subscription_end_at ||
          new Date(business.subscription_end_at).getTime() > Date.now());
    }
  }

  return {
    userId: user.id,
    email: user.email ?? '',
    isSystemAdmin: Boolean(adminRow),
    adminName: adminRow?.full_name ?? null,
    member: memberRow
      ? ({
          ...memberRow,
          permissions: Array.isArray(memberRow.permissions) ? memberRow.permissions : [],
        } as BusinessMember)
      : null,
    business,
    isSubscriptionActive,
  };
}

export async function requireBusinessContext(permissionCode?: string) {
  if (!isSupabaseConfigured() || !isServiceRoleConfigured()) {
    return {
      error: NextResponse.json(
        { error: 'Supabase veritabanı yapılandırılmamış.' },
        { status: 503 }
      ),
      ctx: null,
      db: null,
    };
  }

  const ctx = await getAuthContext();
  if (!ctx) {
    return {
      error: NextResponse.json({ error: 'Oturum açmanız gerekiyor.' }, { status: 401 }),
      ctx: null,
      db: null,
    };
  }

  if (!ctx.member || !ctx.business) {
    return {
      error: NextResponse.json({ error: 'İşletme üyeliği bulunamadı.' }, { status: 403 }),
      ctx: null,
      db: null,
    };
  }

  if (!ctx.isSubscriptionActive) {
    return {
      error: NextResponse.json(
        { error: 'İşletme aboneliği aktif değil. Lütfen ödeme ekranını kontrol edin.' },
        { status: 402 }
      ),
      ctx: null,
      db: null,
    };
  }

  if (permissionCode && !hasPermission(ctx.member, permissionCode)) {
    return {
      error: NextResponse.json(
        { error: 'Bu işlem için yetkiniz bulunmuyor.' },
        { status: 403 }
      ),
      ctx: null,
      db: null,
    };
  }

  const db = createServiceRoleSupabase()!;
  return { error: null, ctx, db };
}

export async function requireSystemAdmin() {
  if (!isSupabaseConfigured() || !isServiceRoleConfigured()) {
    return {
      error: NextResponse.json(
        { error: 'Supabase veritabanı yapılandırılmamış.' },
        { status: 503 }
      ),
      ctx: null,
      db: null,
    };
  }

  const ctx = await getAuthContext();
  if (!ctx) {
    return {
      error: NextResponse.json({ error: 'Oturum açmanız gerekiyor.' }, { status: 401 }),
      ctx: null,
      db: null,
    };
  }

  if (!ctx.isSystemAdmin) {
    return {
      error: NextResponse.json(
        { error: 'Bu alana yalnızca sistem yöneticisi erişebilir.' },
        { status: 403 }
      ),
      ctx: null,
      db: null,
    };
  }

  const db = createServiceRoleSupabase()!;
  return { error: null, ctx, db };
}
