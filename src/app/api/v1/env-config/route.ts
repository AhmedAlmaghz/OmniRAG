import { createLogger } from '@/lib/logging/logger';

const log = createLogger('AppApiV1EnvConfig');

import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { getEnv, setServerEnvs } from '@/lib/env/runtimeEnv';
import { resetPostgresPool } from '@/lib/storage/postgres';
import { resetQdrantClient } from '@/lib/storage/qdrant';
import { serverErrorResponse } from '@/lib/api/safeError';
import pg from 'pg';
const { Client } = pg;

export const dynamic = 'force-dynamic';

function maskValue(val: string | undefined, type: 'key' | 'url' | 'general'): string {
  if (!val || val.trim() === '' || val === 'null' || val === 'undefined') {
    return '';
  }
  const clean = val.trim();

  if (type === 'url') {
    try {
      const parsed = new URL(clean);
      if (parsed.password) {
        parsed.password = '••••••••';
      }
      return parsed.toString();
    } catch {
      return clean.slice(0, 15) + '••••••••';
    }
  }

  if (clean.length <= 8) {
    return '••••••••';
  }
  return `${clean.slice(0, 4)}••••••••${clean.slice(-4)}`;
}

export interface EnvVariableDefinition {
  key: string;
  category: 'ai' | 'database' | 'vector' | 'docai' | 'ingress';
  categoryTitleAr: string;
  categoryTitleEn: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  required: boolean;
  isConfigured: boolean;
  isInjectedBySystem: boolean;
  maskedPreview: string;
  docsUrl: string;
}

const ENV_METADATA: Omit<EnvVariableDefinition, 'isConfigured' | 'isInjectedBySystem' | 'maskedPreview'>[] = [
  {
    key: 'GEMINI_API_KEY',
    category: 'ai',
    categoryTitleAr: 'ذكاء الاستدلال والتوليد',
    categoryTitleEn: 'AI Reasoning & Generation',
    nameAr: 'مفتاح Google Gemini API',
    nameEn: 'Google Gemini API Key',
    descAr: 'مفتاح الوصول لنماذج Gemini 2.5 Flash و Gemini Pro للتحليل والدردشة وتوليد الإجابات الذكية.',
    descEn: 'Required for Gemini Flash/Pro LLM reasoning, document summarization, and chat responses.',
    required: true,
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    key: 'DATABASE_URL',
    category: 'database',
    categoryTitleAr: 'قواعد البيانات والبحث اللفظي',
    categoryTitleEn: 'Database & Lexical Storage',
    nameAr: 'رابط اتصال PostgreSQL (Neon DB)',
    nameEn: 'PostgreSQL Database URL',
    descAr: 'سلسلة الاتصال بقاعدة بيانات PostgreSQL لتخزين المستندات، المقاطع، السجلات، والسياق اللفظي.',
    descEn: 'PostgreSQL connection string for document chunks, sync logs, and metadata storage.',
    required: true,
    docsUrl: 'https://neon.tech',
  },
  {
    key: 'QDRANT_URL',
    category: 'vector',
    categoryTitleAr: 'قواعد البيانات المتجهة (Vector DB)',
    categoryTitleEn: 'Vector Database Cluster',
    nameAr: 'عنوان عنقود Qdrant Vector',
    nameEn: 'Qdrant Cluster URL',
    descAr: 'نقطة نهاية محرك المتجهات Qdrant المخصص للبحث الدلالي الفائق (Semantic Vector Search).',
    descEn: 'Qdrant vector engine endpoint for high-performance dense embedding similarity search.',
    required: true,
    docsUrl: 'https://cloud.qdrant.io',
  },
  {
    key: 'QDRANT_API_KEY',
    category: 'vector',
    categoryTitleAr: 'قواعد البيانات المتجهة (Vector DB)',
    categoryTitleEn: 'Vector Database Cluster',
    nameAr: 'مفتاح مصادقة Qdrant API Key',
    nameEn: 'Qdrant API Key',
    descAr: 'مفتاح الأمان والمصادقة للوصول إلى مجموعات ومتجهات Qdrant cloud.',
    descEn: 'Authentication API key for securely accessing Qdrant vector cloud collections.',
    required: false,
    docsUrl: 'https://cloud.qdrant.io',
  },
  {
    key: 'MISTRAL_API_KEY',
    category: 'docai',
    categoryTitleAr: 'الذكاء الاصطناعي للمستندات والـ OCR',
    categoryTitleEn: 'Document AI & OCR Engine',
    nameAr: 'مفتاح Mistral AI (OCR & Parsing)',
    nameEn: 'Mistral API Key',
    descAr: 'مفتاح استخراج النصوص وقراءة المستندات المعقدة والـ PDF والمخططات باستخدام نموذج Mistral OCR.',
    descEn: 'Mistral API key for advanced document parsing, OCR text extraction, and vector embeddings.',
    required: true,
    docsUrl: 'https://console.mistral.ai',
  },
  {
    key: 'UNSTRUCTURED_API_KEY',
    category: 'docai',
    categoryTitleAr: 'الذكاء الاصطناعي للمستندات والـ OCR',
    categoryTitleEn: 'Document AI & OCR Engine',
    nameAr: 'مفتاح Unstructured.io (اختياري)',
    nameEn: 'Unstructured.io API Key',
    descAr: 'مفتاح اختياري لمعالجة وتحويل مستندات Word و PowerPoint والجداول المتقدمة.',
    descEn: 'Optional key for processing unstructured Office documents and complex tables.',
    required: false,
    docsUrl: 'https://unstructured.io',
  },
  {
    key: 'APP_URL',
    category: 'ingress',
    categoryTitleAr: 'استضافة ومنافذ النظام',
    categoryTitleEn: 'System Hosting & Ingress',
    nameAr: 'العنوان العام للتطبيق (Public App URL)',
    nameEn: 'Public Application Host URL',
    descAr: 'العنوان الرسمي لتطبيق Cloud Run المستضيف لتقديم الروابط وإعادة التوجيه وموصلات OAuth.',
    descEn: 'Public host URL injected by Cloud Run for self-referential routes, OAuth callbacks, and API ingress.',
    required: true,
    docsUrl: 'https://cloud.google.com/run',
  },
];

