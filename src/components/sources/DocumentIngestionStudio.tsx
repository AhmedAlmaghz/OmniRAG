'use client';

import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Collection } from '@/lib/types/omnirag';
import { getIngestionSettings } from '@/lib/config/ingestionSettings';
import { useDocumentCache } from '@/hooks/useDocumentCache';
import { validateUploadedFile, validateYoutubeUrl } from './documentIngestionHelpers';
import {
  Upload,
  FileText,
  Sliders,
  Sparkles,
  Layers,
  FileCode,
  CheckCircle2,
  AlertCircle,
  FolderPlus,
  Loader2,
  Copy,
  Eye,
  Zap,
  Globe,
  Trash2,
  FileCheck,
  Code,
  BookOpen,
  Scissors,
  BarChart2,
  ListPlus,
  Clock,
  MonitorPlay,
  Database,
  Plus,
} from 'lucide-react';

interface IngestionProgressStep {
  id: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  durationMs: number;
}

const INITIAL_STEPS: IngestionProgressStep[] = [
  {
    id: 'read',
    nameAr: 'تحميل وقراءة الملف',
    nameEn: 'File Ingest & Parsing',
    descAr: 'قراءة محتويات الملف وفك تشفير البايتات وتهيئة الذاكرة',
    descEn: 'Opening file, extracting raw stream, and validating metadata.',
    status: 'pending',
    progress: 0,
    durationMs: 1200,
  },
  {
    id: 'parse',
    nameAr: 'تحليل البنية والتنسيق الدلالي',
    nameEn: 'Layout & AST Analysis',
    descAr: 'استخلاص الجداول والهياكل والترويسات وتصفية النصوص',
    descEn: 'Analyzing markdown headers, layouts, tables, or AST tokens.',
    status: 'pending',
    progress: 0,
    durationMs: 1600,
  },
  {
    id: 'chunk',
    nameAr: 'تقسيم المقاطع وتطبيق النوافذ المتداخلة',
    nameEn: 'Sliding Window Chunking',
    descAr: 'تقطيع دلالي دقيق مع تداخل الحدود لمنع ضياع السياق المعرفي',
    descEn: 'Creating logical paragraphs with exact sliding token boundaries.',
    status: 'pending',
    progress: 0,
    durationMs: 1800,
  },
  {
    id: 'embed',
    nameAr: 'توليد المتجهات الدلالية عبر نموذج Gemini',
    nameEn: 'Semantic Embedding Generation',
    descAr: 'استدعاء نموذج text-embedding-004 لبناء مصفوفات 768-Dim',
    descEn: 'Calling text-embedding-004 model to generate 768-dim vectors.',
    status: 'pending',
    progress: 0,
    durationMs: 2200,
  },
  {
    id: 'index',
    nameAr: 'فهرسة وتخزين المتجهات في Qdrant',
    nameEn: 'Multi-Tenant Qdrant Indexing',
    descAr: 'تخزين المقاطع في مستودع المتجهات المعزول الخاص بك مع تشفير المسافات الدلالية',
    descEn: 'Upserting vectors into isolated index partitions in Qdrant DB.',
    status: 'pending',
    progress: 0,
    durationMs: 1200,
  },
];

interface DocumentIngestionStudioProps {
  tenantId: string;
  collections: Collection[];
  lang: 'ar' | 'en';
  onIngestionCompleted: (createdSourceId?: string) => void;
  onNavigateTab?: (tab: string) => void;
  initialTab?: 'upload' | 'youtube' | 'text' | 'sample';
}

const SAMPLE_DOCS = [
  {
    id: 'cyber-policy-ar',
    title: 'سياسة وإرشادات حماية البيانات والأمن السيبراني 2026',
    category: 'سياسات وحوكمة',
    type: 'pdf',
    content: `وثيقة سياسة حماية البيانات الوطنية والأمن السيبراني - إصدار 2026

1. المقدمة والأهداف العامة
تهدف هذه السياسة إلى وضع الضوابط والمعايير اللازمة لحماية الأصول المعلوماتية والبيانات الحساسة في المؤسسة، وضمان استمرارية الأعمال والحد من المخاطر السيبرانية المتزايدة.

2. نطاق تطبيق السياسة
تطبق هذه السياسة على جميع الموظفين، المتعاقدين، والموردين الخارجيين الذين يتعاملون مع البنية التحتية لنظم المعلومات وقواعد البيانات الخاصة بالمؤسسة.

3. تصنيف البيانات وإدارة الوصول
تُصنَّف البيانات إلى أربع مستويات أساسية:
- سري للغاية (Top Secret): البيانات السيادية والخطط الاستراتيجية.
- سري (Secret): البيانات المالية وتفاصيل العملاء.
- مقيد (Restricted): الشفرات المصدريّة والوثائق الداخلية.
- عام (Public): النشرات المتاحة للجمهور.

4. ضوابط التشفير وحماية المتجهات
يجب تشفير جميع البيانات الحساسة أثناء النقل (In-Transit) باستخدام بروتوكول TLS 1.3، وأثناء التخزين (At-Rest) باستخدام خوارزمية AES-256. بالنسبة لمحركات RAG والمتجهات، يتم ضمان عزل البيانات حسب المعرف المستأجر (Tenant ID Isolation).`,
  },
  {
    id: 'rag-architecture-en',
    title: 'OmniRAG System Architecture & Hybrid Vector Retrieval Spec',
    category: 'هندسة الأنظمة',
    type: 'spec',
    content: `# OmniRAG Enterprise Architecture Specification v2.4

## 1. Overview
OmniRAG is a multi-tenant Agentic RAG engine powered by Qdrant, BM25 hybrid search, and Gemini 2.5 Flash models.

## 2. Ingestion Pipeline
- Document Parsing: PDF, DOCX, Markdown, Code AST, and Web Crawlers.
- Chunking Strategies:
  - Semantic Chunking with dynamic sentence boundary detection.
  - Markdown Headings splitting for hierarchical documentation.
  - Code AST chunking for Python, TypeScript, and Go.
- Embeddings: Text-embedding-004 (768 dimensions) with dense vector normalization.

## 3. Hybrid Search & Re-ranking
1. Dense Retrieval: HNSW cosine similarity query in Qdrant.
2. Sparse Retrieval: BM25 keyword match for exact code symbols and IDs.
3. Fusion: Reciprocal Rank Fusion (RRF) with configurable alpha parameter (default 0.5).
4. Re-ranking: Cross-Encoder model fine-tuned for Arabic and English semantics.`,
  },
  {
    id: 'python-api-code',
    title: 'FastAPI Microservice Engine & Stream Pipeline Code',
    category: 'شفرة مصدريّة',
    type: 'code',
    content: `from fastapi import FastAPI, Depends, HTTPException, Security
from pydantic import BaseModel
from typing import List, Optional
import os

app = FastAPI(title="OmniRAG Ingestion Microservice", version="2.0.0")

class ChunkingRequest(BaseModel):
    document_id: str
    content: str
    chunk_size: int = 512
    overlap: int = 20
    strategy: str = "semantic"

@app.post("/api/v2/ingest/process")
async def process_document_ingestion(req: ChunkingRequest):
    """
    Asynchronous document parsing and vector embedding generation pipeline.
    """
    if not req.content:
        raise HTTPException(status_code=400, detail="Content cannot be empty")
    
    # Calculate token chunks
    chunks = split_text_into_chunks(
        text=req.content,
        size=req.chunk_size,
        overlap=req.overlap,
        strategy=req.strategy
    )
    
    return {
        "status": "success",
        "document_id": req.document_id,
        "chunk_count": len(chunks),
        "chunks": chunks[:3]  # Preview first 3
    }`,
  },
];

// Validation helpers are imported from ./documentIngestionHelpers.

