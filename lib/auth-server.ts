import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth-mysql';
import { execute, isDatabaseConfigured, parseJsonField, queryOne, toBool, toIsoString, toMySqlDateTime } from '@/lib/db';
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
  if (!isDatabaseConfigured()) {
    return null;
  }

  const session = await getSessionFromCookies();
  if (!session) return null;

  const adminRow = await queryOne<{
    user_id: string;
    full_name: string;
    email: string;
  }>('SELECT user_id, full_name, email FROM system_admins WHERE user_id = ? LIMIT 1', [
    session.userId,
  ]);

  const memberRow = await queryOne<{
    id: string;
    business_id: string;
    user_id: string;
    role_name: string;
    is_owner: number;
    is_active: number;
    permissions: string;
    p_first_name: string | null;
    p_last_name: string | null;
    p_phone: string | null;
    p_email: string | null;
  }>(
    `SELECT bm.id, bm.business_id, bm.user_id, bm.role_name, bm.is_owner, bm.is_active, bm.permissions,
            p.first_name AS p_first_name, p.last_name AS p_last_name, p.phone AS p_phone, p.email AS p_email
     FROM business_members bm
     LEFT JOIN profiles p ON p.id = bm.user_id
     WHERE bm.user_id = ? AND bm.is_active = 1
     LIMIT 1`,
    [session.userId]
  );

  let business: Business | null = null;
  let isSubscriptionActive = false;

  if (memberRow) {
    const bizRow = await queryOne<Record<string, unknown>>(
      'SELECT * FROM businesses WHERE id = ? LIMIT 1',
      [memberRow.business_id]
    );

    if (bizRow) {
      business = {
        id: String(bizRow.id),
        name: String(bizRow.name),
        business_code: String(bizRow.business_code),
        owner_id: String(bizRow.owner_id),
        phone: String(bizRow.phone ?? ''),
        email: String(bizRow.email ?? ''),
        address: String(bizRow.address ?? ''),
        subscription_status: bizRow.subscription_status as Business['subscription_status'],
        subscription_start_at: toIsoString(bizRow.subscription_start_at),
        subscription_end_at: toIsoString(bizRow.subscription_end_at),
        is_active: toBool(bizRow.is_active),
        booking_module_enabled: toBool(bizRow.booking_module_enabled),
        booking_module_mode: (bizRow.booking_module_mode as Business['booking_module_mode']) ?? 'included',
        created_at: toIsoString(bizRow.created_at) ?? new Date().toISOString(),
      };

      if (
        business.subscription_status === 'active' &&
        business.subscription_end_at &&
        new Date(business.subscription_end_at).getTime() <= Date.now()
      ) {
        const nowStr = toMySqlDateTime();
        await execute(
          'UPDATE businesses SET subscription_status = ?, updated_at = ? WHERE id = ?',
          ['expired', nowStr, business.id]
        );
        await execute(
          'UPDATE subscriptions SET status = ? WHERE business_id = ?',
          ['expired', business.id]
        );
        business.subscription_status = 'expired';
      }

      isSubscriptionActive =
        business.is_active &&
        business.subscription_status === 'active' &&
        (!business.subscription_end_at ||
          new Date(business.subscription_end_at).getTime() > Date.now());
    }
  }

  if (!adminRow && !memberRow) {
    return null;
  }

  return {
    userId: session.userId,
    email: adminRow?.email ?? memberRow?.p_email ?? session.email ?? '',
    isSystemAdmin: Boolean(adminRow),
    adminName: adminRow?.full_name ?? null,
    member: memberRow
      ? {
          id: memberRow.id,
          business_id: memberRow.business_id,
          user_id: memberRow.user_id,
          role_name: memberRow.role_name,
          is_owner: toBool(memberRow.is_owner),
          is_active: toBool(memberRow.is_active),
          permissions: parseJsonField<string[]>(memberRow.permissions, []),
          profile: {
            id: memberRow.user_id,
            first_name: memberRow.p_first_name ?? '',
            last_name: memberRow.p_last_name ?? '',
            phone: memberRow.p_phone ?? '',
            email: memberRow.p_email ?? '',
          },
        }
      : null,
    business,
    isSubscriptionActive,
  };
}

export async function requireBusinessContext(permissionCode?: string) {
  if (!isDatabaseConfigured()) {
    return {
      error: NextResponse.json(
        { error: 'MySQL veritabanı yapılandırılmamış.' },
        { status: 503 }
      ),
      ctx: null,
    };
  }

  const ctx = await getAuthContext();
  if (!ctx) {
    return {
      error: NextResponse.json({ error: 'Oturum açmanız gerekiyor.' }, { status: 401 }),
      ctx: null,
    };
  }

  if (!ctx.member || !ctx.business) {
    return {
      error: NextResponse.json({ error: 'İşletme üyeliği bulunamadı.' }, { status: 403 }),
      ctx: null,
    };
  }

  if (!ctx.isSubscriptionActive) {
    return {
      error: NextResponse.json(
        { error: 'İşletme aboneliği aktif değil. Lütfen ödeme ekranını kontrol edin.' },
        { status: 402 }
      ),
      ctx: null,
    };
  }

  if (permissionCode && !hasPermission(ctx.member, permissionCode)) {
    return {
      error: NextResponse.json(
        { error: 'Bu işlem için yetkiniz bulunmuyor.' },
        { status: 403 }
      ),
      ctx: null,
    };
  }

  return { error: null, ctx };
}

export async function requireBusinessBookingContext(
  permissionCode?: string,
  allowReadOnly = false
) {
  if (!isDatabaseConfigured()) {
    return {
      error: NextResponse.json(
        { error: 'MySQL veritabanı yapılandırılmamış.' },
        { status: 503 }
      ),
      ctx: null,
      readOnly: false,
    };
  }

  const ctx = await getAuthContext();
  if (!ctx) {
    return {
      error: NextResponse.json({ error: 'Oturum açmanız gerekiyor.' }, { status: 401 }),
      ctx: null,
      readOnly: false,
    };
  }

  if (!ctx.member || !ctx.business) {
    return {
      error: NextResponse.json({ error: 'İşletme üyeliği bulunamadı.' }, { status: 403 }),
      ctx: null,
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
      readOnly: true,
    };
  }

  return { error: null, ctx, readOnly };
}

export async function requireSystemAdmin() {
  if (!isDatabaseConfigured()) {
    return {
      error: NextResponse.json(
        { error: 'MySQL veritabanı yapılandırılmamış.' },
        { status: 503 }
      ),
      ctx: null,
    };
  }

  const ctx = await getAuthContext();
  if (!ctx) {
    return {
      error: NextResponse.json({ error: 'Oturum açmanız gerekiyor.' }, { status: 401 }),
      ctx: null,
    };
  }

  if (!ctx.isSystemAdmin) {
    return {
      error: NextResponse.json(
        { error: 'Bu alana yalnızca sistem yöneticisi erişebilir.' },
        { status: 403 }
      ),
      ctx: null,
    };
  }

  return { error: null, ctx };
}
