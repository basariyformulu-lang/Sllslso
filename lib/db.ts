import crypto from 'node:crypto';
import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';

declare global {
  var __esnafMysqlPool: Pool | undefined;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(
    process.env.MYSQL_HOST?.trim() &&
      process.env.MYSQL_DATABASE?.trim() &&
      process.env.MYSQL_USER?.trim() &&
      process.env.MYSQL_PASSWORD !== undefined
  );
}

export function getPool(): Pool {
  if (!isDatabaseConfigured()) {
    throw new Error('MySQL veritabanı bağlantı bilgileri tanımlanmamış.');
  }
  if (!globalThis.__esnafMysqlPool) {
    globalThis.__esnafMysqlPool = mysql.createPool({
      host: process.env.MYSQL_HOST!.trim(),
      port: Number(process.env.MYSQL_PORT || 3306),
      database: process.env.MYSQL_DATABASE!.trim(),
      user: process.env.MYSQL_USER!.trim(),
      password: process.env.MYSQL_PASSWORD,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4',
      dateStrings: true,
      decimalNumbers: true,
      multipleStatements: false,
    });
  }
  return globalThis.__esnafMysqlPool;
}

type SqlExecuteParams = Parameters<Pool['execute']>[1];

export async function query<T = RowDataPacket>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const safeParams = params.map((v) => (v === undefined ? null : v)) as SqlExecuteParams;
  const [rows] = await getPool().execute<RowDataPacket[]>(sql, safeParams);
  return rows as T[];
}

export async function queryOne<T = RowDataPacket>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(
  sql: string,
  params: unknown[] = []
): Promise<ResultSetHeader> {
  const safeParams = params.map((v) => (v === undefined ? null : v)) as SqlExecuteParams;
  const [result] = await getPool().execute<ResultSetHeader>(sql, safeParams);
  return result;
}

export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const res = await fn(conn);
    await conn.commit();
    return res;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

export async function withNamedLock<T>(
  lockName: string,
  fn: (conn: PoolConnection) => Promise<T>,
  timeoutSec = 8
): Promise<T> {
  const conn = await getPool().getConnection();
  const safeKey = `esnaf_${lockName}`.slice(0, 64);
  try {
    const [lockRows] = await conn.execute<RowDataPacket[]>(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [safeKey, timeoutSec]
    );
    const acquired = Number((lockRows[0] as { acquired?: number } | undefined)?.acquired ?? 0);
    if (acquired !== 1) {
      throw new Error('Eşzamanlı işlem kilidi alınamadı, lütfen tekrar deneyiniz.');
    }
    try {
      await conn.beginTransaction();
      const res = await fn(conn);
      await conn.commit();
      return res;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      await conn.execute('SELECT RELEASE_LOCK(?)', [safeKey]).catch(() => {});
    }
  } finally {
    conn.release();
  }
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function parseJsonField<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return val as T;
}

export function toBool(val: unknown): boolean {
  return val === true || val === 1 || val === '1';
}

export function toMySqlDateTime(date: Date = new Date()): string {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

export function toIsoString(val: unknown): string | null {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  if (s.includes('T')) return s;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    return s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z');
  }
  return s;
}

export async function writeAuditLog(params: {
  scope?: 'admin' | 'business';
  businessId?: string | null;
  actorUserId?: string | null;
  actorName?: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  description: string;
}) {
  try {
    await execute(
      `INSERT INTO audit_logs
       (id, scope, business_id, actor_user_id, actor_name, action, entity_type, entity_id, old_values, new_values, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        params.scope ?? 'business',
        params.businessId ?? null,
        params.actorUserId ?? null,
        params.actorName ?? '',
        params.action,
        params.entityType,
        params.entityId ?? null,
        params.oldValues !== undefined ? JSON.stringify(params.oldValues) : null,
        params.newValues !== undefined ? JSON.stringify(params.newValues) : null,
        params.description,
        toMySqlDateTime(),
      ]
    );
  } catch {
    // Audit hatasi ana islemi durdurmasin
  }
}