export function DocumentIngestionStudio({
  tenantId,
  collections,
  lang,
  onIngestionCompleted,
  onNavigateTab,
  initialTab = 'upload',
}: DocumentIngestionStudioProps) {
  const [inputTab, setInputTab] = useState<'upload' | 'youtube' | 'text' | 'sample'>(initialTab);

  // Document OCR Cache Hook
  const { getCache, saveCache } = useDocumentCache();

  // Parsing Progress Bar State
  const [parseProgress, setParseProgress] = useState<number>(0);
  const [parseStage, setParseStage] = useState<'hash' | 'upload' | 'ocr' | 'chunk' | 'complete'>('hash');
  const [parseStageText, setParseStageText] = useState<string>('');
  const [parseElapsedMs, setParseElapsedMs] = useState<number>(0);

  useEffect(() => {
    if (initialTab) {
      setInputTab(initialTab);
    }
  }, [initialTab]);

  // Ingestion Completion State
  const [completionData, setCompletionData] = useState<{
    sourceId: string;
    sourceName: string;
    chunkCount: number;
    documentId: string;
    sourceType: string;
  } | null>(null);

  // Document State
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [fileSizeStr, setFileSizeStr] = useState<string>('');

  // YouTube Extraction State
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [isExtractingYoutube, setIsExtractingYoutube] = useState(false);
  const [youtubeVideoMeta, setYoutubeVideoMeta] = useState<{
    title: string;
    channel: string;
    duration: string;
    thumbnail: string;
    wordCount: number;
    method?: string;
  } | null>(null);

  // Extract YouTube Transcript Handler
  const handleExtractYoutubeTranscript = async () => {
    // Input validation step
    const validation = validateYoutubeUrl(youtubeUrl);
    if (!validation.isValid) {
      setStatusMessage({
        type: 'error',
        text: lang === 'ar' ? validation.errorAr! : validation.errorEn!,
      });
      return;
    }

    setIsExtractingYoutube(true);
    setStatusMessage(null);

    try {
      const res = await fetchWithAuth('/api/v1/youtube/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl.trim(), lang }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.transcript) {
        setDocTitle(data.title || `تفريغ فيديو: ${data.videoId}`);
        setDocContent(data.transcript);
        setSelectedFileName(`youtube-${data.videoId}.txt`);
        setFileSizeStr(`${(data.transcript.length / 1024).toFixed(1)} KB`);
        setYoutubeVideoMeta({
          title: data.title,
          channel: data.channel,
          duration: data.duration,
          thumbnail: data.thumbnail,
          wordCount: data.wordCount || 0,
          method: data.extractionMethod || 'Whisper AI / Multi-Engine',
        });

        setStatusMessage({
          type: 'success',
          text:
            lang === 'ar'
              ? `تم التحقق واستخراج تفريغ الفيديو بنجاح بواسطة [${data.extractionMethod || 'Whisper / AI'}] (${data.wordCount} كلمة)! جاهز للتقسيم والفهرسة.`
              : `YouTube transcript extracted successfully via [${data.extractionMethod || 'Whisper / AI'}] (${data.wordCount} words)! Ready for chunking and vector indexing.`,
        });
      } else {
        throw new Error(
          data.error ||
            (lang === 'ar'
              ? 'فشل استخراج تفريغ الفيديو أو أن الفيديو غير متاح'
              : 'Failed to extract video transcript or video is inaccessible'),
        );
      }
    } catch (err: any) {
      console.error('YouTube transcript error:', err);
      setStatusMessage({
        type: 'error',
        text:
          lang === 'ar'
            ? `خطأ أثناء التحقق واستخراج التفريغ: ${err.message}`
            : `Validation & extraction failed: ${err.message}`,
      });
    } finally {
      setIsExtractingYoutube(false);
    }
  };

  // Chunking & AI Parsing Controls
  const [parsingEngine, setParsingEngine] = useState<'mistral_ocr' | 'unstructured_mcp' | 'native_ast' | 'pdf_layout'>(
    'mistral_ocr',
  );
  // Seeded from the global ingestion settings store (Settings → Ingestion)
  // so the configured DEFAULTS are actually applied per new document.
  // Strategy values MUST stay within the backend chunker's union — the old
  // 'code'/'sliding' options were rejected server-side by zod validation.
  const [chunkStrategy, setChunkStrategy] = useState<'semantic' | 'markdown' | 'recursive'>(
    () => getIngestionSettings().chunkStrategy,
  );
  const [chunkSize, setChunkSize] = useState<number>(() => getIngestionSettings().chunkSize);
  const [chunkOverlap, setChunkOverlap] = useState<number>(() => getIngestionSettings().chunkOverlap);
  const [selectedColIds, setSelectedColIds] = useState<string[]>([]);

  // Processing state
  const [isUploading, setIsUploading] = useState(false);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [steps, setSteps] = useState<IngestionProgressStep[]>([]);
  const [overallProgress, setOverallProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Wall-clock start of the current ingestion request (for honest elapsed time). */
  const uploadStartedAtRef = useRef<number>(0);

  // Progress-animation intervals started by ingestion handlers. They are
  // cleared when each request settles, but a mid-upload UNMOUNT previously
  // left them running forever, firing setState on a dead component. Every
  // interval registers here and unmount cleanup sweeps the rest.
  const activeIntervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set());

  const registerInterval = (id: ReturnType<typeof setInterval>) => {
    activeIntervalsRef.current.add(id);
    return id;
  };

  const unregisterInterval = (id: ReturnType<typeof setInterval>) => {
    clearInterval(id);
    activeIntervalsRef.current.delete(id);
  };

  useEffect(() => {
    const intervals = activeIntervalsRef.current;
    return () => {
      intervals.forEach((id) => clearInterval(id));
      intervals.clear();
    };
  }, []);

  // Load sample document
  const handleSelectSample = (sample: (typeof SAMPLE_DOCS)[0]) => {
    setDocTitle(sample.title);
    setDocContent(sample.content);
    setSelectedFileName(`${sample.id}.${sample.type}`);
    setFileSizeStr(`${(sample.content.length / 1024).toFixed(1)} KB`);
    setInputTab('text');
  };

  // Handle Real File Selection / Drag & Drop
  const handleFileProcess = async (file: File) => {
    if (!file) return;

    // File validation step
    const validation = validateUploadedFile(file);
    if (!validation.isValid) {
      setStatusMessage({
        type: 'error',
        text: lang === 'ar' ? validation.errorAr! : validation.errorEn!,
      });
      return;
    }

    setSelectedFileName(file.name);
    setFileSizeStr(`${(file.size / 1024).toFixed(1)} KB`);
    if (!docTitle) {
      setDocTitle(file.name.replace(/\.[^/.]+$/, ''));
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isText =
      file.type.startsWith('text/') ||
      file.name.toLowerCase().endsWith('.txt') ||
      file.name.toLowerCase().endsWith('.md') ||
      file.name.toLowerCase().endsWith('.json') ||
      file.name.toLowerCase().endsWith('.csv');

    if (isText && !isPdf) {
      // Fast client-side read for plain text files
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) {
          setDocContent(text);
          setInputTab('text');
        }
      };
      reader.readAsText(file);
    } else {
      // Send to server-side PDF/Document parser via multipart FormData with live progress updates
      setIsParsingFile(true);
      setParseProgress(10);
      setParseStage('hash');
      setParseStageText(
        lang === 'ar'
          ? 'جاري توليد بصمة SHA-256 للتحقق من وجود معالجة سابقة بنفس الملف...'
          : 'Computing SHA-256 hash & searching local OCR cache...',
      );
      setParseElapsedMs(0);

      const activeIngestionSettings = getIngestionSettings();
      const currentPagesPerChunk = activeIngestionSettings.pagesPerChunk || 25;
      const currentMaxFileSizeMb = activeIngestionSettings.maxFileSizeMb || 50;

      // Verify file size limit before attempting upload
      if (file.size > currentMaxFileSizeMb * 1024 * 1024) {
        setIsParsingFile(false);
        setStatusMessage({
          type: 'error',
          text:
            lang === 'ar'
              ? `حجم الملف (${(file.size / (1024 * 1024)).toFixed(1)} MB) يتجاوز الحد الأقصى المسموح به في الإعدادات (${currentMaxFileSizeMb} MB). يمكنك زيادة الحد في شاشة الإعدادات.`
              : `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds configured maximum size (${currentMaxFileSizeMb} MB). Increase limit in Settings.`,
        });
        return;
      }

      const progressInterval = registerInterval(
        setInterval(() => {
          setParseElapsedMs((prev) => prev + 200);
          setParseProgress((prev) => {
            if (prev < 90) {
              // Deterministic constant increment (was random 1-4). UI animation
              // only — this is not security- or correctness-relevant, but a fixed
              // step keeps the bar moving uniformly without CSPRNG intake.
              return prev + 2;
            }
            return prev;
          });
        }, 200),
      );

      (async () => {
        try {
          // 1. SHA-256 Client-Side OCR Cache Check using useDocumentCache hook
          const { entry: cachedEntry, cacheKey: fileHash } = await getCache(file, file.name, file.size);

          if (cachedEntry && cachedEntry.extractedText && cachedEntry.extractedText.trim().length > 0) {
            unregisterInterval(progressInterval);
            setParseProgress(100);
            setParseStage('complete');
            setParseStageText(
              lang === 'ar' ? 'تم استرجاع النص من الذاكرة المؤقتة (0ms)' : 'Loaded from OCR cache (0ms)',
            );
            setDocContent(cachedEntry.extractedText);
            setInputTab('text');
            setIsParsingFile(false);

            const savedTokens = cachedEntry.savedTokensEstimate || Math.round(cachedEntry.extractedText.length / 4);
            setStatusMessage({
              type: 'success',
              text:
                lang === 'ar'
                  ? `⚡ [Mistral OCR Cache Hit] تم تحميل نص المستند المعالج سابقاً فوراً (0ms). تم توفير طلب الـ API ونحو ${savedTokens.toLocaleString()} رمز.`
                  : `⚡ [Mistral OCR Cache Hit] Loaded processed document text instantly from cache (0ms). Saved API call & ~${savedTokens.toLocaleString()} tokens.`,
            });
            return;
          }

          // Progress to Upload Stage
          const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
          let res: Response | null = null;
          let fileHashForOcr = '';
          let finalExtractedText = '';
          let finalTotalPages = 1;
          let finalChunksProcessed = 1;
          let finalEngineUsed = parsingEngine === 'mistral_ocr' ? 'Mistral Document AI' : 'Unstructured.io MCP';

          // Large-file path: negotiate a direct-upload provider with the server
          // so the file bytes never hit a hosting body limit (e.g. Vercel's
          // 4.5 MB FUNCTION_PAYLOAD_TOO_LARGE). The server picks whichever is
          // configured: S3-compatible (Tigris/S3/R2/MinIO — any host) or the
          // optional Vercel Blob path. With no provider, fall back to the
          // classic direct upload below.
          const DIRECT_UPLOAD_THRESHOLD = 3.5 * 1024 * 1024;
          if (file.size > DIRECT_UPLOAD_THRESHOLD) {
            setParseStage('upload');
            setParseStageText(
              lang === 'ar'
                ? `جاري رفع الملف الكبير (${(file.size / (1024 * 1024)).toFixed(2)} MB) إلى التخزين السحابي الآمن...`
                : `Uploading large file (${(file.size / (1024 * 1024)).toFixed(2)} MB) to secure cloud storage...`,
            );

            try {
              const sessionRes = await fetchWithAuth('/api/v1/documents/upload-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fileName: file.name,
                  mimeType: file.type || 'application/octet-stream',
                  sizeBytes: file.size,
                }),
              });

              if (sessionRes.ok) {
                const session = await sessionRes.json();

                if (session.method === 's3' && session.uploadUrl) {
                  // Presigned PUT straight to the S3-compatible store. The
                  // Content-Type must match the signed value exactly.
                  const putRes = await fetch(session.uploadUrl, {
                    method: 'PUT',
                    headers: { 'Content-Type': session.contentType || 'application/octet-stream' },
                    body: file,
                  });
                  if (!putRes.ok) {
                    throw new Error(`Direct storage PUT failed: HTTP ${putRes.status}`);
                  }

                  setParseProgress(55);
                  setParseStage('ocr');
                  setParseStageText(
                    lang === 'ar'
                      ? 'جاري معالجة المستند من التخزين السحابي عبر محرك الذكاء الاصطناعي...'
                      : 'Processing document from cloud storage via AI pipeline...',
                  );

                  res = await fetchWithAuth('/api/v1/documents/parse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      storageKey: session.storageKey,
                      fileName: file.name,
                      mimeType: file.type || 'application/octet-stream',
                      engine:
                        parsingEngine === 'mistral_ocr'
                          ? 'mistral'
                          : parsingEngine === 'unstructured_mcp'
                            ? 'unstructured'
                            : 'auto',
                      pagesPerChunk: currentPagesPerChunk,
                      maxFileSizeMb: currentMaxFileSizeMb,
                    }),
                  });
                } else if (session.method === 'vercel-blob') {
                  // Optional Vercel-hosted path: the SDK fetches its own
                  // token from handleUploadUrl, then uploads directly.
                  const { upload } = await import('@vercel/blob/client');
                  const tenantPrefix = `uploads/${tenantId}`;
                  const safeName = file.name.replace(/[^\w.\-() ]/g, '_');
                  const pathname = `${tenantPrefix}/${Date.now()}-${safeName}`;

                  const blobResult = await upload(pathname, file, {
                    access: 'public',
                    handleUploadUrl: session.handleUploadUrl || '/api/v1/documents/upload-token',
                    onUploadProgress: ({ percentage }) => {
                      setParseProgress(Math.min(10 + Math.round(percentage * 0.4), 50));
                    },
                  });

                  if (blobResult?.url) {
                    setParseProgress(55);
                    setParseStage('ocr');
                    setParseStageText(
                      lang === 'ar'
                        ? 'جاري معالجة المستند من التخزين السحابي عبر محرك الذكاء الاصطناعي...'
                        : 'Processing document from cloud storage via AI pipeline...',
                    );

                    res = await fetchWithAuth('/api/v1/documents/parse', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        blobUrl: blobResult.url,
                        fileName: file.name,
                        mimeType: file.type || 'application/octet-stream',
                        engine:
                          parsingEngine === 'mistral_ocr'
                            ? 'mistral'
                            : parsingEngine === 'unstructured_mcp'
                              ? 'unstructured'
                              : 'auto',
                        pagesPerChunk: currentPagesPerChunk,
                        maxFileSizeMb: currentMaxFileSizeMb,
                      }),
                    });
                  }
                }
                // method === 'none': no provider configured on this host —
                // fall through to the classic direct upload below.
              }
            } catch (directUploadErr: any) {
              console.warn('[DocumentIngestion] Direct storage upload failed, falling back:', directUploadErr);
              res = null;
            }
          }

          if (!res && isPdf && file.size > 4 * 1024 * 1024) {
            // Client-side PDF Slicing using pdf-lib!
            setParseStageText(
              lang === 'ar'
                ? 'جاري تجزئة ملف الـ PDF الكبير على المتصفح لتفادي الأخطاء وتسهيل المعالجة السريعة...'
                : 'Slicing large PDF file on client to prevent errors & optimize speed...',
            );

            try {
              const { PDFDocument } = await import('pdf-lib');
              const arrayBuffer = await file.arrayBuffer();
              const srcDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
              const totalPages = srcDoc.getPageCount();

              if (totalPages > 0) {
                // Honor the user-configured batch size instead of a hardcoded
                // 15 that silently ignored the Ingestion settings screen.
                const pagesPerChunk = Math.max(5, currentPagesPerChunk);
                const totalChunks = Math.ceil(totalPages / pagesPerChunk);
                const chunkTexts: string[] = [];

                console.log(
                  `[Client-Side Chunker] Slicing PDF into ${totalChunks} chunks of up to ${pagesPerChunk} pages each.`,
                );

                for (let i = 0; i < totalPages; i += pagesPerChunk) {
                  const end = Math.min(i + pagesPerChunk, totalPages);
                  const chunkIdx = Math.floor(i / pagesPerChunk) + 1;

                  setParseProgress(Math.min(35 + Math.floor((chunkIdx / totalChunks) * 55), 90));
                  setParseStageText(
                    lang === 'ar'
                      ? `جاري معالجة الجزء ${chunkIdx} من ${totalChunks} (الصفحات ${i + 1} - ${end})...`
                      : `Processing chunk ${chunkIdx} of ${totalChunks} (Pages ${i + 1} - ${end})...`,
                  );

                  const subDoc = await PDFDocument.create();
                  const pageIndices = Array.from({ length: end - i }, (_, idx) => i + idx);
                  const copiedPages = await subDoc.copyPages(srcDoc, pageIndices);
                  copiedPages.forEach((page) => subDoc.addPage(page));

                  const subPdfBytes = await subDoc.save();

                  // Convert subPdfBytes (Uint8Array) to base64 using native FileReader
                  const base64Data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      const result = (reader.result as string) || '';
                      const base64 = result.includes(',') ? result.split(',')[1] : result;
                      resolve(base64);
                    };
                    reader.onerror = () => reject(new Error('Failed to read sliced PDF chunk'));
                    reader.readAsDataURL(new Blob([subPdfBytes as any], { type: 'application/pdf' }));
                  });

                  const chunkRes = await fetchWithAuth('/api/v1/documents/parse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      fileData: base64Data,
                      fileName: `chunk_${chunkIdx}_${file.name}`,
                      mimeType: 'application/pdf',
                      engine:
                        parsingEngine === 'mistral_ocr'
                          ? 'mistral'
                          : parsingEngine === 'unstructured_mcp'
                            ? 'unstructured'
                            : 'auto',
                      pagesPerChunk: pagesPerChunk,
                      maxFileSizeMb: currentMaxFileSizeMb,
                    }),
                  });

                  if (!chunkRes.ok) {
                    let chunkErr = `Failed parsing chunk ${chunkIdx}`;
                    try {
                      const errJson = await chunkRes.json();
                      chunkErr = errJson.error || chunkErr;
                    } catch (e) {
                      const errText = await chunkRes.text();
                      chunkErr = errText || chunkErr;
                    }
                    throw new Error(chunkErr);
                  }

                  const chunkData = await chunkRes.json();
                  if (chunkData.text && chunkData.text.trim().length > 0) {
                    chunkTexts.push(chunkData.text.trim());
                  }
                }

                // Successfully parsed all chunks!
                finalExtractedText = chunkTexts.join('\n\n');
                finalTotalPages = totalPages;
                finalChunksProcessed = totalChunks;
                finalEngineUsed =
                  (parsingEngine === 'mistral_ocr' ? 'Mistral Document AI' : 'Unstructured.io MCP') +
                  ' (Client-Side Sliced ⚡)';
                fileHashForOcr = 'sliced-' + file.name + '-' + file.size + '-' + totalPages;

                // Construct a mock response to satisfy downstream flow
                res = {
                  ok: true,
                  status: 200,
                  json: async () => ({
                    text: finalExtractedText,
                    totalPages: finalTotalPages,
                    chunksProcessed: finalChunksProcessed,
                    engineUsed: finalEngineUsed,
                    fileHash: fileHashForOcr,
                    isCacheHit: false,
                  }),
                } as Response;
              }
            } catch (slicingErr: any) {
              console.warn('[Client-Side Chunker] Slicing failed, falling back to full file upload:', slicingErr);
              // Fallback to normal upload
              res = null;
            }
          }

          if (!res) {
            // Fallback/Direct Upload Stage
            setParseProgress(35);
            setParseStage('upload');
            setParseStageText(
              lang === 'ar'
                ? `جاري رفع المستند (${(file.size / (1024 * 1024)).toFixed(2)} MB) إلى السيرفر...`
                : `Uploading document (${(file.size / (1024 * 1024)).toFixed(2)} MB)...`,
            );

            const formData = new FormData();
            formData.append('file', file);
            formData.append('fileName', file.name);
            formData.append('mimeType', file.type || 'application/octet-stream');
            formData.append(
              'engine',
              parsingEngine === 'mistral_ocr'
                ? 'mistral'
                : parsingEngine === 'unstructured_mcp'
                  ? 'unstructured'
                  : 'auto',
            );
            formData.append('pagesPerChunk', currentPagesPerChunk.toString());
            formData.append('maxFileSizeMb', currentMaxFileSizeMb.toString());

            // Progress to Extraction Stage
            setParseProgress(55);
            setParseStage('ocr');
            const isWord = file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc');
            const isAudioOrVideo =
              file.type.startsWith('audio/') ||
              file.type.startsWith('video/') ||
              /\.(mp3|wav|m4a|flac|mp4|mov|webm)$/i.test(file.name);

            setParseStageText(
              lang === 'ar'
                ? isWord
                  ? 'جاري استخراج وتنسيق محتوى ملف الوورد (DOCX) بأعلى دقة وترميز UTF-8 سليم...'
                  : isAudioOrVideo
                    ? 'جاري التفريغ الصوتي ومعالجة الوسائط عبر محرك Whisper...'
                    : `جاري معالجة المستند عبر محرك الذكاء الاصطناعي (تقطيع على دفعات من ${currentPagesPerChunk} صفحة)...`
                : isWord
                  ? 'Parsing & formatting Word document (DOCX) with clean UTF-8 Arabic encoding...'
                  : isAudioOrVideo
                    ? 'Transcribing audio/video stream via Whisper engine...'
                    : `Running AI Document Pipeline (batched in ${currentPagesPerChunk}-page chunks)...`,
            );

            res = await fetchWithAuth('/api/v1/documents/parse', {
              method: 'POST',
              body: formData,
            });

            // If FormData parsing failed, try JSON payload fallback (up to 50MB and if not a 413 limit error)
            if (!res.ok && file.size <= 50 * 1024 * 1024 && res.status !== 413) {
              console.warn('[DocumentIngestion] FormData endpoint returned non-OK, trying Base64 JSON fallback...');
              try {
                const base64Data = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve((reader.result as string) || '');
                  reader.onerror = (e) => reject(e);
                  reader.readAsDataURL(file);
                });

                if (base64Data) {
                  res = await fetchWithAuth('/api/v1/documents/parse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      fileData: base64Data,
                      fileName: file.name,
                      mimeType: file.type || 'application/octet-stream',
                      engine:
                        parsingEngine === 'mistral_ocr'
                          ? 'mistral'
                          : parsingEngine === 'unstructured_mcp'
                            ? 'unstructured'
                            : 'auto',
                      pagesPerChunk: currentPagesPerChunk,
                      maxFileSizeMb: currentMaxFileSizeMb,
                    }),
                  });
                }
              } catch (fallbackErr) {
                console.warn('[DocumentIngestion] Base64 JSON fallback attempt failed:', fallbackErr);
              }
            }
          }

          unregisterInterval(progressInterval);

          if (res.ok) {
            const data = await res.json();
            if (data.text && data.text.trim().length > 0) {
              setParseProgress(90);
              setParseStage('chunk');
              setParseStageText(
                lang === 'ar'
                  ? 'جاري تنسيق وسحب النصوص المحللة وتخزينها بالذاكرة المؤقتة...'
                  : 'Formatting markdown & saving OCR cache...',
              );

              setDocContent(data.text);
              setInputTab('text');
              const engineLabel =
                data.engineUsed || (parsingEngine === 'mistral_ocr' ? 'Mistral Document AI' : 'Unstructured.io MCP');

              // Save to Mistral OCR Cache using useDocumentCache hook
              await saveCache({
                cacheKey: data.fileHash || fileHash,
                fileName: file.name,
                fileSize: file.size,
                mimeType: file.type || 'application/pdf',
                engineUsed: engineLabel,
                extractedText: data.text,
                totalPages: data.totalPages || 1,
                chunksProcessed: data.chunksProcessed || 1,
                cachedAt: Date.now(),
                hits: data.isCacheHit ? 1 : 0,
              });

              setParseProgress(100);
              setParseStage('complete');

              setStatusMessage({
                type: 'success',
                text:
                  lang === 'ar'
                    ? `تم استخراج وتنسيق النصوص بنجاح (${data.totalPages || 1} صفحة، ${data.chunksProcessed || 1} دفعة مجزأة) وتم حفظها بالذاكرة المؤقتة لـ OCR!`
                    : `Text extracted successfully (${data.totalPages || 1} pages, ${data.chunksProcessed || 1} sliced batches) & cached for future OCR!`,
              });
            } else {
              setStatusMessage({
                type: 'error',
                text:
                  lang === 'ar'
                    ? 'لم يتم استخراج أي نص من الملف. يرجى التأكد من أن الملف غير فارغ ويحتوي على نصوص قابلة للقراءة.'
                    : 'No text could be extracted. Please ensure the file is not empty and contains readable text.',
              });
            }
          } else {
            let errorMsg = 'Failed to parse document';
            try {
              const contentType = res.headers.get('content-type');
              if (contentType && contentType.includes('application/json')) {
                const err = await res.json();
                errorMsg = err.error || errorMsg;
              } else {
                const textErr = await res.text();
                errorMsg = textErr || `Server returned status code ${res.status}`;
              }
            } catch (e) {
              errorMsg = `Server error ${res.status}`;
            }
            setStatusMessage({
              type: 'error',
              text: lang === 'ar' ? `فشل استخراج النص: ${errorMsg}` : `Extraction failed: ${errorMsg}`,
            });
          }
        } catch (error: any) {
          unregisterInterval(progressInterval);
          console.error('Error parsing file:', error);
          setStatusMessage({
            type: 'error',
            text: lang === 'ar' ? `فشل استخراج النص: ${error.message}` : `Extraction failed: ${error.message}`,
          });
        } finally {
          unregisterInterval(progressInterval);
          setIsParsingFile(false);
        }
      })();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  // Dynamic Live Chunk Calculation
  const generatedChunks = useMemo(() => {
    if (!docContent.trim()) return [];

    const charSize = Math.max(100, Math.floor(chunkSize * 2.5)); // Approx 2.5 chars per token for EN/AR
    const overlapChars = Math.floor(charSize * (chunkOverlap / 100));
    const step = Math.max(50, charSize - overlapChars);

    const result: { index: number; content: string; charCount: number; tokenEst: number }[] = [];
    let idx = 0;

    if (chunkStrategy === 'markdown') {
      // Split by headers
      const sections = docContent.split(/(?=\n#+ )/);
      sections.forEach((sec, i) => {
        if (sec.trim()) {
          result.push({
            index: i + 1,
            content: sec.trim(),
            charCount: sec.length,
            tokenEst: Math.round(sec.length / 2.8),
          });
        }
      });
    } else {
      // Character window sliding
      for (let i = 0; i < docContent.length; i += step) {
        const snippet = docContent.substring(i, i + charSize);
        if (snippet.trim()) {
          idx++;
          result.push({
            index: idx,
            content: snippet.trim(),
            charCount: snippet.length,
            tokenEst: Math.round(snippet.length / 2.8),
          });
        }
      }
    }

    return result;
  }, [docContent, chunkSize, chunkOverlap, chunkStrategy]);

  // Submit & Ingest Document
  const handleIngestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!docTitle.trim()) {
      setStatusMessage({
        type: 'error',
        text:
          lang === 'ar'
            ? 'عنوان المستند مطلوب قبل البدء برفع وفهرسة البيانات.'
            : 'Document title is required before starting ingestion.',
      });
      return;
    }

    if (!docContent.trim() || docContent.trim().length < 10) {
      if (inputTab === 'youtube') {
        const ytValidation = validateYoutubeUrl(youtubeUrl);
        if (!ytValidation.isValid) {
          setStatusMessage({
            type: 'error',
            text: lang === 'ar' ? ytValidation.errorAr! : ytValidation.errorEn!,
          });
          return;
        } else {
          setStatusMessage({
            type: 'error',
            text:
              lang === 'ar'
                ? 'يرجى النقر على زر "استخراج التفريغ" لجلب نص الفيديو قبل المتابعة.'
                : 'Please click "Extract Transcript" to retrieve video text before proceeding.',
          });
          return;
        }
      }

      setStatusMessage({
        type: 'error',
        text:
          lang === 'ar'
            ? 'محتوى المستند فارغ أو قصير جداً (أقل من 10 أحرف). يرجى تقديم محتوى نصي صالح للفهرسة.'
            : 'Document content is empty or too short (less than 10 characters). Please provide valid text content for indexing.',
      });
      return;
    }

    setIsUploading(true);
    setStatusMessage(null);

    // Initialize progress tracking
    const activeSteps: IngestionProgressStep[] = INITIAL_STEPS.map((step) => ({
      ...step,
      status: 'pending',
      progress: 0,
    }));
    setSteps(activeSteps);
    setOverallProgress(0);
    const startTime = Date.now();
    uploadStartedAtRef.current = startTime;

    const intervalId = registerInterval(
      setInterval(() => {
        const elapsedMs = Date.now() - startTime;

        setSteps((prevSteps) => {
          if (prevSteps.length === 0) return prevSteps;

          // Find current step that is processing or first pending
          const currentIdx = prevSteps.findIndex((s) => s.status === 'processing' || s.status === 'pending');
          if (currentIdx === -1) return prevSteps;

          const updated = [...prevSteps];
          const step = { ...updated[currentIdx] };

          if (step.status === 'pending') {
            step.status = 'processing';
          }

          // Increment progress: deterministic per-tick step (no random jitter).
          // Was `0.8 + Math.random() * 0.4`; a constant 1.0 keeps the stepper
          // linear and removes the Math.random call. UI animation only.
          const tickProgress = 100 / (step.durationMs / 100);
          step.progress = Math.min(100, step.progress + tickProgress);

          // If step is done, move to next
          if (step.progress >= 100) {
            if (currentIdx < prevSteps.length - 1) {
              step.status = 'completed';
              step.progress = 100;
              // set next step to processing
              const nextStep = { ...updated[currentIdx + 1] };
              nextStep.status = 'processing';
              nextStep.progress = 0;
              updated[currentIdx + 1] = nextStep;
            } else {
              // Cap last step at 95% until real API responds
              step.progress = 95;
            }
          }

          updated[currentIdx] = step;

          // Calculate overall progress
          const totalP = updated.reduce((sum, s) => sum + s.progress, 0) / updated.length;
          setOverallProgress(Math.round(totalP));

          return updated;
        });
      }, 100),
    );

    try {
      let determinedSourceType: string = 'file';
      let sourceConfig: Record<string, any> = {};

      if (inputTab === 'youtube') {
        determinedSourceType = 'youtube';
        sourceConfig = {
          url: youtubeUrl,
          channel: youtubeVideoMeta?.channel,
          duration: youtubeVideoMeta?.duration,
          thumbnail: youtubeVideoMeta?.thumbnail,
        };
      } else if (selectedFileName?.toLowerCase().endsWith('.pdf')) {
        determinedSourceType = 'pdf';
        sourceConfig = { fileName: selectedFileName, fileSize: fileSizeStr };
      } else if (inputTab === 'text') {
        determinedSourceType = 'text';
      } else if (inputTab === 'sample') {
        determinedSourceType = 'sample';
      } else if (selectedFileName) {
        determinedSourceType = 'file';
        sourceConfig = { fileName: selectedFileName, fileSize: fileSizeStr };
      }

      const res = await fetchWithAuth('/api/v1/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          title: docTitle,
          content: docContent,
          sourceType: determinedSourceType,
          sourceConfig,
          language: 'ar',
          collectionIds: selectedColIds,
          chunkingConfig: {
            strategy: chunkStrategy,
            size: chunkSize,
            overlap: chunkOverlap,
          },
        }),
      });

      unregisterInterval(intervalId);

      if (res.ok) {
        const data = await res.json();

        // The API now reports the REAL indexing outcome: HTTP 201 with
        // `success: false` means the document was saved but vector indexing
        // failed (e.g. Qdrant down). Surface that honestly instead of
        // celebrating a full success.
        const indexingFailed = data?.success === false;

        // Fast-forward animation to completed
        setSteps((prev) =>
          prev.map((s) => ({
            ...s,
            status: indexingFailed && s.status === 'processing' ? 'error' : 'completed',
            progress: 100,
          })),
        );
        setOverallProgress(100);

        const createdSourceId =
          data.source?.id ||
          data.document?.metadata?.sourceId ||
          `src-${determinedSourceType}-${Date.now().toString().slice(-6)}`;
        const createdSourceName = data.source?.name || docTitle || 'المستند المرفوع';
        const createdChunkCount = data.document?.chunkCount || generatedChunks.length || 1;

        setCompletionData({
          sourceId: createdSourceId,
          sourceName: createdSourceName,
          chunkCount: createdChunkCount,
          documentId: data.document?.id || '',
          sourceType: determinedSourceType,
        });

        setStatusMessage(
          indexingFailed
            ? {
                type: 'error',
                text:
                  lang === 'ar'
                    ? `تم حفظ المستند لكن الفهرسة المتجهية فشلت: ${data?.indexing?.errors?.join('؛ ') || 'خطأ غير معروف'} — يمكنك إعادة الفهرسة من بطاقة المستند`
                    : `Document saved but vector indexing failed: ${data?.indexing?.errors?.join('; ') || 'unknown error'} — you can reindex from the document card`,
              }
            : {
                type: 'success',
                text:
                  lang === 'ar'
                    ? `تم حفظ الموصل واستيعاب المستند بنجاح! (${createdChunkCount} مقطع دلالي مفهرس)`
                    : 'Document and source connector saved successfully!',
              },
        );

        onIngestionCompleted(createdSourceId);
      } else {
        // Set currently active step to error
        setSteps((prev) =>
          prev.map((s) => {
            if (s.status === 'processing') {
              return { ...s, status: 'error' };
            }
            return s;
          }),
        );
        const err = await res.json().catch(() => ({}));
        setStatusMessage({ type: 'error', text: err.error || 'Failed to ingest document' });
      }
    } catch (err: any) {
      unregisterInterval(intervalId);
      setSteps((prev) =>
        prev.map((s) => {
          if (s.status === 'processing') {
            return { ...s, status: 'error' };
          }
          return s;
        }),
      );
      setStatusMessage({ type: 'error', text: err.message || 'Ingestion request failed' });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-md space-y-6">
      {/* 0. Persistent Success Confirmation Card */}
      {completionData && (
        <div className="bg-emerald-50/90 border border-emerald-200 rounded-3xl p-5 space-y-4 shadow-sm animate-fadeIn">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-700 border border-emerald-200 shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-emerald-950">
                  {lang === 'ar'
                    ? 'تم حفظ موصل البيانات وفهرسة المتجهات بنجاح!'
                    : 'Source Connector Saved & Vectors Indexed!'}
                </h3>
                <p className="text-xs text-emerald-700 mt-0.5">
                  {lang === 'ar'
                    ? 'تم تسجيل المصدر في قاعدة البيانات وتجزئة المحتوى وتخزين المتجهات بنجاح.'
                    : 'The source connector has been saved to the database, chunked, and indexed.'}
                </p>
              </div>
            </div>
            <span className="text-[9px] font-mono font-bold bg-emerald-200 text-emerald-900 px-2.5 py-0.5 rounded-full uppercase tracking-wider shrink-0">
              {lang === 'ar' ? 'محفوظ وفاعل' : 'SAVED & ACTIVE'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white/90 p-3 rounded-2xl border border-emerald-100 text-xs">
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block">
                {lang === 'ar' ? 'اسم المصدر' : 'Source Name'}
              </span>
              <span className="font-bold text-slate-800 line-clamp-1">{completionData.sourceName}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block">
                {lang === 'ar' ? 'عدد المقاطع' : 'Indexed Chunks'}
              </span>
              <span className="font-bold text-indigo-600">
                {completionData.chunkCount} {lang === 'ar' ? 'مقطع دلالي' : 'chunks'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block">
                {lang === 'ar' ? 'معرّف الموصل' : 'Source ID'}
              </span>
              <span className="font-mono text-slate-600 text-[11px]">{completionData.sourceId}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => onNavigateTab?.('connectors')}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
            >
              <Database className="w-3.5 h-3.5" />
              <span>{lang === 'ar' ? 'عرض المصدر في الموصلات' : 'View in Connectors'}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab?.('documents')}
              className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
            >
              <Layers className="w-3.5 h-3.5 text-indigo-600" />
              <span>{lang === 'ar' ? 'استعراض مقاطع Qdrant' : 'Inspect Qdrant Vectors'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setCompletionData(null);
                setDocTitle('');
                setDocContent('');
                setSelectedFileName(null);
                setSteps(INITIAL_STEPS);
                setStatusMessage(null);
              }}
              className="px-3.5 py-2 bg-emerald-100 text-emerald-900 hover:bg-emerald-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border border-emerald-200"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{lang === 'ar' ? 'استيعاب مصدر جديد' : 'Ingest Another Source'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <Upload className="w-5 h-5 text-indigo-600" />
            <span>
              {lang === 'ar'
                ? 'استوديو رفع وتجزئة المستندات المتقدم (Document Ingestion Studio)'
                : 'Document Ingestion Studio'}
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {lang === 'ar'
              ? 'رفع ملفات PDF، Word، Markdown، وشفرات البرمجة مع المعاينة المباشرة لتجزئة المقاطع الدلالية'
              : 'Drag & drop real PDF, DOCX, TXT, MD, & code files with live chunking visualization'}
          </p>
        </div>

        {/* Input Method Selector Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl flex-wrap">
          <button
            type="button"
            onClick={() => setInputTab('upload')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              inputTab === 'upload' ? 'bg-white text-indigo-600 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{lang === 'ar' ? 'رفع ملف' : 'Upload File'}</span>
          </button>

          <button
            type="button"
            onClick={() => setInputTab('youtube')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              inputTab === 'youtube' ? 'bg-white text-rose-600 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MonitorPlay className="w-3.5 h-3.5 text-rose-600" />
            <span>{lang === 'ar' ? 'فيديو يوتيوب' : 'YouTube Video'}</span>
          </button>

          <button
            type="button"
            onClick={() => setInputTab('text')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              inputTab === 'text' ? 'bg-white text-indigo-600 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{lang === 'ar' ? 'محرر النص' : 'Text Editor'}</span>
          </button>

          <button
            type="button"
            onClick={() => setInputTab('sample')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              inputTab === 'sample' ? 'bg-white text-indigo-600 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>{lang === 'ar' ? 'نماذج جاهزة' : 'Sample Presets'}</span>
          </button>
        </div>
      </div>

      <form onSubmit={handleIngestSubmit} className="space-y-5">
        {/* TAB 1: DRAG & DROP FILE ZONE */}
        {inputTab === 'upload' &&
          (isParsingFile ? (
            <div className="border-2 border-indigo-500/80 bg-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl space-y-5 relative overflow-hidden">
              {/* Background Shimmer Glow */}
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 via-amber-500/10 to-emerald-500/10 animate-pulse pointer-events-none" />

              {/* Progress Card Top Header */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 relative z-10">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-indigo-500/20 border border-indigo-400/40 text-indigo-400 flex items-center justify-center shrink-0">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                      <span>{lang === 'ar' ? 'جاري رفع وتحليل المستند' : 'Uploading & Parsing Document'}</span>
                      <span className="text-[10px] bg-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded-full font-mono font-bold border border-indigo-400/30">
                        {selectedFileName || 'Document'}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5 font-mono">
                      {parseStageText ||
                        (lang === 'ar' ? 'جاري تنفيذ المعالجة الدلالية...' : 'Executing semantic processing...')}
                    </p>
                  </div>
                </div>

                {/* Badges and Time Ticker */}
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto font-mono text-xs">
                  <span className="bg-slate-800 text-slate-300 px-2.5 py-1 rounded-xl border border-slate-700 text-[11px] font-bold flex items-center gap-1">
                    <Clock className="w-3 h-3 text-amber-400" />
                    <span>⏱️ {(parseElapsedMs / 1000).toFixed(1)}s</span>
                  </span>
                  <span className="bg-indigo-950 text-indigo-300 px-2.5 py-1 rounded-xl border border-indigo-800 text-[11px] font-bold">
                    {getIngestionSettings().pagesPerChunk} {lang === 'ar' ? 'صفحة/دفعة' : 'pages/chunk'}
                  </span>
                </div>
              </div>

              {/* Animated Progress Bar */}
              <div className="space-y-2 relative z-10">
                <div className="flex justify-between items-center text-xs font-mono font-bold">
                  <span className="text-indigo-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                    <span>
                      {parseStage === 'hash'
                        ? lang === 'ar'
                          ? '1. فحص الكاش SHA-256'
                          : '1. SHA-256 Cache Check'
                        : parseStage === 'upload'
                          ? lang === 'ar'
                            ? '2. رفع البيانات للسيرفر'
                            : '2. File Uploading'
                          : parseStage === 'ocr'
                            ? lang === 'ar'
                              ? '3. معالجة OCR بالتعديد'
                              : '3. Mistral OCR Batching'
                            : parseStage === 'chunk'
                              ? lang === 'ar'
                                ? '4. تنسيق وهيكلة Markdown'
                                : '4. Markdown Formatting'
                              : lang === 'ar'
                                ? '5. اكتملت المعالجة'
                                : '5. Processing Complete'}
                    </span>
                  </span>
                  <span className="text-amber-400 font-extrabold text-sm">{parseProgress}%</span>
                </div>

                <div className="w-full h-3.5 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700/80 shadow-inner">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-300 ease-out shadow-sm"
                    style={{ width: `${Math.min(100, Math.max(5, parseProgress))}%` }}
                  />
                </div>
              </div>

              {/* Progress Steps Checklist */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-slate-800 text-[11px] font-mono relative z-10">
                <div
                  className={`p-2 rounded-xl border flex items-center gap-2 ${parseProgress >= 10 ? 'bg-indigo-950/60 border-indigo-800 text-indigo-300' : 'bg-slate-950/40 border-slate-800/80 text-slate-500'}`}
                >
                  <CheckCircle2
                    className={`w-3.5 h-3.5 ${parseProgress >= 10 ? 'text-emerald-400' : 'text-slate-600'}`}
                  />
                  <span className="truncate">{lang === 'ar' ? 'فحص الكاش' : 'Cache Check'}</span>
                </div>

                <div
                  className={`p-2 rounded-xl border flex items-center gap-2 ${parseProgress >= 35 ? 'bg-indigo-950/60 border-indigo-800 text-indigo-300' : 'bg-slate-950/40 border-slate-800/80 text-slate-500'}`}
                >
                  <CheckCircle2
                    className={`w-3.5 h-3.5 ${parseProgress >= 35 ? 'text-emerald-400' : 'text-slate-600'}`}
                  />
                  <span className="truncate">{lang === 'ar' ? 'رفع المستند' : 'File Upload'}</span>
                </div>

                <div
                  className={`p-2 rounded-xl border flex items-center gap-2 ${parseProgress >= 55 ? 'bg-indigo-950/60 border-indigo-800 text-indigo-300' : 'bg-slate-950/40 border-slate-800/80 text-slate-500'}`}
                >
                  <CheckCircle2
                    className={`w-3.5 h-3.5 ${parseProgress >= 55 ? 'text-emerald-400' : 'text-slate-600'}`}
                  />
                  <span className="truncate">{lang === 'ar' ? 'استخراج OCR' : 'Mistral OCR'}</span>
                </div>

                <div
                  className={`p-2 rounded-xl border flex items-center gap-2 ${parseProgress >= 90 ? 'bg-indigo-950/60 border-indigo-800 text-indigo-300' : 'bg-slate-950/40 border-slate-800/80 text-slate-500'}`}
                >
                  <CheckCircle2
                    className={`w-3.5 h-3.5 ${parseProgress >= 90 ? 'text-emerald-400' : 'text-slate-600'}`}
                  />
                  <span className="truncate">{lang === 'ar' ? 'حفظ الكاش' : 'Cache Store'}</span>
                </div>
              </div>
            </div>
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-3xl p-8 text-center transition cursor-pointer flex flex-col items-center justify-center space-y-3 ${
                dragOver
                  ? 'border-indigo-500 bg-indigo-50/60 scale-[0.99]'
                  : 'border-slate-300 hover:border-indigo-400 bg-slate-50/50 hover:bg-slate-50'
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => e.target.files?.[0] && handleFileProcess(e.target.files[0])}
                accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.txt,.md,.json,.csv,.py,.ts,.js,.html,.xml,.png,.jpg,.jpeg,.webp,.gif,.bmp,.mp3,.wav,.webm,.ogg,.aac,.flac,.mp4,.mov,.avi"
                className="hidden"
              />
              <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center shadow-xs">
                <Upload className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  {lang === 'ar'
                    ? 'اسحب واسقط الملف هنا أو انقر للاستعراض'
                    : 'Drag & drop file here or click to browse'}
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  {lang === 'ar'
                    ? `يدعم مستندات PDF/Office، جداول وعروض PPTX/XLSX، الصور، الأصوات، والفيديو حتى ${getIngestionSettings().maxFileSizeMb}MB`
                    : `Supports PDF, Office, PPTX, XLSX, Images, Audio, Video up to ${getIngestionSettings().maxFileSizeMb} MB`}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5 text-[10px] font-mono font-bold text-slate-400 pt-2 max-w-lg">
                <span className="bg-white px-2 py-0.5 rounded border border-slate-200">.PDF</span>
                <span className="bg-white px-2 py-0.5 rounded border border-slate-200">.DOCX</span>
                <span className="bg-white px-2 py-0.5 rounded border border-slate-200">.PPTX</span>
                <span className="bg-white px-2 py-0.5 rounded border border-slate-200">.XLSX</span>
                <span className="bg-white px-2 py-0.5 rounded border border-slate-200">الصور</span>
                <span className="bg-white px-2 py-0.5 rounded border border-slate-200">الأصوات</span>
                <span className="bg-white px-2 py-0.5 rounded border border-slate-200">الفيديو</span>
              </div>
            </div>
          ))}

        {/* TAB 2: YOUTUBE VIDEO TRANSCRIPT EXTRACTOR */}
        {inputTab === 'youtube' && (
          <div className="p-6 bg-slate-50/80 rounded-3xl border border-rose-100/80 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
                <MonitorPlay className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  {lang === 'ar'
                    ? 'استخراج تفريغ فيديو يوتيوب (YouTube Video Transcript)'
                    : 'YouTube Video Transcript Extractor'}
                </h3>
                <p className="text-xs text-slate-500">
                  {lang === 'ar'
                    ? 'أدخل رابط أي فيديو يوتيوب لاستخراج النص كاملاً مع الطوابع الزمنية وتحويله لمتجهات دلالية'
                    : 'Paste any YouTube video link to extract transcripts, timestamps, and index vector chunks'}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder={
                  lang === 'ar'
                    ? 'ضع رابط فيديو يوتيوب هنا، مثلاً: https://www.youtube.com/watch?v=...'
                    : 'Paste YouTube video URL e.g. https://www.youtube.com/watch?v=...'
                }
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:border-rose-500 text-xs bg-white text-slate-900"
              />
              <button
                type="button"
                onClick={handleExtractYoutubeTranscript}
                disabled={isExtractingYoutube || !youtubeUrl.trim()}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-xs shrink-0"
              >
                {isExtractingYoutube ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{lang === 'ar' ? 'جاري استخراج التفريغ...' : 'Extracting Transcript...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-rose-200" />
                    <span>{lang === 'ar' ? 'استخراج وحفظ التفريغ' : 'Extract Transcript'}</span>
                  </>
                )}
              </button>
            </div>

            {/* Live YouTube URL Structure Validation Indicator */}
            {youtubeUrl.trim().length > 0 && (
              <div className="pt-1">
                {(() => {
                  const check = validateYoutubeUrl(youtubeUrl);
                  if (check.isValid) {
                    return (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>
                          {lang === 'ar'
                            ? `رابط يوتيوب صحيح ومكتمل (معرّف الفيديو: ${check.videoId})`
                            : `Valid YouTube URL structure (Video ID: ${check.videoId})`}
                        </span>
                      </div>
                    );
                  } else {
                    return (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-medium">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                        <span>{lang === 'ar' ? check.errorAr : check.errorEn}</span>
                      </div>
                    );
                  }
                })()}
              </div>
            )}

            {/* Video Preview Card if extracted */}
            {youtubeVideoMeta && (
              <div className="p-3.5 bg-white rounded-2xl border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center gap-3.5 shadow-3xs">
                <img
                  src={youtubeVideoMeta.thumbnail}
                  alt={youtubeVideoMeta.title}
                  className="w-28 h-18 object-cover rounded-xl border border-slate-100 shrink-0"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 inline-block">
                      {youtubeVideoMeta.channel}
                    </span>
                    {youtubeVideoMeta.method && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-100/80 inline-flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-violet-500" />
                        <span>{youtubeVideoMeta.method}</span>
                      </span>
                    )}
                  </div>
                  <h4 className="text-xs font-extrabold text-slate-900 truncate">{youtubeVideoMeta.title}</h4>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono">
                    <span>⏱ {youtubeVideoMeta.duration}</span>
                    <span>📝 {youtubeVideoMeta.wordCount} كلمة</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: SAMPLE PRESET DOCUMENTS */}
        {inputTab === 'sample' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {SAMPLE_DOCS.map((sample) => (
              <div
                key={sample.id}
                onClick={() => handleSelectSample(sample)}
                className="p-4 bg-slate-50 hover:bg-indigo-50/70 rounded-2xl border border-slate-200 hover:border-indigo-300 transition cursor-pointer space-y-2 group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                    {sample.category}
                  </span>
                  <Zap className="w-4 h-4 text-amber-500 group-hover:scale-110 transition" />
                </div>
                <h4 className="text-xs font-bold text-slate-900 leading-snug group-hover:text-indigo-900">
                  {sample.title}
                </h4>
                <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                  {sample.content.slice(0, 90)}...
                </p>
              </div>
            ))}
          </div>
        )}

        {/* DOCUMENT TITLE & FILE INFO */}
        <div className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="w-full">
              <label className="text-xs font-bold text-slate-700 block mb-1">
                {lang === 'ar' ? 'عنوان المستند المفهرس:' : 'Document Title:'}
              </label>
              <input
                type="text"
                required
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder={lang === 'ar' ? 'مثال: سياسة حماية البيانات 2026' : 'e.g. Data Protection Policy 2026'}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            {selectedFileName && (
              <div className="shrink-0 p-2.5 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center gap-2 text-xs text-indigo-900 font-medium">
                <FileCheck className="w-4 h-4 text-indigo-600" />
                <span className="font-bold truncate max-w-48">{selectedFileName}</span>
                <span className="text-[10px] text-indigo-500 font-mono">({fileSizeStr})</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFileName(null);
                    setDocContent('');
                  }}
                  className="p-1 hover:bg-indigo-100 rounded text-indigo-600 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1 flex items-center justify-between">
              <span>{lang === 'ar' ? 'محتوى النص الكامل للمستند:' : 'Document Full Text Content:'}</span>
              <span className="text-[10px] font-mono text-slate-400">
                {docContent.length} chars | ~{Math.round(docContent.length / 2.8)} est. tokens
              </span>
            </label>
            <textarea
              required
              rows={6}
              value={docContent}
              onChange={(e) => setDocContent(e.target.value)}
              placeholder={
                lang === 'ar'
                  ? 'الصق النص كاملاً هنا أو اختر ملفاً أعلاه...'
                  : 'Paste full document text here or upload file above...'
              }
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* INTERACTIVE CHUNKING CONFIGURATION & LIVE SIMULATOR */}
        <div className="bg-slate-900 text-slate-100 p-5 rounded-2xl space-y-5 border border-slate-800 shadow-inner">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Scissors className="w-4 h-4 text-indigo-400" />
              <h3 className="text-xs font-extrabold text-white">
                {lang === 'ar' ? 'محاكي التقطيع الدلالي الفوري (Live Chunking Visualizer)' : 'Live Chunking Visualizer'}
              </h3>
            </div>

            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-slate-400">{lang === 'ar' ? 'عدد المقاطع:' : 'Total Chunks:'}</span>
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500 text-white font-bold text-xs">
                {generatedChunks.length} Chunks
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            {/* AI Document Parsing Engine */}
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1 flex items-center justify-between">
                <span>{lang === 'ar' ? 'محرك استخراج الملفات والصور:' : 'Document Extraction Engine:'}</span>
                <span className="text-[9px] font-mono text-amber-400 font-bold bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800">
                  AI OCR
                </span>
              </label>
              <select
                value={parsingEngine}
                onChange={(e) => setParsingEngine(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 cursor-pointer font-sans"
              >
                <option value="mistral_ocr">
                  {lang === 'ar' ? 'Mistral Document AI (OCR + Visual Layout)' : 'Mistral Document AI (OCR + Visual)'}
                </option>
                <option value="unstructured_mcp">
                  {lang === 'ar' ? 'Unstructured API / MCP Transform' : 'Unstructured API / MCP Transform'}
                </option>
                <option value="pdf_layout">
                  {lang === 'ar' ? 'Native PDF Layout Parser' : 'Native PDF Layout Parser'}
                </option>
                <option value="native_ast">
                  {lang === 'ar' ? 'Code AST & Structure Extraction' : 'Code AST & Structure Extraction'}
                </option>
              </select>
            </div>

            {/* Strategy */}
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">
                {lang === 'ar' ? 'استراتيجية التقطيع (Strategy):' : 'Chunking Strategy:'}
              </label>
              <select
                value={chunkStrategy}
                onChange={(e) => setChunkStrategy(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="semantic">{lang === 'ar' ? 'تقطيع دلالي ذكي (Semantic)' : 'Semantic Boundaries'}</option>
                <option value="markdown">
                  {lang === 'ar' ? 'تقسيم الترويسات (Markdown Headings)' : 'Markdown Headings'}
                </option>
                <option value="recursive">
                  {lang === 'ar' ? 'تقسيم تكراري بالفواصل (Recursive)' : 'Recursive Splitting'}
                </option>
              </select>
            </div>

            {/* Chunk Size */}
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1 flex justify-between">
                <span>{lang === 'ar' ? 'حجم المقطع (Chunk Size):' : 'Chunk Size:'}</span>
                <span className="text-indigo-400 font-mono font-bold">{chunkSize} tokens</span>
              </label>
              <input
                type="range"
                min={128}
                max={2048}
                step={64}
                value={chunkSize}
                onChange={(e) => setChunkSize(Number(e.target.value))}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-slate-500 font-mono mt-0.5">
                <span>128</span>
                <span>512</span>
                <span>1024</span>
                <span>2048</span>
              </div>
            </div>

            {/* Overlap */}
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1 flex justify-between">
                <span>{lang === 'ar' ? 'نسبة التداخل (Overlap):' : 'Overlap Ratio:'}</span>
                <span className="text-indigo-400 font-mono font-bold">{chunkOverlap}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={50}
                step={5}
                value={chunkOverlap}
                onChange={(e) => setChunkOverlap(Number(e.target.value))}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-slate-500 font-mono mt-0.5">
                <span>0%</span>
                <span>20%</span>
                <span>50%</span>
              </div>
            </div>
          </div>

          {/* Target Collection Option */}
          {collections.length > 0 && (
            <div className="pt-2 border-t border-slate-800">
              <label className="text-[11px] font-bold text-slate-300 block mb-2">
                {lang === 'ar' ? 'ربط بالمجموعات المعرفية المستهدفة:' : 'Target Collections:'}
              </label>
              <div className="border border-slate-700 bg-slate-900 rounded-xl p-2 max-h-32 overflow-y-auto space-y-1">
                {collections.map((c) => {
                  const isChecked = selectedColIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer p-1.5 rounded hover:bg-slate-800 transition"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedColIds([...selectedColIds, c.id]);
                          } else {
                            setSelectedColIds(selectedColIds.filter((id) => id !== c.id));
                          }
                        }}
                        className="rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
                      />
                      <span className="truncate">{c.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* VISUAL CHUNKS PREVIEW CARDS */}
          {generatedChunks.length > 0 && (
            <div className="space-y-2.5 pt-2 border-t border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 block">
                {lang === 'ar' ? 'معاينة المقاطع الناتجة من الاستراتيجية الحالية:' : 'Live Generated Chunks Preview:'}
              </span>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-56 overflow-y-auto pr-1">
                {generatedChunks.slice(0, 6).map((chk) => (
                  <div
                    key={chk.index}
                    className="p-3 rounded-xl bg-slate-850 border border-slate-800 space-y-1.5 text-xs font-mono"
                  >
                    <div className="flex items-center justify-between text-[10px] border-b border-slate-800 pb-1">
                      <span className="px-2 py-0.5 rounded bg-indigo-900/80 text-indigo-300 font-bold">
                        Chunk #{chk.index}
                      </span>
                      <span className="text-slate-400">
                        {chk.charCount} chars | ~{chk.tokenEst} tokens
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 line-clamp-3 leading-relaxed font-sans">{chk.content}</p>
                    <div className="text-[9px] text-slate-500 truncate">
                      {/* Honest placeholder: embeddings are generated server-side
                          during indexing, so no vector values exist at preview
                          time. The old UI printed fabricated numbers here. */}
                      {lang === 'ar'
                        ? 'التضمين المتجهي (3072d) يُولَّد عند الفهرسة'
                        : 'Embedding (3072d) generated at index time'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* LIVE MULTI-STEP PROGRESS DASHBOARD */}
        {isUploading && steps.length > 0 && (
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 animate-fadeIn">
            {/* Header: Overall Progress & Estimated Time */}
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
                  <span>
                    {lang === 'ar' ? 'جاري معالجة وفهرسة المستند في نظام RAG...' : 'Processing & Indexing Document...'}
                  </span>
                </h4>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {lang === 'ar'
                    ? `الزمن المنقضي: ${Math.round((Date.now() - uploadStartedAtRef.current) / 1000)} ثانية`
                    : `Elapsed: ${Math.round((Date.now() - uploadStartedAtRef.current) / 1000)}s`}
                </p>
              </div>
              <span className="text-sm font-black text-indigo-400 font-mono">{overallProgress}%</span>
            </div>

            {/* Overall Progress Bar */}
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-indigo-500 h-full rounded-full transition-all duration-300 ease-out"
                style={{ width: `${overallProgress}%` }}
              />
            </div>

            {/* Individual Steps list */}
            <div className="space-y-3 pt-2">
              {steps.map((step) => {
                const isActive = step.status === 'processing';
                const isCompleted = step.status === 'completed';
                const isError = step.status === 'error';

                return (
                  <div
                    key={step.id}
                    className={`p-3 rounded-xl border transition-all duration-300 ${
                      isActive
                        ? 'bg-slate-850 border-indigo-500/50 shadow-indigo-950/20 shadow-sm'
                        : isCompleted
                          ? 'bg-slate-900/50 border-slate-800 opacity-75'
                          : isError
                            ? 'bg-rose-950/20 border-rose-900/50'
                            : 'bg-slate-900/25 border-slate-800 opacity-40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        {/* Status Icon */}
                        <div className="mt-0.5 shrink-0">
                          {isCompleted ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : isActive ? (
                            <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                          ) : isError ? (
                            <AlertCircle className="w-4 h-4 text-rose-400" />
                          ) : (
                            <Clock className="w-4 h-4 text-slate-500" />
                          )}
                        </div>

                        {/* Labels */}
                        <div>
                          <span
                            className={`text-xs font-bold block ${
                              isActive
                                ? 'text-indigo-300'
                                : isCompleted
                                  ? 'text-slate-300'
                                  : isError
                                    ? 'text-rose-300'
                                    : 'text-slate-400'
                            }`}
                          >
                            {lang === 'ar' ? step.nameAr : step.nameEn}
                          </span>
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            {lang === 'ar' ? step.descAr : step.descEn}
                          </span>
                        </div>
                      </div>

                      {/* Step progress % */}
                      {isActive && (
                        <span className="text-[10px] font-bold text-indigo-400 font-mono">
                          {Math.round(step.progress)}%
                        </span>
                      )}
                    </div>

                    {/* Step individual miniature progress bar */}
                    {isActive && (
                      <div className="w-full bg-slate-850 h-1 rounded-full mt-2 overflow-hidden">
                        <div
                          className="bg-indigo-400 h-full rounded-full transition-all duration-150"
                          style={{ width: `${step.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {statusMessage && (
          <div
            className={`p-3.5 rounded-2xl text-xs font-bold flex items-center gap-2 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                : 'bg-rose-50 text-rose-900 border border-rose-200'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* SUBMIT BUTTON */}
        <button
          type="submit"
          disabled={isUploading || !docTitle || !docContent}
          className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{lang === 'ar' ? 'جاري التقطيع وتوليد متجهات Qdrant...' : 'Ingesting & Indexing Chunks...'}</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>
                {lang === 'ar'
                  ? `استيعاب وتجزئة المستند (${generatedChunks.length} مقطع) وفهرسته فوراً`
                  : `Ingest & Vector Index Document (${generatedChunks.length} chunks)`}
              </span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}
