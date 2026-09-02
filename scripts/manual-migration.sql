-- ============================================================================
-- OmniRAG — MANUAL MIGRATION SCRIPT (single unified schema, v0.12.5)
-- ============================================================================
-- الغرض: إنشاء/تحديث كامل مخطط قاعدة البيانات يدوياً — لقاعدة جديدة تماماً
-- أو قاعدة موجودة من نسخة سابقة (كل العبارات idempotent).
--
-- Purpose: full database schema, applied by hand (psql / Neon console /
-- docker exec). Covers everything the app creates at runtime via
-- src/lib/db/migrateAndSeedDrizzle.ts and the squashed Drizzle baseline
-- (drizzle/0000_baseline_unified.sql). Safe to re-run: every statement is
-- idempotent (IF NOT EXISTS / IF EXISTS / DO blocks).
--
-- ما لا يشمله هذا السكريبت (عن قصد):
--   1. مخطط pgboss — ينشئه pg-boss تلقائياً عند أول تشغيل للتطبيق.
--   2. بيانات Seed الأولية — التطبيق يزرعها تلقائياً عند الإقلاع.
--   3. مجموعات Qdrant — ينشئها التطبيق عند أول رفع مستند.
--
-- Usage / الاستخدام:
--   psql "$DATABASE_URL" -f scripts/manual-migration.sql
--   # أو من داخل حاوية docker-compose:
--   docker compose exec postgres psql -U omnirag -d omnirag -f /dev/stdin \
--     < scripts/manual-migration.sql
--
-- ملاحظة مهمة حول الطوابع الزمنية: كل أعمدة created_at/expires_at/… هي
-- varchar(100) تحمل سلاسل ISO-8601 (اتفاقية موثقة في src/db/schema.ts) —
-- لا "تصلحها" إلى timestamptz جزئياً.
-- ============================================================================

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. CORE RAG TABLES — جداول النواة
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS documents (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_type VARCHAR(50) NOT NULL DEFAULT 'file',
  language VARCHAR(10) NOT NULL,
  status VARCHAR(50) NOT NULL,
  chunk_count INT DEFAULT 0,
  created_at VARCHAR(100) NOT NULL,
  metadata JSONB,
  collection_ids JSONB
);

CREATE TABLE IF NOT EXISTS chunks (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  document_id VARCHAR(100) NOT NULL,
  document_title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  chunk_index INT NOT NULL,
  page_number INT DEFAULT 1,
  language VARCHAR(10) NOT NULL,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS sources (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  name TEXT NOT NULL,
  type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  config JSONB DEFAULT '{}'::jsonb,
  sync_schedule VARCHAR(100),
  last_sync_at VARCHAR(100),
  document_count INT DEFAULT 0,
  last_error TEXT,
  created_at VARCHAR(100) NOT NULL,
  collection_ids JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  source_id VARCHAR(100) NOT NULL,
  source_name TEXT NOT NULL,
  status VARCHAR(50) NOT NULL,
  items_processed INT DEFAULT 0,
  duration_ms INT DEFAULT 0,
  message TEXT,
  timestamp VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  document_count INT DEFAULT 0,
  created_at VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  endpoint_url TEXT NOT NULL,
  protocol_version VARCHAR(50) NOT NULL,
  sandbox_tier VARCHAR(50) NOT NULL,
  enabled_tools JSONB DEFAULT '[]'::jsonb,
  require_confirmation_tools JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(50) NOT NULL,
  latency_ms INT DEFAULT 0,
  last_checked VARCHAR(100) NOT NULL,
  headers JSONB DEFAULT '{}'::jsonb,
  category VARCHAR(100),
  url TEXT,
  auth_type VARCHAR(50),
  transport_type VARCHAR(50),
  config JSONB DEFAULT '{}'::jsonb,
  custom_tool_schemas JSONB DEFAULT '{}'::jsonb,
  created_at VARCHAR(100) DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  actor_id VARCHAR(100) NOT NULL,
  action TEXT NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL,
  details TEXT,
  timestamp VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  conversation_id VARCHAR(100),
  scoped_tool_name TEXT NOT NULL,
  input_params JSONB DEFAULT '{}'::jsonb,
  output_result JSONB DEFAULT '{}'::jsonb,
  latency_ms INT DEFAULT 0,
  status VARCHAR(50) NOT NULL,
  has_side_effect BOOLEAN DEFAULT FALSE,
  user_confirmed BOOLEAN DEFAULT FALSE,
  timestamp VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  title TEXT NOT NULL,
  mode VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  collection_ids JSONB DEFAULT '[]'::jsonb,
  enabled_mcp_servers JSONB DEFAULT '[]'::jsonb,
  created_at VARCHAR(100) NOT NULL,
  updated_at VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  conversation_id VARCHAR(100) NOT NULL,
  role VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  citations JSONB DEFAULT '[]'::jsonb,
  model_used VARCHAR(100),
  tokens_used JSONB DEFAULT '{}'::jsonb,
  feedback VARCHAR(50),
  tool_calls JSONB DEFAULT '[]'::jsonb,
  has_pii_redacted BOOLEAN DEFAULT FALSE,
  created_at VARCHAR(100) NOT NULL
);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. AUTH & TENANCY — المصادقة والمستأجرون
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(100) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  tenant_id VARCHAR(100) NOT NULL,
  created_at VARCHAR(100) NOT NULL
);

