import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  const sourceTypes = [
    {
      id: 'url',
      category: 'web',
      nameAr: 'مستخرج صفحات الويب والمقالات (URL Connector)',
      nameEn: 'Web Page & Article Extractor',
      descriptionAr:
        'جلب صفحة ويب أو مستند HTML/JSON واستخلاص نصها المقروء بإزالة الزوائد — صفحة واحدة لكل مزامنة عبر حرس SSRF',
      descriptionEn: 'Fetches one web page per sync and extracts readable text via the SSRF-guarded pipeline',
      liveSync: true,
      iconName: 'Globe',
      defaultSchedule: '0 */6 * * *',
      presetDemo: {
        name: 'توثيق OpenAPI الرسمي',
        url: 'https://raw.githubusercontent.com/OAI/OpenAPI-Specification/main/README.md',
      },
      fields: [
        {
          key: 'url',
          labelAr: 'رابط الصفحة أو المستند:',
          labelEn: 'Target URL:',
          type: 'text',
          required: true,
          placeholder: 'https://example.com/docs/page',
        },
      ],
    },
    {
      id: 'web_file',
      category: 'files',
      nameAr: 'موصل رابط ملف على الإنترنت (File URL Connector)',
      nameEn: 'Remote File URL Connector',
      descriptionAr:
        'أعطه رابط ملف (PDF, Word, Excel, PowerPoint, صور, صوتيات, نصوص...) فيقوم بتنزيله ومعالجته وتجزئته وتضمينه وفهرسته في قاعدة المعرفة — بنفس محركات استوديو الرفع',
      descriptionEn:
        'Give it a public file URL (PDF, Word, Excel, PowerPoint, images, audio, text...) and it downloads, parses, chunks, embeds and indexes it using the upload-studio engines',
      liveSync: true,
      iconName: 'FileText',
      defaultSchedule: 'manual',
      presetDemo: {
        name: 'ملف PDF تجريبي من الويب',
        fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        engine: 'auto',
      },
      fields: [
        {
          key: 'fileUrl',
          labelAr: 'رابط الملف على الإنترنت (http/https):',
          labelEn: 'Public File URL (http/https):',
          type: 'text',
          required: true,
          placeholder: 'https://example.com/reports/annual-2026.pdf',
        },
        {
          key: 'engine',
          labelAr: 'محرك المعالجة (كما في استوديو الرفع):',
          labelEn: 'Processing Engine (same as Upload Studio):',
          type: 'select',
          options: [
            { label: 'تلقائي — الأفضل حسب نوع الملف (Auto)', value: 'auto' },
            { label: 'Mistral Document AI (OCR + Visual Layout)', value: 'mistral' },
            { label: 'Unstructured Transform MCP', value: 'unstructured' },
          ],
        },
        {
          key: 'fileName',
          labelAr: 'اسم الملف (اختياري — يُستنتج من الرابط تلقائياً):',
          labelEn: 'File Name (optional — inferred from the URL):',
          type: 'text',
          placeholder: 'annual-report.pdf',
        },
      ],
    },
    {
      id: 'github',
      category: 'code',
      nameAr: 'مستودع شفرة المصدر (GitHub Repository Connector)',
      nameEn: 'GitHub Codebase & Wiki Connector',
      descriptionAr: 'جلب ملف README وبيانات المستودع من GitHub API (عام أو عبر PAT) وفهرسته كوثيقة دلالية',
      descriptionEn: 'Fetches repository metadata + README via the GitHub REST API into a semantic document',
      liveSync: true,
      iconName: 'Github',
      defaultSchedule: '0 */3 * * *',
      presetDemo: {
        name: 'مستودع الشفرة الرئيسية - Core Engine Repo',
        repoUrl: 'https://github.com/acme-org/omnirag-core',
        branch: 'main',
        patToken: '',
      },
      fields: [
        {
          key: 'repoUrl',
          labelAr: 'رابط مستودع جيت هاب:',
          labelEn: 'GitHub Repository URL:',
          type: 'text',
          required: true,
          placeholder: 'https://github.com/owner/repo',
        },
        {
          key: 'branch',
          labelAr: 'الفرع المستهدف (Branch):',
          labelEn: 'Target Branch:',
          type: 'text',
          placeholder: 'افتراضياً الفرع الرئيسي',
        },
        {
          key: 'patToken',
          labelAr: 'رمز وصول شخصي اختياري (PAT) للمستودعات الخاصة ورفع حد المعدل:',
          labelEn: 'Optional PAT (private repos / rate limits):',
          type: 'password',
          placeholder: 'ghp_...',
        },
      ],
    },
    {
      id: 'youtube',
      category: 'media',
      nameAr: 'مستخرج نصوص فيديو يوتيوب (YouTube Subtitles & Transcripts)',
      nameEn: 'YouTube Transcripts & Audio RAG',
      descriptionAr: 'استخراج وتجميع تفريغ النصوص التلقائي من فيديوهات يوتيوب وقوائم التشغيل التعليمية',
      descriptionEn: 'Extract auto-captions and audio transcripts from video playlists for semantic search',
      liveSync: true,
      iconName: 'Youtube',
      defaultSchedule: 'manual',
      presetDemo: {
        name: 'سلسلة المحاضرات التقنية - AI Engineering Playlist',
        playlistUrl: 'https://www.youtube.com/playlist?list=PL1234567890',
        language: 'ar',
        autoSummarize: 'true',
      },
      fields: [
        {
          key: 'playlistUrl',
          labelAr: 'رابط الفيديو أو قائمة التشغيل:',
          labelEn: 'Video or Playlist URL:',
          type: 'text',
          required: true,
          placeholder: 'https://www.youtube.com/watch?v=... or playlist',
        },
        {
          key: 'language',
          labelAr: 'لغة التفريغ النصي:',
          labelEn: 'Transcript Language:',
          type: 'select',
          options: [
            { label: 'العربية والإنجليزية تلقائياً (Arabic & English)', value: 'ar,en' },
            { label: 'العربية فقط (Arabic Only)', value: 'ar' },
            { label: 'الإنكليزية فقط (English Only)', value: 'en' },
          ],
        },
      ],
    },
    {
      id: 'database',
      category: 'databases',
      nameAr: 'قواعد البيانات العلاقاتية (PostgreSQL / MySQL / SQL Server)',
      nameEn: 'Relational Database Connector',
      descriptionAr: 'ربط الجداول والحقول النصية مباشرة لاستخراج البيانات المجدولة وتحويلها لسجلات دلالية',
      descriptionEn: 'Extract text columns from PostgreSQL, MySQL, or SQL Server directly into vector indexes',
      liveSync: false,
      iconName: 'Database',
      defaultSchedule: '0 */6 * * *',
      presetDemo: {
        name: 'قاعدة بيانات تذاكر الدعم الفني - PostgreSQL',
        connectionString: 'postgresql://postgres:pass@db.example.internal:5432/support_db',
        sqlQuery: 'SELECT id, title, description, resolution FROM tickets WHERE status = "resolved"',
        primaryKey: 'id',
      },
      fields: [
        {
          key: 'connectionString',
          labelAr: 'سلسلة الاتصال (Connection String):',
          labelEn: 'Connection String:',
          type: 'text',
          required: true,
          placeholder: 'postgresql://user:pass@localhost:5432/dbname',
        },
        {
          key: 'sqlQuery',
          labelAr: 'استعلام SQL لاستخراج البيانات:',
          labelEn: 'Extraction SQL Query:',
          type: 'textarea',
          required: true,
          placeholder: 'SELECT id, title, content FROM articles',
        },
        {
          key: 'primaryKey',
          labelAr: 'عمود المعرف الفريسي (Primary Key):',
          labelEn: 'Primary Key Column:',
          type: 'text',
          default: 'id',
        },
      ],
    },
    {
      id: 'gdrive',
      category: 'cloud',
      nameAr: 'جوجل درايف وتطبيقات ورك سبيس (Google Drive / Docs)',
      nameEn: 'Google Drive & Workspace Connector',
      descriptionAr: 'مزامنة مستندات Google Docs و Sheets و Slides الملموسة تلقائياً عبر OAuth2',
      descriptionEn: 'Auto-sync Google Docs, Sheets, and Drive folders via secure Service Account or OAuth',
      liveSync: false,
      iconName: 'Folder',
      defaultSchedule: '0 */3 * * *',
      presetDemo: {
        name: 'مجلد اللوائح والسياسات - Google Drive Shared Folder',
        folderId: '1a2b3c4d5e6f7g8h9i0j_enterprise_docs',
        fileFormat: 'docs,pdf',
      },
      fields: [
        {
          key: 'folderId',
          labelAr: 'معرف المجلد المShared Folder ID:',
          labelEn: 'Google Drive Folder ID:',
          type: 'text',
          required: true,
          placeholder: '1a2b3c4d5e6f7g8h9i0j',
        },
        {
          key: 'serviceAccountJson',
          labelAr: 'محتوى حساب الخدمة (Service Account JSON):',
          labelEn: 'Service Account Credentials JSON:',
          type: 'textarea',
          placeholder: '{"type": "service_account", ...}',
        },
      ],
    },
    {
      id: 'rss',
      category: 'web',
      nameAr: 'تلقيم الأخبار والمقالات (RSS / Atom Feeds)',
      nameEn: 'RSS & Atom News Feed Monitor',
      descriptionAr: 'رصد تلقائي للأخبار والمقالات الحديثة واستخراج المحتوى المكتمل لفهرسته فوراً',
      descriptionEn: 'Continuously ingest fresh blog posts, news, and research announcements via RSS/Atom feeds',
      liveSync: true,
      iconName: 'Rss',
      defaultSchedule: '0 */1 * * *',
      presetDemo: {
        name: 'تغذية الأخبار التقنية - Tech & AI Announcements',
        feedUrl: 'https://news.ycombinator.com/rss',
        fullArticleExtract: 'true',
      },
      fields: [
        {
          key: 'feedUrl',
          labelAr: 'رابط التغذية RSS/Atom URL:',
          labelEn: 'RSS/Atom Feed URL:',
          type: 'text',
          required: true,
          placeholder: 'https://example.com/feed.xml',
        },
      ],
    },
    {
      id: 'notion',
      category: 'apps',
      nameAr: 'قواعد معرفة نوُشن (Notion / Confluence Connector)',
      nameEn: 'Notion Workspace & Confluence Wiki',
      descriptionAr: 'ربط مساحات العمل والوثائق المنظمة في Notion و Confluence مع الاستيراد الهيكلي',
      descriptionEn: 'Sync Notion databases and Confluence wiki spaces preserving nested document hierarchies',
      liveSync: false,
      iconName: 'BookOpen',
      defaultSchedule: '0 */6 * * *',
      presetDemo: {
        name: 'قاعدة معرفة الشركة - Notion Master KB',
        databaseId: '9876543210fedcba9876543210fedcba',
        integrationToken: 'secret_notionToken123456789',
      },
      fields: [
        {
          key: 'databaseId',
          labelAr: 'معرف قاعدة البيانات أو الصفحة (Database ID):',
          labelEn: 'Notion Database / Page ID:',
          type: 'text',
          required: true,
          placeholder: '9876543210fedcba...',
        },
        {
          key: 'integrationToken',
          labelAr: 'رمز التكامل السرّي (Internal Integration Token):',
          labelEn: 'Notion Integration Secret:',
          type: 'password',
          placeholder: 'secret_...',
        },
      ],
    },
  ];

  // Effectively static catalog: private caching avoids recomputing the whole
  // connector list on every request while keeping it out of shared CDNs.
  return NextResponse.json(
    { sourceTypes },
    {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' },
    },
  );
});
