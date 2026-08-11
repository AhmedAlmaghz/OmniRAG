'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Collection } from '@/lib/types/omnirag';
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
  Youtube,
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
  onIngestionCompleted: () => void;
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

export function DocumentIngestionStudio({
  tenantId,
  collections,
  lang,
  onIngestionCompleted,
  initialTab = 'upload',
}: DocumentIngestionStudioProps) {
  const [inputTab, setInputTab] = useState<'upload' | 'youtube' | 'text' | 'sample'>(initialTab);

  useEffect(() => {
    if (initialTab) {
      setInputTab(initialTab);
    }
  }, [initialTab]);
  
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
  } | null>(null);

  // Extract YouTube Transcript Handler
  const handleExtractYoutubeTranscript = async () => {
    if (!youtubeUrl.trim()) {
      setStatusMessage({
        type: 'error',
        text: lang === 'ar' ? 'يرجى أدخال رابط فيديو يوتيوب أولاً' : 'Please enter a valid YouTube Video URL',
      });
      return;
    }

    setIsExtractingYoutube(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/v1/youtube/transcript', {
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
        });

        setStatusMessage({
          type: 'success',
          text: lang === 'ar'
            ? `تم استخراج تفريغ الفيديو بنجاح (${data.wordCount} كلمة)! يمكنك الآن مراجعة النص وتقسيمه لمقاطع.`
            : `YouTube transcript extracted successfully (${data.wordCount} words)! Ready for chunking and vector indexing.`,
        });
      } else {
        throw new Error(data.error || 'فشل استخراج تفريغ الفيديو');
      }
    } catch (err: any) {
      console.error('YouTube transcript error:', err);
      setStatusMessage({
        type: 'error',
        text: lang === 'ar' ? `خطأ أثناء استخراج تفريغ الفيديو: ${err.message}` : `Extraction failed: ${err.message}`,
      });
    } finally {
      setIsExtractingYoutube(false);
    }
  };

  // Chunking & AI Parsing Controls
  const [parsingEngine, setParsingEngine] = useState<'mistral_ocr' | 'unstructured_mcp' | 'native_ast' | 'pdf_layout'>('mistral_ocr');
  const [chunkStrategy, setChunkStrategy] = useState<'semantic' | 'markdown' | 'code' | 'sliding'>('semantic');
  const [chunkSize, setChunkSize] = useState<number>(512);
  const [chunkOverlap, setChunkOverlap] = useState<number>(20);
  const [selectedColId, setSelectedColId] = useState<string>('');

  // Processing state
  const [isUploading, setIsUploading] = useState(false);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [steps, setSteps] = useState<IngestionProgressStep[]>([]);
  const [estimatedSecondsLeft, setEstimatedSecondsLeft] = useState<number>(8);
  const [overallProgress, setOverallProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load sample document
  const handleSelectSample = (sample: typeof SAMPLE_DOCS[0]) => {
    setDocTitle(sample.title);
    setDocContent(sample.content);
    setSelectedFileName(`${sample.id}.${sample.type}`);
    setFileSizeStr(`${(sample.content.length / 1024).toFixed(1)} KB`);
    setInputTab('text');
  };

  // Handle Real File Selection / Drag & Drop
  const handleFileProcess = async (file: File) => {
    if (!file) return;

    setSelectedFileName(file.name);
    setFileSizeStr(`${(file.size / 1024).toFixed(1)} KB`);
    if (!docTitle) {
      setDocTitle(file.name.replace(/\.[^/.]+$/, ''));
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isText = file.type.startsWith('text/') || 
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
      // Send to server-side Gemini PDF/Document parser
      setIsParsingFile(true);
      setStatusMessage(null);
      
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Data = e.target?.result as string;
        try {
          const res = await fetch('/api/v1/documents/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              fileData: base64Data,
              mimeType: file.type,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.text) {
              setDocContent(data.text);
              setInputTab('text');
              setStatusMessage({
                type: 'success',
                text: lang === 'ar' 
                  ? 'تم استخراج وتنسيق النصوص بنجاح باستخدام الذكاء الاصطناعي!' 
                  : 'Text extracted and formatted successfully using Gemini AI!',
              });
            } else {
              throw new Error(lang === 'ar' ? 'لم يتم استخراج أي نص من الملف.' : 'No text could be extracted.');
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
                if (res.status === 413 || textErr.includes('Payload Too Large') || textErr.includes('Request Entity Too Large')) {
                  errorMsg = lang === 'ar'
                    ? 'حجم الملف كبير جداً للاستخراج المباشر. يرجى محاولة تقسيم المستند أو استخدام ملف أصغر.'
                    : 'File is too large for parsing. Please try splitting the document or uploading a smaller file.';
                } else {
                  errorMsg = textErr || `Server returned status code ${res.status}`;
                }
              }
            } catch (e) {
              if (res.status === 413) {
                errorMsg = lang === 'ar'
                  ? 'حجم الملف كبير جداً للاستخراج المباشر. يرجى محاولة تقسيم المستند أو استخدام ملف أصغر.'
                  : 'File is too large for parsing. Please try splitting the document or uploading a smaller file.';
              } else {
                errorMsg = `Server error ${res.status}`;
              }
            }
            throw new Error(errorMsg);
          }
        } catch (error: any) {
          console.error('Error parsing file:', error);
          setStatusMessage({
            type: 'error',
            text: lang === 'ar' 
              ? `فشل استخراج النص: ${error.message}` 
              : `Extraction failed: ${error.message}`,
          });
        } finally {
          setIsParsingFile(false);
        }
      };
      reader.readAsDataURL(file);
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
    if (!docTitle.trim() || !docContent.trim()) {
      setStatusMessage({
        type: 'error',
        text: lang === 'ar' ? 'يرجى تقديم عنوان ومحتوى المستند أولاً' : 'Please provide document title & content',
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
    setEstimatedSecondsLeft(8);

    const totalDurationMs = INITIAL_STEPS.reduce((sum, s) => sum + s.durationMs, 0);
    const startTime = Date.now();

    const intervalId = setInterval(() => {
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

        // Increment progress dynamically
        const tickProgress = (100 / (step.durationMs / 100)) * (0.8 + Math.random() * 0.4);
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

        // Calculate remaining seconds
        const remSecs = Math.max(1, Math.round((totalDurationMs - elapsedMs) / 1000));
        setEstimatedSecondsLeft(remSecs);

        return updated;
      });
    }, 100);

    try {
      const res = await fetch('/api/v1/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          title: docTitle,
          content: docContent,
          sourceType: 'file',
          language: 'ar',
          collectionIds: selectedColId ? [selectedColId] : [],
          chunkingConfig: {
            strategy: chunkStrategy,
            size: chunkSize,
            overlap: chunkOverlap,
          },
        }),
      });

      clearInterval(intervalId);

      if (res.ok) {
        const data = await res.json();
        
        // Fast-forward animation to completed
        setSteps((prev) =>
          prev.map((s) => ({
            ...s,
            status: 'completed',
            progress: 100,
          }))
        );
        setOverallProgress(100);
        setEstimatedSecondsLeft(0);

        setStatusMessage({
          type: 'success',
          text: lang === 'ar'
            ? `تم استيعاب المستند وتجزئته بنجاح إلى ${data.document?.chunkCount || generatedChunks.length} مقطع في Qdrant!`
            : 'Document successfully ingested & chunked into Qdrant!',
        });
        setDocTitle('');
        setDocContent('');
        setSelectedFileName(null);
        onIngestionCompleted();
      } else {
        const err = await res.json();
        
        // Set currently active step to error
        setSteps((prev) =>
          prev.map((s) => {
            if (s.status === 'processing') {
              return { ...s, status: 'error' };
            }
            return s;
          })
        );
        setStatusMessage({ type: 'error', text: err.error || 'Failed to ingest document' });
      }
    } catch (err: any) {
      clearInterval(intervalId);
      setSteps((prev) =>
        prev.map((s) => {
          if (s.status === 'processing') {
            return { ...s, status: 'error' };
          }
          return s;
        })
      );
      setStatusMessage({ type: 'error', text: err.message || 'Ingestion request failed' });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-md space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <Upload className="w-5 h-5 text-indigo-600" />
            <span>{lang === 'ar' ? 'استوديو رفع وتجزئة المستندات المتقدم (Document Ingestion Studio)' : 'Document Ingestion Studio'}</span>
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
            <Youtube className="w-3.5 h-3.5 text-rose-600" />
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
        {inputTab === 'upload' && (
          isParsingFile ? (
            <div className="border-2 border-indigo-500 bg-indigo-50/50 rounded-3xl p-12 text-center flex flex-col items-center justify-center space-y-4 animate-pulse">
              <div className="w-16 h-16 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center shadow-md">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  {lang === 'ar' ? 'جاري تحليل وقراءة المستند دلالياً...' : 'Analyzing & Parsing Document Semantically...'}
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
                  {lang === 'ar'
                    ? 'يتم الآن استخراج النصوص ومعالجة الجداول وصيانة اللغة العربية بدقة متناهية عبر نموذج Gemini 3.6...'
                    : 'Extracting text structure, processing layout, and optimizing characters via Gemini 3.6 model...'}
                </p>
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
                accept=".pdf,.docx,.txt,.md,.json,.csv,.py,.ts,.js,.html,.xml"
                className="hidden"
              />
              <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center shadow-xs">
                <Upload className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  {lang === 'ar' ? 'اسحب واسقط المستند هنا أو انقر للاستعراض' : 'Drag & drop document here or click to browse'}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {lang === 'ar'
                    ? 'يدعم ملفات PDF, DOCX, TXT, Markdown, JSON, CSV وشفرات Python/JS حتى 50MB'
                    : 'Supports PDF, DOCX, TXT, MD, JSON, CSV, and Python/JS files'}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5 text-[10px] font-mono font-bold text-slate-400 pt-2">
                <span className="bg-white px-2 py-0.5 rounded border border-slate-200">.PDF</span>
                <span className="bg-white px-2 py-0.5 rounded border border-slate-200">.DOCX</span>
                <span className="bg-white px-2 py-0.5 rounded border border-slate-200">.MD</span>
                <span className="bg-white px-2 py-0.5 rounded border border-slate-200">.TXT</span>
                <span className="bg-white px-2 py-0.5 rounded border border-slate-200">.JSON</span>
                <span className="bg-white px-2 py-0.5 rounded border border-slate-200">.PYTHON</span>
              </div>
            </div>
          )
        )}

        {/* TAB 2: YOUTUBE VIDEO TRANSCRIPT EXTRACTOR */}
        {inputTab === 'youtube' && (
          <div className="p-6 bg-slate-50/80 rounded-3xl border border-rose-100/80 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
                <Youtube className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  {lang === 'ar' ? 'استخراج تفريغ فيديو يوتيوب (YouTube Video Transcript)' : 'YouTube Video Transcript Extractor'}
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

            {/* Video Preview Card if extracted */}
            {youtubeVideoMeta && (
              <div className="p-3 bg-white rounded-2xl border border-slate-200 flex items-center gap-3.5 shadow-3xs">
                <img
                  src={youtubeVideoMeta.thumbnail}
                  alt={youtubeVideoMeta.title}
                  className="w-24 h-16 object-cover rounded-xl border border-slate-100 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 inline-block mb-1">
                    {youtubeVideoMeta.channel}
                  </span>
                  <h4 className="text-xs font-extrabold text-slate-900 truncate">{youtubeVideoMeta.title}</h4>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1 font-mono">
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
              placeholder={lang === 'ar' ? 'الصق النص كاملاً هنا أو اختر ملفاً أعلاه...' : 'Paste full document text here or upload file above...'}
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
                <option value="semantic">{lang === 'ar' ? 'تقطيع دلالي ذكي (Semantic)' : 'Semantic Boundary'}</option>
                <option value="markdown">{lang === 'ar' ? 'تقسيم الترويسات (Markdown Headings)' : 'Markdown Headings'}</option>
                <option value="code">{lang === 'ar' ? 'هيكل الشفرة (Code AST)' : 'Code AST Structure'}</option>
                <option value="sliding">{lang === 'ar' ? 'نافذة متداخلة (Sliding Window)' : 'Sliding Window'}</option>
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
              <label className="text-[11px] font-bold text-slate-300 block mb-1">
                {lang === 'ar' ? 'ربط بمجموعة معينة (Target Collection):' : 'Target Collection:'}
              </label>
              <select
                value={selectedColId}
                onChange={(e) => setSelectedColId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
              >
                <option value="">{lang === 'ar' ? 'بدون مجموعة خاصة (General Pool)' : 'General Pool'}</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
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
                    <p className="text-[11px] text-slate-300 line-clamp-3 leading-relaxed font-sans">
                      {chk.content}
                    </p>
                    <div className="text-[9px] text-slate-500 truncate">
                      Vector Vector: [0.024, -0.118, 0.892, 0.441, -0.052, ...]
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
                    ? `الوقت المتبقي المتوقع: ~${estimatedSecondsLeft} ثوانٍ`
                    : `Estimated time remaining: ~${estimatedSecondsLeft} seconds`}
                </p>
              </div>
              <span className="text-sm font-black text-indigo-400 font-mono">
                {overallProgress}%
              </span>
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
                              isActive ? 'text-indigo-300' : isCompleted ? 'text-slate-300' : isError ? 'text-rose-300' : 'text-slate-400'
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