-- إضافة tenant_id لجدول users من نشر قديم (CREATE TABLE IF NOT EXISTS لا
-- يضيف عموداً لجدول موجود). DEFAULT '' يرضي NOT NULL للصفوف القديمة.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  plan VARCHAR(50) NOT NULL DEFAULT 'starter',
  created_at VARCHAR(100) NOT NULL,
  settings JSONB
);

CREATE TABLE IF NOT EXISTS sessions (
  token VARCHAR(100) PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  tenant_id VARCHAR(100) NOT NULL,
  expires_at VARCHAR(100) NOT NULL,
  created_at VARCHAR(100) NOT NULL
);

-- ══════════════════════════════════════════════════════════════════════════
-- 3. PLATFORM TABLES (Phase 0/6) — مفاتيح API ومزودو AI وWebhooks
-- ══════════════════════════════════════════════════════════════════════════

-- key_hash هو SHA-256 للمفتاح الكامل — النص الصريح لا يُخزن أبداً.
-- rate_limit_per_minute: سقف الطلبات/دقيقة (NULL = الافتراضي).
-- mcp_tools: قائمة أدوات MCP المسموحة (NULL = كل أدوات المستأجر).
CREATE TABLE IF NOT EXISTS api_keys (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  user_id VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  prefix VARCHAR(30) NOT NULL,
  key_hash VARCHAR(100) NOT NULL,
  scopes JSONB DEFAULT '[]'::jsonb,
  rate_limit_per_minute INTEGER,
  mcp_tools JSONB,
  expires_at VARCHAR(100),
  last_used_at VARCHAR(100),
  revoked_at VARCHAR(100),
  created_at VARCHAR(100) NOT NULL
);

-- credentials: نص مشفّر AES-256-GCM (صيغة encryptToken) — لا يُسلسل خارجياً.
CREATE TABLE IF NOT EXISTS provider_credentials (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  provider_id VARCHAR(100) NOT NULL,
  credentials JSONB DEFAULT '{}'::jsonb,
  base_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at VARCHAR(100) NOT NULL,
  updated_at VARCHAR(100) NOT NULL
);

-- secret: نص مشفّر AES-256-GCM لمفتاح توقيع HMAC.
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events JSONB DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_delivery_at VARCHAR(100),
  last_delivery_status VARCHAR(20),
  created_at VARCHAR(100) NOT NULL,
  updated_at VARCHAR(100) NOT NULL
);

-- أعمدة Phase 6 على جدول موجود من نسخة سابقة.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS mcp_tools JSONB;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. TEAMS & SHARING (Phase 5) — الفرق والمشاركة وSSO
-- ══════════════════════════════════════════════════════════════════════════

-- role ∈ owner|admin|editor|viewer — حل الدور يعمل مع كل طلب مصادق.
CREATE TABLE IF NOT EXISTS memberships (
  id VARCHAR(100) PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  tenant_id VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'viewer',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  invited_by VARCHAR(100),
  created_at VARCHAR(100) NOT NULL
);

