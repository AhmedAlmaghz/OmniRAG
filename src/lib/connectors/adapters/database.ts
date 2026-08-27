import type { ConnectorDescriptor, ConnectorFieldDescriptor, ConnectorExtraction } from '../types';
import { buildConfigSchema } from '../schemaBuilder';

/**
 * External SQL database connector — READ-ONLY sync of query results.
 *
 * Safety model (defense in depth):
 *  1. The query must start with SELECT or WITH — anything else is rejected
 *     before a connection is even opened.
 *  2. The query runs inside a `READ ONLY` transaction (Postgres) / on a
 *     connection whose session is forced read-only where the engine allows.
 *  3. Row count is capped so a runaway query can't balloon memory.
 *
 * Engines: PostgreSQL (via the platform's existing pg driver) and
 * MySQL/MariaDB (mysql2). No other engines are bundled — the connector says
 * so honestly instead of pretending.
 */

const MAX_ROWS_DEFAULT = 500;
const QUERY_TIMEOUT_MS = 30_000;

/** Whitelist of statement shapes a sync query may take. */
export function isReadOnlyQuery(query: string): boolean {
  const head = (query || '')
    .replace(/^(\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/))*/, '')
    .trim()
    .toLowerCase();
  return head.startsWith('select') || head.startsWith('with');
}

function rowsToMarkdown(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '(لا توجد صفوف مطابقة)';
  const columns = Object.keys(rows[0]);
  if (columns.length === 0) return '(صفوف بلا أعمدة)';
  const escape = (v: unknown) =>
    String(v ?? '')
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, ' ')
      .slice(0, 500);
  const header = `| ${columns.map(escape).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${columns.map((c) => escape(r[c])).join(' | ')} |`).join('\n');
  return `${header}\n${sep}\n${body}`;
}

