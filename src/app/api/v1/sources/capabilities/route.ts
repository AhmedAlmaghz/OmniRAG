import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sourceTypes = [
    {
      id: 'url',
      category: 'web',
      nameAr: 'مستخرج مواقع ويب وطبقات الروابط (Web Crawler / URL)',
      nameEn: 'Web Crawler & Article Extractor',
      descriptionAr: 'زحف تلقائي واستخلاص مقالات ومستندات HTML مع إزالة الزوائد وتتبع الروابط المتشعبة',
      descriptionEn: 'Auto-crawl web pages, articles, and documentation with clean DOM extraction',
      iconName: 'Globe',
      defaultSchedule: '0 */6 * * *',
      presetDemo: {
        name: 'مكتبة التوثيق التقني - OpenAPI Docs',
        url: 'https://docs.api.example.com/v1/openapi.json',
        maxDepth: '2',
        followLinks: 'true',
        selector: 'article, main, .content',
      },
      fields: [
        { key: 'url', labelAr: 'رابط الموقع أو المستند:', labelEn: 'Target URL:', type: 'text', required: true, placeholder: 'https://example.com/docs' },
        { key: 'maxDepth', labelAr: 'عمق الزحف في الروابط (Max Depth):', labelEn: 'Max Depth:', type: 'number', default: 2 },
        { key: 'selector', labelAr: 'محدد محتوى HTML (CSS Selector):', labelEn: 'Content CSS Selector:', type: 'text', placeholder: 'main, article, #content' },
        { key: 'followLinks', labelAr: 'متابعة الروابط الخارجية (Follow External Links):', labelEn: 'Follow External Links:', type: 'select', options: [{ label: 'داخل نفس النطاق فقط (Same Domain)', value: 'false' }, { label: 'السماح بالنطاقات الفرعية (Subdomains)', value: 'true' }] },
      ],
    },
    {
      id: 'file',
      category: 'files',
      nameAr: 'مستودع ملفات وسحابة تخزين (File System / Object Storage)',
      nameEn: 'Cloud & Local File Storage',
      descriptionAr: 'ربط مجلدات محلية أو مستوعات Amazon S3 / Google Cloud Storage لاستيعاب الملفات الضخمة',
      descriptionEn: 'Sync S3 buckets, local directory paths, or Blob storage buckets seamlessly',
      iconName: 'FileText',
      defaultSchedule: '0 */1 * * *',
      presetDemo: {
        name: 'مستودع التقارير السنوية - Cloud Bucket',
        bucketUrl: 's3://enterprise-docs-bucket/policies/2026/',
        fileTypes: '.pdf,.docx,.txt,.md',
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
      },
      fields: [
        { key: 'bucketUrl', labelAr: 'مسار المستودع أو المجلد:', labelEn: 'Bucket Path or Folder URI:', type: 'text', required: true, placeholder: 's3://my-bucket/docs/ or /var/data/docs' },
        { key: 'fileTypes', labelAr: 'أنواع الملفات المسموحة (Extensions):', labelEn: 'Allowed File Extensions:', type: 'text', default: '.pdf,.docx,.txt,.md,.json,.csv' },
        { key: 'accessKey', labelAr: 'مفتاح الوصول / Access Key ID:', labelEn: 'Access Key ID:', type: 'password', placeholder: 'AKIA...' },
      ],
    },
    {
      id: 'github',
      category: 'code',
      nameAr: 'مستودع شفرة المصدر (GitHub Repository Connector)',
      nameEn: 'GitHub Codebase & Wiki Connector',
      descriptionAr: 'استيعاب كامل للمستودعات، ملفات Markdown، والشفرة المصدريّة مع إدراك الهيكل البنائي Code AST',
      descriptionEn: 'Sync GitHub repos, Markdown wikis, issues, and code with Code AST parsing',
      iconName: 'Github',
      defaultSchedule: '0 */3 * * *',
      presetDemo: {
        name: 'مستودع الشفرة الرئيسية - Core Engine Repo',
        repoUrl: 'https://github.com/acme-org/omnirag-core',
        branch: 'main',
        includePaths: 'docs/, src/lib/',
        patToken: 'ghp_exampleToken1234567890abcdef',
      },
      fields: [
        { key: 'repoUrl', labelAr: 'رابط مستودع جيت هاب:', labelEn: 'GitHub Repository URL:', type: 'text', required: true, placeholder: 'https://github.com/owner/repo' },
        { key: 'branch', labelAr: 'الفرع المستهدف (Branch):', labelEn: 'Target Branch:', type: 'text', default: 'main' },
        { key: 'includePaths', labelAr: 'المسارات المشمولة (Include Paths):', labelEn: 'Include Paths:', type: 'text', placeholder: 'docs/, src/, README.md' },
        { key: 'patToken', labelAr: 'رمز الوصول الشخصي (Personal Access Token - PAT):', labelEn: 'GitHub PAT Token:', type: 'password', placeholder: 'ghp_...' },
      ],
    },
    {
      id: 'youtube',
      category: 'media',
      nameAr: 'مستخرج نصوص فيديو يوتيوب (YouTube Subtitles & Transcripts)',
      nameEn: 'YouTube Transcripts & Audio RAG',
      descriptionAr: 'استخراج وتجميع تفريغ النصوص التلقائي من فيديوهات يوتيوب وقوائم التشغيل التعليمية',
      descriptionEn: 'Extract auto-captions and audio transcripts from video playlists for semantic search',
      iconName: 'Youtube',
      defaultSchedule: 'manual',
      presetDemo: {
        name: 'سلسلة المحاضرات التقنية - AI Engineering Playlist',
        playlistUrl: 'https://www.youtube.com/playlist?list=PL1234567890',
        language: 'ar',
        autoSummarize: 'true',
      },
      fields: [
        { key: 'playlistUrl', labelAr: 'رابط الفيديو أو قائمة التشغيل:', labelEn: 'Video or Playlist URL:', type: 'text', required: true, placeholder: 'https://www.youtube.com/watch?v=... or playlist' },
        { key: 'language', labelAr: 'لغة التفريغ النصي:', labelEn: 'Transcript Language:', type: 'select', options: [{ label: 'العربية والإنجليزية تلقائياً (Arabic & English)', value: 'ar,en' }, { label: 'العربية فقط (Arabic Only)', value: 'ar' }, { label: 'الإنكليزية فقط (English Only)', value: 'en' }] },
      ],
    },
    {
      id: 'database',
      category: 'databases',
      nameAr: 'قواعد البيانات العلاقاتية (PostgreSQL / MySQL / SQL Server)',
      nameEn: 'Relational Database Connector',
      descriptionAr: 'ربط الجداول والحقول النصية مباشرة لاستخراج البيانات المجدولة وتحويلها لسجلات دلالية',
      descriptionEn: 'Extract text columns from PostgreSQL, MySQL, or SQL Server directly into vector indexes',
      iconName: 'Database',
      defaultSchedule: '0 */6 * * *',
      presetDemo: {
        name: 'قاعدة بيانات تذاكر الدعم الفني - PostgreSQL',
        connectionString: 'postgresql://postgres:pass@db.example.internal:5432/support_db',
        sqlQuery: 'SELECT id, title, description, resolution FROM tickets WHERE status = "resolved"',
        primaryKey: 'id',
      },
      fields: [
        { key: 'connectionString', labelAr: 'سلسلة الاتصال (Connection String):', labelEn: 'Connection String:', type: 'text', required: true, placeholder: 'postgresql://user:pass@localhost:5432/dbname' },
        { key: 'sqlQuery', labelAr: 'استعلام SQL لاستخراج البيانات:', labelEn: 'Extraction SQL Query:', type: 'textarea', required: true, placeholder: 'SELECT id, title, content FROM articles' },
        { key: 'primaryKey', labelAr: 'عمود المعرف الفريسي (Primary Key):', labelEn: 'Primary Key Column:', type: 'text', default: 'id' },
      ],
    },
    {
      id: 'gdrive',
      category: 'cloud',
      nameAr: 'جوجل درايف وتطبيقات ورك سبيس (Google Drive / Docs)',
      nameEn: 'Google Drive & Workspace Connector',
      descriptionAr: 'مزامنة مستندات Google Docs و Sheets و Slides الملموسة تلقائياً عبر OAuth2',
      descriptionEn: 'Auto-sync Google Docs, Sheets, and Drive folders via secure Service Account or OAuth',
      iconName: 'Folder',
      defaultSchedule: '0 */3 * * *',
      presetDemo: {
        name: 'مجلد اللوائح والسياسات - Google Drive Shared Folder',
        folderId: '1a2b3c4d5e6f7g8h9i0j_enterprise_docs',
        fileFormat: 'docs,pdf',
      },
      fields: [
        { key: 'folderId', labelAr: 'معرف المجلد المShared Folder ID:', labelEn: 'Google Drive Folder ID:', type: 'text', required: true, placeholder: '1a2b3c4d5e6f7g8h9i0j' },
        { key: 'serviceAccountJson', labelAr: 'محتوى حساب الخدمة (Service Account JSON):', labelEn: 'Service Account Credentials JSON:', type: 'textarea', placeholder: '{"type": "service_account", ...}' },
      ],
    },
    {
      id: 'rss',
      category: 'web',
      nameAr: 'تلقيم الأخبار والمقالات (RSS / Atom Feeds)',
      nameEn: 'RSS & Atom News Feed Monitor',
      descriptionAr: 'رصد تلقائي للأخبار والمقالات الحديثة واستخراج المحتوى المكتمل لفهرسته فوراً',
      descriptionEn: 'Continuously ingest fresh blog posts, news, and research announcements via RSS/Atom feeds',
      iconName: 'Rss',
      defaultSchedule: '0 */1 * * *',
      presetDemo: {
        name: 'تغذية الأخبار التقنية - Tech & AI Announcements',
        feedUrl: 'https://news.ycombinator.com/rss',
        fullArticleExtract: 'true',
      },
      fields: [
        { key: 'feedUrl', labelAr: 'رابط التغذية RSS/Atom URL:', labelEn: 'RSS/Atom Feed URL:', type: 'text', required: true, placeholder: 'https://example.com/feed.xml' },
      ],
    },
    {
      id: 'notion',
      category: 'apps',
      nameAr: 'قواعد معرفة نوُشن (Notion / Confluence Connector)',
      nameEn: 'Notion Workspace & Confluence Wiki',
      descriptionAr: 'ربط مساحات العمل والوثائق المنظمة في Notion و Confluence مع الاستيراد الهيكلي',
      descriptionEn: 'Sync Notion databases and Confluence wiki spaces preserving nested document hierarchies',
      iconName: 'BookOpen',
      defaultSchedule: '0 */6 * * *',
      presetDemo: {
        name: 'قاعدة معرفة الشركة - Notion Master KB',
        databaseId: '9876543210fedcba9876543210fedcba',
        integrationToken: 'secret_notionToken123456789',
      },
      fields: [
        { key: 'databaseId', labelAr: 'معرف قاعدة البيانات أو الصفحة (Database ID):', labelEn: 'Notion Database / Page ID:', type: 'text', required: true, placeholder: '9876543210fedcba...' },
        { key: 'integrationToken', labelAr: 'رمز التكامل السرّي (Internal Integration Token):', labelEn: 'Notion Integration Secret:', type: 'password', placeholder: 'secret_...' },
      ],
    },
  ];

  return NextResponse.json({ sourceTypes });
}