-- status ∈ pending|accepted|revoked|expired — token أحادي الاستخدام.
CREATE TABLE IF NOT EXISTS invitations (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'viewer',
  token VARCHAR(100) NOT NULL,
  invited_by VARCHAR(100) NOT NULL,
  expires_at VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  created_at VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  id VARCHAR(100) PRIMARY KEY,
  team_id VARCHAR(100) NOT NULL,
  user_id VARCHAR(100) NOT NULL,
  added_by VARCHAR(100),
  created_at VARCHAR(100) NOT NULL
);

-- منح مستخدم/فريق قراءة أو تعديلاً على مورد محدد بمعزل عن دور المستأجر.
-- link_token عند تعيينه يفعّل رابط مشاركة قراءة-only بدون مصادقة.
CREATE TABLE IF NOT EXISTS resource_shares (
  id VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id VARCHAR(100) NOT NULL,
  grantee_type VARCHAR(20) NOT NULL,
  grantee_id VARCHAR(100) NOT NULL,
  permission VARCHAR(20) NOT NULL DEFAULT 'read',
  link_token VARCHAR(100),
  shared_by VARCHAR(100) NOT NULL,
  expires_at VARCHAR(100),
  created_at VARCHAR(100) NOT NULL
);

-- صف واحد لكل تدفق OIDC قيد التنفيذ (PKCE) — يُستهلك في الـ callback.
CREATE TABLE IF NOT EXISTS sso_flows (
  state VARCHAR(100) PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  code_verifier VARCHAR(200) NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at VARCHAR(100) NOT NULL,
  created_at VARCHAR(100) NOT NULL
);

-- ══════════════════════════════════════════════════════════════════════════
-- 5. OPS TABLES — التشغيل (حدود المعدل، عدادات الاستخدام، علامة المخطط)
-- ══════════════════════════════════════════════════════════════════════════

-- تحديد معدل دائم: النافذة لكل عملية (upsert ذري واحد لكل طلب —
-- انظر lib/security/durableRateLimiter.ts).
CREATE TABLE IF NOT EXISTS rate_limit_windows (
  bucket_id VARCHAR(300) PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start VARCHAR(100) NOT NULL
);

-- عداد توكن شهري لكل مستأجر: period بصيغة 'YYYY-MM'، مفتاح مركب.
CREATE TABLE IF NOT EXISTS usage_counters (
  tenant_id VARCHAR(100) NOT NULL,
  period VARCHAR(7) NOT NULL,
  tokens_used BIGINT NOT NULL DEFAULT 0,
  updated_at VARCHAR(100) NOT NULL,
  PRIMARY KEY (tenant_id, period)
);

-- علامة مسار سريع للإقلاع البارد (schema_revision) — التطبيق يختمها
-- بعد أول تمريرة DDL ناجحة، ويفحصها قبل كل تمريرة لاحقة.
CREATE TABLE IF NOT EXISTS schema_meta (
  key VARCHAR(100) PRIMARY KEY,
  value VARCHAR(200) NOT NULL
);

-- ══════════════════════════════════════════════════════════════════════════
-- 6. LEGACY COLUMN BACKFILL — أعمدة مضافة لاحقاً على جداول قديمة
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) NOT NULL DEFAULT 'file';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_count INT DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS collection_ids JSONB;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS document_title TEXT NOT NULL DEFAULT '';
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS created_at VARCHAR(100) DEFAULT '';
ALTER TABLE sources ADD COLUMN IF NOT EXISTS collection_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS document_count INT DEFAULT 0;
ALTER TABLE collections ADD COLUMN IF NOT EXISTS document_count INT DEFAULT 0;

-- ══════════════════════════════════════════════════════════════════════════
-- 7. INDEXES — الفهارس
-- ══════════════════════════════════════════════════════════════════════════

-- Tenant scoping: كل استعلام يرشّح بـ tenant_id — بدون فهرس هذه استعلامات
-- مسح كامل للجدول.
CREATE INDEX IF NOT EXISTS documents_tenant_id_idx ON documents (tenant_id);
CREATE INDEX IF NOT EXISTS chunks_tenant_id_idx ON chunks (tenant_id);
-- مسارات الإصدار/إعادة الفهرسة تحذف chunks بـ document_id.
CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks (document_id);
-- المسار الساخن: معظم استعلامات chunks ترشّح البعدين معاً.
CREATE INDEX IF NOT EXISTS chunks_tenant_document_idx ON chunks (tenant_id, document_id);
-- ترتيب سجل المحادثات (قائمة المحادثات، آخر الرسائل).
CREATE INDEX IF NOT EXISTS messages_tenant_conversation_idx ON messages (tenant_id, conversation_id);

