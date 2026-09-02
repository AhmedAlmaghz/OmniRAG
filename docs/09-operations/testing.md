# الاختبارات

المنظومة مغطّاة بـ [Vitest](https://vitest.dev) (الإصدار v4 من `package.json`)، بيئة `node`، مهل افتراضية 30 ثانية (مُعَدَّلة من 5s في `vitest.config.ts` لاحتواء Argon2 وتشفير AES وطلبات الحدّ).

## الإعداد

`vitest.config.ts`:

```ts
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
```

السكريبت:

```bash
npm run test       # vitest run
npm run typecheck  # tsc --noEmit
```

كل ملفات الاختبار داخل `src/__tests__/*.test.ts` (58 ملف).

## جرد ملفات الاختبار الرئيسية

| الملف                             | يغطّي                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `aggregativeRetrieval.test.ts`    | توجيه الاستعلامات التجميعية (مثل “ما هي الدروس والوحدات في كتاب الرياضيات”) لتجاوز `top-k` عادي |
| `analyticsCompute.test.ts`        | عقد حساب التحليلات — الصدق (لا قيم مفبركة مثل P95=180ms)                                        |
| `apiAuth.test.ts`                 | بوابة `verifyApiAuth` لمساري API Key و Session cookie                                           |
| `apiKeys.test.ts`                 | توليد/تخزين/تحقق مفاتيح API: hash فقط، لا plaintext                                             |
| `authRoundtrip.test.ts`           | دورة تسجيل → دخول → جلسة → tenant كاملة ضد in-memory backend                                    |
| `batchIngestion.test.ts`          | دفعة التضمينات مع التزامن المحدود و الحفاظ على ترتيب المدخلات                                   |
| `chatErrorBubble.test.ts`         | حارس regression: لا فقاعة فارغة عند فشل المزوّد                                                 |
| `chunker.test.ts`                 | المقطِّع الموحَّد (مصدر الحقيقة الوحيد للقصاصات)                                                |
| `connectorRegistry.test.ts`       | عقد سجل الموصلات                                                                                |
| `csrfOriginGate.test.ts`          | دمج حارس CSRF مع `withAuthAndRateLimit` على 50 مسار                                             |
| `directUpload.test.ts`            | حلّ مزوّد الرفع المباشر                                                                         |
| `durableRateLimiter.test.ts`      | نافذة ثابتة عبر Postgres: upsert ذري واحد                                                       |
| `encryption.test.ts`              | AES-256-GCM token store                                                                         |
| `extractionRegistry.test.ts`      | عقد سلسلة الاستخلاص (ترتيب حسب الأولوية، عقد `runExtractionChain`)                              |
| `geminiTranscriber.test.ts`       | تحويل الكلام بـ AI SDK v7: inline صغير + Files API للملفات الكبيرة + حذف بعد الاستخدام          |
| `hookHarness.test.ts`             | خطافات الأمان (HookHarness)                                                                     |
| `ingestion.test.ts`               | إعدادات النظام و حدود المعدّل                                                                   |
| `injectionShield.test.ts`         | توسيع Phase 6: أنماط حقن جديدة (DAN، “act as if”)                                               |
| `jobQueue.test.ts`                | عقد pg-boss: `isCronSchedule`، degradation عند انعدام Postgres                                  |
| `lexicalTenantIsolation.test.ts`  | حارس Phase 2: تسرّب معجمي بين المستأجرين                                                        |
| `liveConnectors.test.ts`          | الموصلات الحيّة                                                                                 |
| `loginSecurity.test.ts`           | Phase 3 hardening: rate limit per-IP و per-email                                                |
| `mcpAiSdkBridge.test.ts`          | جسر MCP ↔ AI SDK v7 (zod، حراسة الموافقة)                                                       |
| `mcpDispatcher.test.ts`           | عقد الموزّع الموحَّد: tool_call audit + فشل صريح                                                |
| `mcpKnowledgeTools.test.ts`       | عقد `unstructured_parse_document` و `knowledge_ingest_document`                                 |
| `mcpNetSsrf.test.ts`              | حرس SSRF واستخراج HTML                                                                          |
| `mcpOauthHardening.test.ts`       | RFC 9207 issuer تحقق صارم، `tenantId:pkceState` خارجي                                           |
| `mcpRegistry.test.ts`             | عقد السجل: كل اسم أداة محلول (يشمل legacy aliases)                                              |
| `mcpRemoteClient.test.ts`         | العميل البعيد: SSRF قبل الإنشاء، مصافحة حقيقية                                                  |
| `memoryDbContract.test.ts`        | `IOmniRAGDatabase`، versioning، in-memory backend                                               |
| `modelConfigPropagation.test.ts`  | نشر إعدادات النموذج عبر السياق                                                                  |
| `modelRef.test.ts`                | مرجع النموذج                                                                                    |
| `objectStores.test.ts`            | عقد مخازن الكائنات                                                                              |
| `password.test.ts`                | Argon2id: hash، verify، salts، الرفض الآمن لـ encoded مكسور                                     |
| `phase4Skills.test.ts`            | مهارات الإنتاج                                                                                  |
| `phase5TeamsSharingSso.test.ts`   | الفرق/المشاركة/SSO                                                                              |
| `phase6RateLimits.test.ts`        | حدود المعدّل                                                                                    |
| `phase6WebhooksMcp.test.ts`       | Webhooks وMCP                                                                                   |
| `phase7I18nPlans.test.ts`         | i18n والخطط                                                                                     |
| `piiStreamRedactor.test.ts`       | تعتيم PII في تدفق البث (look-ahead للاحقة)                                                      |
| `pipelineTemplates.test.ts`       | قوالب المسار (fast/balanced/accurate)                                                           |
| `planSwitchGate.test.ts`          | بوابة تبديل الخطة                                                                               |
| `pptxParser.test.ts`              | محلل PPTX المحلي                                                                                |
| `providerRegistry.test.ts`        | سجل مزوّدي AI                                                                                   |
| `providerTranscription.test.ts`   | تفريغ المزوّدين                                                                                 |
| `qdrantPointId.test.ts`           | معرّفات نقاط Qdrant                                                                             |
| `questionNavigator.test.ts`       | ملّاح الأسئلة                                                                                   |
| `reembedService.test.ts`          | خدمة إعادة التضمين                                                                              |
| `rrf.test.ts`                     | خوارزمية Reciprocal Rank Fusion                                                                 |
| `rrfScore.test.ts`                | درجات RRF                                                                                       |
| `securityHeaders.test.ts`         | رؤوس الأمان + CSP                                                                               |
| `svgSanitizer.test.ts`            | تعقيم SVG (DOMPurify + data: hook)                                                              |
| `tokenBudget.test.ts`             | ميزانية التوكنات                                                                                |
| `vectorStores.test.ts`            | عقد مخازن المتجهات                                                                              |
| `webFetchStudio.test.ts`          | استوديو جلب الويب                                                                               |
| `webFileConnector.test.ts`        | موصل ملف ويب                                                                                    |
| `webRandom.test.ts`               | عشوائية آمنة                                                                                    |
| `youtubeTranscriptLadder.test.ts` | سلّم تفريغ يوتيوب                                                                               |

## اتفاقيات الاختبار

1. **اختبار regression = وصفه ظاهرة بصرية:** كثير من الملفات تبدأ بـ “Regression guard for Phase X: Symptom this pins…”.
2. **in-memory backend افتراضي:** `db` غير مقلَّد إلا عند الحاجة، فيُستخدم نفس الـ `IOmniRAGDatabase` بـ in-memory fallback.
3. **اختبارات أمان تشمل:** `password`, `encryption`, `csrfOriginGate`, `csrf`, `durableRateLimiter`, `injectionShield`, `mcpOauthHardening`, `mcpNetSsrf`, `piiStreamRedactor`, `securityHeaders`, `svgSanitizer`, `webRandom`, `apiAuth`, `apiKeys`, `authRoundtrip`, `loginSecurity`, `lexicalTenantIsolation`.
4. **اختبارات MCP مدمجة:** `mcpAiSdkBridge`, `mcpDispatcher`, `mcpKnowledgeTools`, `mcpNetSsrf`, `mcpOauthHardening`, `mcpRegistry`, `mcpRemoteClient`.
5. **اختبارات الاستخلاص:** `extractionRegistry`, `pipelineTemplates`, `pptxParser`, `geminiTranscriber`, `providerTranscription`.

## تشغيل مختار

```bash
# جميع الاختبارات
npm run test

# ملف واحد
npx vitest run src/__tests__/password.test.ts

# مرشح بالاسم
npx vitest run -t "Argon2id"

# وضع المراقبة
npx vitest
```

## انظر أيضاً

- [CI/CD والأتمتة](scripts-tools.md) — سكريبتات npm.
- [الأمان](../06-security/protections.md) — تفاصيل الحُرّاس التي تختبرها هذه الملفات.
- [MCP](../08-integrations/mcp.md) — عقود السجل والموزّع.