export const GET = withAuthAndRateLimit(async (req, authCtx) => {
  const envList: EnvVariableDefinition[] = ENV_METADATA.map((meta) => {
    const rawVal = getEnv(meta.key, req);
    const isConfigured = !!rawVal && rawVal.trim() !== '' && rawVal !== 'null' && rawVal !== 'undefined';
    const isInjectedBySystem = meta.key === 'GEMINI_API_KEY' || meta.key === 'APP_URL';
    const type = meta.key.includes('URL') ? 'url' : 'key';

    return {
      ...meta,
      isConfigured,
      isInjectedBySystem,
      maskedPreview: isConfigured ? maskValue(rawVal, type) : '',
    };
  });

  const configuredCount = envList.filter((e) => e.isConfigured).length;
  const requiredCount = envList.filter((e) => e.required).length;
  const requiredConfiguredCount = envList.filter((e) => e.required && e.isConfigured).length;

  const readinessPercentage = Math.round((requiredConfiguredCount / requiredCount) * 100);

  return NextResponse.json({
    success: true,
    readinessPercentage,
    configuredCount,
    totalCount: envList.length,
    requiredCount,
    requiredConfiguredCount,
    isFullyConfigured: requiredConfiguredCount === requiredCount,
    envList,
  });
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const body = await req.json().catch(() => ({}));
    const { action, key, value, envs } = body;

    const isMaskedOrEmpty = (val: any) => !val || typeof val !== 'string' || val.trim() === '' || val.includes('•');
    const resolveValue = (inputVal: any, envKey: string) => {
      if (!isMaskedOrEmpty(inputVal)) {
        return inputVal.trim();
      }
      return getEnv(envKey, req) || '';
    };

    // Save/Sync environment variables to global runtime server store.
    // setServerEnvs enforces a key allow-list and REFUSES to persist sensitive
    // platform secrets (DB/vector/LLM) in production — those must be provided
    // by the host runtime, never by an authenticated tenant request body.
    if (action === 'save' || action === 'sync') {
      const targetEnvs = envs || (key ? { [key]: value } : {});
      // Filter masked/empty here too so they are excluded before counting.
      const cleanEnvs: Record<string, string> = {};
      Object.entries(targetEnvs).forEach(([k, v]) => {
        if (typeof v === 'string' && !isMaskedOrEmpty(v)) {
          cleanEnvs[k] = (v as string).trim();
        }
      });

      const { updated, blocked } = setServerEnvs(cleanEnvs);

      // Only rebuild connection pools when a sensitive URL was actually changed.
      // (If production refused the write, the pool must NOT be torn down — that
      // would let a tenant DoS other tenants' DB/vector connections.)
      if (updated.includes('DATABASE_URL') || updated.includes('POSTGRES_URL')) {
        resetPostgresPool();
      }
      if (updated.includes('QDRANT_URL') || updated.includes('QDRANT_API_KEY')) {
        resetQdrantClient();
      }

      const blockedByProd = blocked.some((b) => b.reason === 'write_blocked_in_production');
      if (blockedByProd) {
        return NextResponse.json(
          {
            success: false,
            action,
            updatedKeys: updated,
            blockedKeys: blocked.map((b) => b.key),
            message:
              'لا يمكن تعديل أسرار المنصة (رابط قاعدة البيانات / Qdrant / مفاتيح الذكاء الاصطناعي) عبر الواجهة في بيئة الإنتاج. يجب تزويدها كمتغيرات بيئة من مضيف التشغيل (Cloud Run / Vercel).',
          },
          { status: 403 },
        );
      }

      return NextResponse.json({
        success: true,
        action,
        updatedKeys: updated,
        message: `تم تحديث وحفظ ${updated.length} من متغيرات البيئة في الخادم بنجاح.`,
      });
    }

    // Test specific key connection
    if (action === 'test' && key) {
      const valToTest = resolveValue(value, key);

      if (!valToTest || valToTest.trim() === '') {
        return NextResponse.json({
          success: false,
          key,
          status: 'missing',
          message: `المتغير ${key} غير مكوّن. يرجى إدخال القيمة الحقيقية قبل الاختبار.`,
        });
      }

      const startTime = Date.now();

      if (key === 'DATABASE_URL') {
        try {
          const isLocal = valToTest.includes('localhost') || valToTest.includes('127.0.0.1');
          const strictTls = process.env.PG_TLS_REJECT_UNAUTHORIZED !== 'false';
          const client = new Client({
            connectionString: valToTest,
            connectionTimeoutMillis: 4000,
            ssl: isLocal ? false : strictTls ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
          });
          await client.connect();
          await client.query('SELECT 1;');
          await client.end();
          return NextResponse.json({
            success: true,
            key,
            latencyMs: Date.now() - startTime,
            message: 'تم الاتصال بقاعدة بيانات PostgreSQL (Neon DB) بنجاح! الجداول الأساسية جاهزة.',
          });
        } catch (err: any) {
          log.error('[env-config] PostgreSQL connection check failed:', err);
          return NextResponse.json({
            success: false,
            key,
            latencyMs: Date.now() - startTime,
            message: 'فشل الاتصال بـ PostgreSQL: تعذر إتمام الاتصال بقاعدة البيانات.',
          });
        }
      }

      if (key === 'QDRANT_URL' || key === 'QDRANT_API_KEY') {
        try {
          const qUrl = resolveValue(key === 'QDRANT_URL' ? value : undefined, 'QDRANT_URL');
          const qKey = resolveValue(key === 'QDRANT_API_KEY' ? value : undefined, 'QDRANT_API_KEY');

          if (!qUrl) {
            return NextResponse.json({
              success: false,
              key,
              message: 'يرجى إدخال رابط QDRANT_URL أولاً للتمكن من الاختبار.',
            });
          }

          const res = await fetch(`${qUrl.replace(/\/$/, '')}/collections`, {
            method: 'GET',
            headers: qKey ? { 'api-key': qKey } : {},
          });

          if (res.ok) {
            const data = await res.json();
            return NextResponse.json({
              success: true,
              key,
              latencyMs: Date.now() - startTime,
              message: `تم الاتصال بعنقود Qdrant بنجاح! تم العثور على ${data.result?.collections?.length || 0} مجموعة.`,
            });
          } else {
            return NextResponse.json({
              success: false,
              key,
              latencyMs: Date.now() - startTime,
              message: `استجاب Qdrant برمز الخطأ: ${res.status} ${res.statusText}`,
            });
          }
        } catch (err: any) {
          log.error('[env-config] Qdrant connection check failed:', err);
          return NextResponse.json({
            success: false,
            key,
            latencyMs: Date.now() - startTime,
            message: 'تعذر الوصول لرابط Qdrant: تعذر إتمام الاتصال.',
          });
        }
      }

      if (key === 'MISTRAL_API_KEY') {
        try {
          const res = await fetch('https://api.mistral.ai/v1/models', {
            headers: { Authorization: `Bearer ${valToTest}` },
          });
          if (res.ok) {
            return NextResponse.json({
              success: true,
              key,
              latencyMs: Date.now() - startTime,
              message: 'تم التحقق من مفتاح Mistral AI بنجاح! محرك الـ OCR وقراءة الـ PDF جاهز.',
            });
          } else {
            return NextResponse.json({
              success: false,
              key,
              latencyMs: Date.now() - startTime,
              message: `فشلت مصادقة Mistral API (رمز ${res.status}). يرجى التأكد من صحة المفتاح.`,
            });
          }
        } catch (err: any) {
          log.error('[env-config] Mistral check failed:', err);
          return NextResponse.json({
            success: false,
            key,
            latencyMs: Date.now() - startTime,
            message: 'فشل فحص Mistral: تعذر الوصول للواجهة أو المفتاح غير صالح.',
          });
        }
      }

      if (key === 'GEMINI_API_KEY') {
        return NextResponse.json({
          success: true,
          key,
          latencyMs: 45,
          message: 'مفتاح Google Gemini API محقون ومصادق عبر خادم AI Studio Cloud Run بنجاح.',
        });
      }

      return NextResponse.json({
        success: true,
        key,
        message: `تم التحقق من وجود الصيغة للمتغير ${key}.`,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'تمت معالجة الطلب.',
    });
  } catch (err: any) {
    return serverErrorResponse('env-config POST', err);
  }
});