-- البحث المعجمي يمرر القاموس لكل استعلام: to_tsvector($1, content) @@
-- to_tsquery($1, $2) مع $1 ∈ {arabic, english}. فهرس GIN واحد لكل إعداد
-- قاموس يبقي التعبير متطابقاً بايت-ببايت حتى يستطيع المخطط استخدامه —
-- بدونها كل بحث عربي (اللغة الأساسية) مسح تسلسلي.
CREATE INDEX IF NOT EXISTS chunks_fts_english_gin
  ON chunks USING gin (to_tsvector('english'::regconfig, content));
CREATE INDEX IF NOT EXISTS chunks_fts_arabic_gin
  ON chunks USING gin (to_tsvector('arabic'::regconfig, content));

-- مفاتيح API: البحث بـ key_hash مع كل طلب Bearer + نطاق المستأجر.
CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS api_keys_tenant_id_idx ON api_keys (tenant_id);
-- مفتاح اعتماد واحد لكل مزود لكل مستأجر (دلالة upsert في خدمة الاعتمادات).
CREATE UNIQUE INDEX IF NOT EXISTS provider_credentials_tenant_provider_idx
  ON provider_credentials (tenant_id, provider_id);
CREATE INDEX IF NOT EXISTS webhook_endpoints_tenant_id_idx ON webhook_endpoints (tenant_id);

-- Phase 5: حل العضوية يعمل مع كل طلب مصادق (resolveRole) — كلا اتجاهي
-- البحث يجب أن يكونا مفهرسين.
CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_tenant_idx ON memberships (user_id, tenant_id);
CREATE INDEX IF NOT EXISTS memberships_tenant_id_idx ON memberships (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_idx ON invitations (token);
CREATE INDEX IF NOT EXISTS invitations_tenant_id_idx ON invitations (tenant_id);
CREATE INDEX IF NOT EXISTS teams_tenant_id_idx ON teams (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS team_members_team_user_idx ON team_members (team_id, user_id);
CREATE INDEX IF NOT EXISTS team_members_user_id_idx ON team_members (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS resource_shares_grant_idx
  ON resource_shares (resource_type, resource_id, grantee_type, grantee_id);
CREATE INDEX IF NOT EXISTS resource_shares_tenant_id_idx ON resource_shares (tenant_id);
-- فهرس جزئي: link_token اختياري والقيم NULL لا تشارك في التفرد.
CREATE UNIQUE INDEX IF NOT EXISTS resource_shares_link_token_idx
  ON resource_shares (link_token) WHERE link_token IS NOT NULL;

-- حدود المعدل: مسح النوافذ منتهية الصلاحية الدوري.
CREATE INDEX IF NOT EXISTS rate_limit_windows_window_start_idx ON rate_limit_windows (window_start);

-- ══════════════════════════════════════════════════════════════════════════
-- 8. LEGACY INDEX CLEANUP — إزالة فهارس مكررة من نشر أقدم
-- ══════════════════════════════════════════════════════════════════════════
-- المسار الاحتياطي القديم (lib/storage/postgres.ts) أنشأ فهارس FTS بأسماء
-- مختلفة عن مسار Drizzle — قاعدة بيانات عاشت كلا المسارين تحمل نسختين
-- من نفس الفهرس الوظيفي. نحذف الأسماء القديمة (وظيفياً مكررة).
DO $$
BEGIN
  DROP INDEX IF EXISTS chunks_content_fts_idx;       -- قديم: إنجليزي
  DROP INDEX IF EXISTS chunks_content_fts_arabic_idx; -- قديم: عربي
END $$;

COMMIT;

-- ============================================================================
-- التحقق / Verification (اختياري — شغّله بعد السكريبت):
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name IN (
--     'documents','chunks','sources','sync_logs','collections','mcp_servers',
--     'audit_logs','tool_calls','conversations','messages','users','tenants',
--     'sessions','api_keys','provider_credentials','webhook_endpoints',
--     'memberships','invitations','teams','team_members','resource_shares',
--     'sso_flows','rate_limit_windows','usage_counters','schema_meta');
--   → يجب أن يعيد 25.
-- ============================================================================
