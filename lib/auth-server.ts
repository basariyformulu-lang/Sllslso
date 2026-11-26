import { NextResponse } from 'next/server';
import {
  createServerSupabase,
  createServiceRoleSupabase,
  isServiceRoleConfigured,
  isSupabaseConfigured,
} from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions';
import type { Business, BusinessMember, CustomerAccount } from '@/lib/types';

export interface AuthContext {
  userId: string;
  email: string;
  isSystemAdmin: boolean;
  adminName: string | null;
  member: BusinessMember | null;
  business: Business | null;
  isSubscriptionActive: boolean;
  customerAccount: CustomerAccount | null;
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

  const [{ data: adminRow }, { data: memberRow }, { data: custRow }] = await Promise.all([
    adminDb
      .from('system_admins')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle(),
    adminDb
      .from('business_members')
      .select('*, profile:profiles(id, first_name, last_name, phone, email)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle(),
    adminDb
      .from('customer_accounts')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);

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
    customerAccount: (custRow as CustomerAccount) ?? null,
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

export async function requireBusinessBookingContext(
  permissionCode?: string,
  allowReadOnly = false
) {
  if (!isSupabaseConfigured() || !isServiceRoleConfigured()) {
    return {
      error: NextResponse.json(
        { error: 'Supabase veritabanı yapılandırılmamış.' },
        { status: 503 }
      ),
      ctx: null,
      db: null,
      readOnly: false,
    };
  }

  const ctx = await getAuthContext();
  if (!ctx) {
    return {
      error: NextResponse.json({ error: 'Oturum açmanız gerekiyor.' }, { status: 401 }),
      ctx: null,
      db: null,
      readOnly: false,
    };
  }

  if (!ctx.member || !ctx.business) {
    return {
      error: NextResponse.json({ error: 'İşletme üyeliği bulunamadı.' }, { status: 403 }),
      ctx: null,
      db: null,
      readOnly: false,
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
      readOnly: false,
    };
  }

  const moduleEnabled =
    ctx.business.booking_module_enabled !== false &&
    ctx.business.booking_module_mode !== 'addon_locked';
  const readOnly = !ctx.isSubscriptionActive || !moduleEnabled;

  if (readOnly && !allowReadOnly) {
    return {
      error: NextResponse.json(
        {
          error: !ctx.isSubscriptionActive
            ? 'İşletme aboneliği aktif olmadığı için randevu modülü yalnızca görüntüleme modundadır.'
            : 'Online randevu modülü aboneliğinizde kilitli durumdadır.',
        },
        { status: !ctx.isSubscriptionActive ? 402 : 403 }
      ),
      ctx: null,
      db: null,
      readOnly: true,
    };
  }

  const db = createServiceRoleSupabase()!;
  return { error: null, ctx, db, readOnly };
}

export async function requireCustomerContext() {
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
      error: NextResponse.json({ error: 'Randevu işlemleri için giriş yapmalısınız.' }, { status: 401 }),
      ctx: null,
      db: null,
    };
  }

  const db = createServiceRoleSupabase()!;

  // Eğer kullanıcı Supabase Auth ile kayıtlı ama henüz customer_accounts kaydı yoksa profilden senkronize et
  if (!ctx.customerAccount) {
    const { data: profile } = await db
      .from('profiles')
      .select('*')
      .eq('id', ctx.userId)
      .maybeSingle();

    const { data: created } = await db
      .from('customer_accounts')
      .upsert({
        user_id: ctx.userId,
        first_name: profile?.first_name || 'Müşteri',
        last_name: profile?.last_name || '',
        phone: profile?.phone || '',
        email: profile?.email || ctx.email,
      })
      .select('*')
      .single();

    if (created) {
      ctx.customerAccount = created as CustomerAccount;
    }
  }

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