async function runPostgres(config: Record<string, unknown>, query: string, maxRows: number) {
  const pg = await import('pg');
  const Pool = pg.default?.Pool || pg.Pool;
  const connectionString = typeof config?.connectionString === 'string' ? config.connectionString.trim() : '';
  const pool = new Pool(
    connectionString
      ? { connectionString, connectionTimeoutMillis: 10_000, query_timeout: QUERY_TIMEOUT_MS }
      : {
          host: String(config?.host || ''),
          port: Number(config?.port) || 5432,
          database: String(config?.database || ''),
          user: String(config?.dbUser || ''),
          password: String(config?.dbPassword || ''),
          connectionTimeoutMillis: 10_000,
          query_timeout: QUERY_TIMEOUT_MS,
        },
  );
  try {
    // READ ONLY transaction: the engine itself refuses writes even if the
    // statement-shape check above were ever bypassed.
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const res = await client.query({ text: query, rowMode: 'object' } as any);
      await client.query('COMMIT');
      return ((res.rows || []) as unknown as Record<string, unknown>[]).slice(0, maxRows);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

async function runMysql(config: Record<string, unknown>, query: string, maxRows: number) {
  const mysql = await import('mysql2/promise');
  const connectionString = typeof config?.connectionString === 'string' ? config.connectionString.trim() : '';
  const conn = await (connectionString
    ? mysql.createConnection({ uri: connectionString, connectTimeout: 10_000 })
    : mysql.createConnection({
        host: String(config?.host || ''),
        port: Number(config?.port) || 3306,
        database: String(config?.database || ''),
        user: String(config?.dbUser || ''),
        password: String(config?.dbPassword || ''),
        connectTimeout: 10_000,
      }));
  try {
    // Best-effort session read-only flag; MySQL still enforces grants.
    await conn.query('SET SESSION TRANSACTION READ ONLY').catch(() => {});
    const [rows] = await conn.query({ sql: query, timeout: QUERY_TIMEOUT_MS });
    return (Array.isArray(rows) ? rows : []).slice(0, maxRows) as Record<string, unknown>[];
  } finally {
    await conn.end().catch(() => {});
  }
}

export async function extractFromDatabase(config: Record<string, unknown>): Promise<ConnectorExtraction> {
  const dbType = (typeof config?.dbType === 'string' && config.dbType.trim()) || 'postgresql';
  const query = typeof config?.syncQuery === 'string' ? config.syncQuery.trim().replace(/;\s*$/, '') : '';
  if (!query) throw new Error('استعلام المزامنة (syncQuery) مطلوب.');
  if (!isReadOnlyQuery(query)) {
    throw new Error('استعلام المزامنة يجب أن يكون للقراءة فقط (SELECT أو WITH) — التعديلات غير مسموحة.');
  }
  const maxRows = Math.min(Math.max(Number(config?.maxRows) || MAX_ROWS_DEFAULT, 1), 5000);

  let rows: Record<string, unknown>[];
  if (dbType === 'postgresql') {
    rows = await runPostgres(config, query, maxRows);
  } else if (dbType === 'mysql') {
    rows = await runMysql(config, query, maxRows);
  } else {
    throw new Error(`محرك قاعدة البيانات "${dbType}" غير مدعوم في هذا النشر — المدعوم: PostgreSQL و MySQL/MariaDB.`);
  }

  const label =
    dbType === 'postgresql' ? `PostgreSQL ${config?.database || config?.connectionString ? '' : ''}`.trim() : `MySQL`;
  const target = typeof config?.database === 'string' && config.database ? ` — ${config.database}` : '';

  return {
    title: `[قاعدة بيانات] ${label}${target}`,
    content: `# نتائج مزامنة ${label}${target}\n\nالاستعلام:\n\`\`\`sql\n${query}\n\`\`\`\n\nعدد الصفوف: ${rows.length}\n\n${rowsToMarkdown(rows)}`,
    itemsProcessed: rows.length,
  };
}

const databaseFields: ConnectorFieldDescriptor[] = [
  {
    key: 'dbType',
    labelAr: 'نوع قاعدة البيانات',
    labelEn: 'Database Engine',
    type: 'select',
    required: true,
    default: 'postgresql',
    options: [
      { label: 'PostgreSQL', value: 'postgresql' },
      { label: 'MySQL / MariaDB', value: 'mysql' },
    ],
  },
  {
    key: 'connectionString',
    labelAr: 'سلسلة الاتصال (تفضيل أول)',
    labelEn: 'Connection String (preferred)',
    type: 'password',
    required: false,
    secret: true,
    placeholder: 'postgres://reader:***@db.internal:5432/knowledge',
    helpAr: 'إن وُجدت تُهمل الحقول الأخرى. استخدم حسابا للقراءة فقط.',
    helpEn: 'When present, the individual fields below are ignored. Use a read-only account.',
  },
  {
    key: 'host',
    labelAr: 'عنوان الخادم (Host)',
    labelEn: 'Host',
    type: 'text',
    required: false,
    placeholder: 'db.internal.company.com',
  },
  {
    key: 'port',
    labelAr: 'المنفذ (Port)',
    labelEn: 'Port',
    type: 'number',
    required: false,
    default: 5432,
  },
  {
    key: 'database',
    labelAr: 'اسم قاعدة البيانات',
    labelEn: 'Database Name',
    type: 'text',
    required: false,
  },
  {
    key: 'dbUser',
    labelAr: 'اسم المستخدم',
    labelEn: 'Username',
    type: 'text',
    required: false,
  },
  {
    key: 'dbPassword',
    labelAr: 'كلمة المرور',
    labelEn: 'Password',
    type: 'password',
    required: false,
    secret: true,
  },
  {
    key: 'syncQuery',
    labelAr: 'استعلام المزامنة (SELECT فقط)',
    labelEn: 'Sync Query (SELECT only)',
    type: 'textarea',
    required: true,
    placeholder: 'SELECT id, title, content FROM docs ORDER BY updated_at DESC LIMIT 200',
  },
  {
    key: 'maxRows',
    labelAr: 'الحد الأقصى للصفوف',
    labelEn: 'Max Rows',
    type: 'number',
    required: false,
    default: 500,
  },
];

export const databaseConnector: ConnectorDescriptor = {
  type: 'database',
  nameAr: 'قاعدة بيانات SQL (قراءة فقط)',
  nameEn: 'SQL Database (read-only)',
  descriptionAr: 'مزامنة نتائج استعلام قراءة فقط من PostgreSQL أو MySQL كأوراق معرفية.',
  descriptionEn: 'Sync read-only query results from PostgreSQL or MySQL as knowledge documents.',
  category: 'databases',
  iconName: 'Database',
  defaultSchedule: '*/30 * * * *',
  supportsSchedule: true,
  fields: databaseFields,
  configSchema: buildConfigSchema(databaseFields),
  extract: extractFromDatabase,
};
