'use client';

import { APP_VERSION } from '@/lib/config/systemConfig';
import { getAiModelConfig } from '@/lib/config/aiModels';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import {
  BookOpen,
  Lock,
  SlidersHorizontal,
  Plug,
  Activity,
  RefreshCw,
  ExternalLink,
  FileText,
  Eye,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  Message,
  ChatMode,
  Citation,
  MCPToolCall,
  MCPServerConfig,
  Conversation,
  Collection,
} from '@/lib/types/omnirag';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import { printChatTranscript, exportChatAsPdf, buildTranscriptText } from '@/lib/chat/chatExport';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { ChatMain } from '@/components/chat/ChatMain';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface ChatStudioProps {
  tenantId: string;
  lang: 'ar' | 'en';
  onNavigateTab?: (tab: any) => void;
}

export default function ChatStudio({ tenantId, lang, onNavigateTab }: ChatStudioProps) {
  // Durable PostgreSQL Conversation & Messages States
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('conv-init');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('omnirag-chat-sidebar-open') !== 'false';
  });
  const [isLoadingConversations, setIsLoadingConversations] = useState<boolean>(true);
  const [pendingDeleteConversationId, setPendingDeleteConversationId] = useState<string | null>(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState<boolean>(false);

  // Resizable / fullscreen workspace states
  const sidebarPanelRef = usePanelRef();
  const inspectorPanelRef = usePanelRef();
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [, setIsInspectorCollapsed] = useState<boolean>(false);
  const [isXlScreen, setIsXlScreen] = useState<boolean>(false);

  // Track the xl breakpoint so the right inspector panel only mounts on large screens
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    const apply = () => setIsXlScreen(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Persist the sidebar collapse preference across sessions
  useEffect(() => {
    localStorage.setItem('omnirag-chat-sidebar-open', String(isSidebarOpen));
  }, [isSidebarOpen]);

  // Restore the persisted sidebar state on mount (collapsed panels start at 0)
  useEffect(() => {
    if (!isSidebarOpen) {
      sidebarPanelRef.current?.collapse();
    }
  }, [isSidebarOpen, sidebarPanelRef]);

  const toggleSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, [sidebarPanelRef]);

  const toggleFullscreen = useCallback(() => setIsFullscreen((v) => !v), []);

  // Stable citation callbacks. These are passed deep into memoized message
  // components; keeping their identity stable is what lets `ChatMessage`'s
  // `memo` bail out while the user types in the input box. Without this, every
  // keystroke would re-parse the markdown of every rendered message.
  const handleCitationClick = useCallback((cit: Citation) => {
    setActiveCitation(cit);
    setActiveRightTab('citations');
  }, []);

  const handleViewInKnowledge = useMemo(
    () => (onNavigateTab ? () => onNavigateTab('knowledge') : undefined),
    [onNavigateTab],
  );

  // Keyboard shortcuts: Ctrl/Cmd+B toggles the sidebar, Ctrl/Cmd+Shift+F toggles
  // focus fullscreen, Escape exits fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsFullscreen((v) => !v);
      }
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, toggleSidebar]);

  // Knowledge Collections & Sources Filtering States
  const [availableCollections, setAvailableCollections] = useState<Collection[]>([]);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  const [showSourcesModal, setShowSourcesModal] = useState<boolean>(false);
  const [isLoadingCollections, setIsLoadingCollections] = useState<boolean>(false);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'msg-welcome',
      tenantId,
      conversationId: 'conv-init',
      role: 'assistant',
      content:
        lang === 'ar'
          ? `مرحباً بك في **استوديو المحادثة المعززة من منصة OmniRAG (الإصدار v${APP_VERSION})**.

يدعم النظام الآن **ذاكرة المحادثة قصيرة وطويلة الأمد** — سأتذكر سياق محادثاتنا السابقة وأرد بشكل طبيعي.

الميزات المدعومة:
- 🧮 **الرموز والمعادلات الرياضية (KaTeX):** مثل $E = mc^2$ مع زر تحويل فوري للرموز العربية.
- 💻 **الشفرات البرمجية:** إبراز لغوي احترافي (Shiki) مع أرقام الأسطر والطي والنسخ.
- 📊 **جداول تفاعلية قابلة للفرز** وتنبيهات ملونة (ملاحظة/تلميح/تحذير) ومخططات Mermaid.
- 📚 **الاستشهادات المضمنة:** أرقام المصادر [1] روابط مباشرة للمصدر الأصلي.
- 🖥️ **مساحة عمل ديناميكية:** أشرطة قابلة للطي والتمديد بالسحب، ووضع تركيز بملء الشاشة (Ctrl+B للشريط الجانبي، Ctrl+Shift+F لملء الشاشة).
- 🔊 **القراءة الناطقة (TTS) وتصدير الإجابات بصيغة Markdown.**`
          : `Welcome to **OmniRAG Agentic Chat Studio (v${APP_VERSION})**.

The system now supports **short-term and long-term conversation memory** — I'll remember our prior context and respond naturally.

Supported features:
- 🧮 **Math Equations (KaTeX):** Formulas like $E = mc^2$ with Arabic notation toggle.
- 💻 **Syntax-Highlighted Code Blocks:** Shiki highlighting with line numbers, folding, and copy.
- 🎬 **Embedded Media:** Direct playback for images, video, and audio.
- 📚 **Inline Citations:** Source numbers [1] link directly to the original source.
- 🖥️ **Dynamic Workspace:** Drag-resizable collapsible panels and fullscreen mode (Ctrl+B toggles the sidebar).
- 🔊 **Text-To-Speech (TTS) and Markdown Exports.**`,
      createdAt: new Date().toISOString(),
      modelUsed: getAiModelConfig().chatStreamModel,
    },
  ]);

  const [inputPrompt, setInputPrompt] = useState('');
  const [selectedMode, setSelectedMode] = useState<ChatMode>('hybrid');
  const [isLoading, setIsLoading] = useState(false);
  // Lets the user cancel an in-flight generation (Stop button).
  const abortControllerRef = useRef<AbortController | null>(null);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [pendingToolApproval, setPendingToolApproval] = useState<MCPToolCall | null>(null);
  const [securityNotice, setSecurityNotice] = useState<string | null>(null);
  const [mcpApprovalSuccess, setMcpApprovalSuccess] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);

  // Real-time workspace inspection states (right inspector)
  const [activeRightTab, setActiveRightTab] = useState<'citations' | 'mcp' | 'logs'>('mcp');
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [isRefreshingServers, setIsRefreshingServers] = useState(false);
  const [pingingServerId, setPingingServerId] = useState<string | null>(null);
  const [sessionToolCalls, setSessionToolCalls] = useState<MCPToolCall[]>([]);
  const [expandedToolCallId, setExpandedToolCallId] = useState<string | null>(null);
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);

  // Auto-save message draft
  useEffect(() => {
    const draftKey = `omnirag-draft-${tenantId}-${activeConversationId}`;
    const savedDraft = localStorage.getItem(draftKey);
    if (savedDraft) {
      setInputPrompt(savedDraft);
    } else {
      setInputPrompt('');
    }
  }, [tenantId, activeConversationId]);

  useEffect(() => {
    const draftKey = `omnirag-draft-${tenantId}-${activeConversationId}`;
    const timer = setTimeout(() => {
      if (inputPrompt.trim()) {
        localStorage.setItem(draftKey, inputPrompt);
      } else {
        localStorage.removeItem(draftKey);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [inputPrompt, tenantId, activeConversationId]);

  // Load conversations from PostgreSQL
  const fetchConversations = async (autoSelectFirst = true) => {
    setIsLoadingConversations(true);
    try {
      const res = await fetchWithAuth(`/api/v1/conversations?tenantId=${tenantId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.conversations && data.conversations.length > 0) {
          setConversations(data.conversations);
          if (
            autoSelectFirst &&
            (activeConversationId === 'conv-init' ||
              !data.conversations.some((c: Conversation) => c.id === activeConversationId))
          ) {
            const firstId = data.conversations[0].id;
            setActiveConversationId(firstId);
            fetchMessagesForConv(firstId);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching conversations:', err);
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const fetchCollections = async () => {
    setIsLoadingCollections(true);
    try {
      const res = await fetchWithAuth(`/api/v1/collections?tenantId=${tenantId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.collections) {
          setAvailableCollections(data.collections);
        }
      }
    } catch (err) {
      console.error('Error fetching collections:', err);
    } finally {
      setIsLoadingCollections(false);
    }
  };

  const fetchMessagesForConv = async (convId: string) => {
    try {
      const res = await fetchWithAuth(`/api/v1/conversations?tenantId=${tenantId}&conversationId=${convId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.messages) {
          setMessages(data.messages);
        }
        if (data.conversation) {
          setSelectedMode(data.conversation.mode || 'hybrid');
          setSelectedCollectionIds(data.conversation.collectionIds || []);
        }
      }
    } catch (err) {
      console.error('Error fetching messages for conversation:', err);
    }
  };

  useEffect(() => {
    fetchConversations(true);
    fetchCollections();
  }, [tenantId]);

  // Determine if the right inspector (MCP/Logs) is relevant;
  // the panel itself only mounts on xl screens to keep focus on the conversation.
  const showRightInspector =
    isXlScreen && (mcpServers.length > 0 || sessionToolCalls.length > 0 || activeCitation !== null);

  const handleToggleCollection = (colId: string) => {
    setSelectedCollectionIds((prev) => {
      let updated: string[];
      if (prev.includes(colId)) {
        updated = prev.filter((id) => id !== colId);
      } else {
        updated = [...prev, colId];
      }
      if (activeConversationId && activeConversationId !== 'conv-init') {
        const activeConv = conversations.find((c) => c.id === activeConversationId);
        if (activeConv) {
          fetchWithAuth('/api/v1/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'create',
              tenantId,
              id: activeConv.id,
              title: activeConv.title,
              mode: activeConv.mode,
              model: activeConv.model,
              collectionIds: updated,
            }),
          }).catch((err) => console.error('Error saving collectionIds:', err));
        }
      }
      return updated;
    });
  };

  const handleSelectAllCollections = () => {
    setSelectedCollectionIds(availableCollections.map((c) => c.id));
  };

  const handleClearAllCollections = () => {
    setSelectedCollectionIds([]);
  };

  const handleCreateNewConversation = async () => {
    try {
      const res = await fetchWithAuth('/api/v1/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          tenantId,
          title: lang === 'ar' ? 'محادثة جديدة' : 'New Conversation',
          mode: selectedMode,
          welcomeText:
            lang === 'ar'
              ? 'مرحباً بك في الجلسة الجديدة. كيف يمكنني مساعدتك اليوم؟'
              : 'Welcome to the new session. How can I help you today?',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.conversation) {
          setActiveConversationId(data.conversation.id);
          setConversations(data.conversations || []);
          fetchMessagesForConv(data.conversation.id);
          setAiSuggestions([]);
        }
      }
    } catch (err) {
      console.error('Error creating conversation:', err);
    }
  };

  const handleDeleteConversation = (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteConversationId(convId);
  };

  const confirmDeleteConversation = async (convId: string) => {
    setIsDeletingConversation(true);
    try {
      const res = await fetchWithAuth('/api/v1/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          tenantId,
          conversationId: convId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const updatedList = data.conversations || [];
        setConversations(updatedList);
        if (convId === activeConversationId) {
          if (updatedList.length > 0) {
            const nextId = updatedList[0].id;
            setActiveConversationId(nextId);
            fetchMessagesForConv(nextId);
          } else {
            handleCreateNewConversation();
          }
        }
      }
    } catch (err) {
      console.error('Error deleting conversation:', err);
    } finally {
      setIsDeletingConversation(false);
      setPendingDeleteConversationId(null);
    }
  };

  const handleRenameConversation = async (convId: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetchWithAuth('/api/v1/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rename',
          tenantId,
          conversationId: convId,
          title: newTitle.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (err) {
      console.error('Error renaming conversation:', err);
    }
  };

  const modeDescriptions = {
    private:
      lang === 'ar'
        ? 'وضع خاص: حظر البحث المباشر في الويب وقصر النطاق على المستندات المحلية فقط مع عزل أدوات MCP الخارجية'
        : 'Private: Strict local documents only with external MCP tool containment',
    hybrid:
      lang === 'ar'
        ? 'وضع هجين: دمج الاسترجاع المتجهي مع المعجمي وRRF مع تفعيل أدوات MCP'
        : 'Hybrid: Vector + Lexical RRF Fusion with authorized MCP tools',
    general:
      lang === 'ar'
        ? 'وضع عام: المعرفة العامة المباشرة دون العودة للمستندات المحلية'
        : 'General: Direct Model Knowledge without local document context',
    analysis:
      lang === 'ar'
        ? 'وضع التحليل المعمق: استخدام نماذج الاستدلال المتقدم للتحليل الشامل للملفات والأدوات'
        : 'Analysis: Deep Reasoning Model utilizing all documents and active tools',
  };

  const fetchMcpServers = async () => {
    setIsRefreshingServers(true);
    try {
      const res = await fetchWithAuth(`/api/v1/mcp/servers?tenantId=${tenantId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.servers) {
          setMcpServers(data.servers);
        }
      }
    } catch (err) {
      console.error('Error fetching MCP servers:', err);
    } finally {
      setIsRefreshingServers(false);
    }
  };

  useEffect(() => {
    fetchMcpServers();
  }, [tenantId]);

  const handleToggleTool = async (serverId: string, toolName: string) => {
    try {
      const res = await fetchWithAuth('/api/v1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, toolName, tenantId }),
      });
      if (res.ok) {
        await fetchMcpServers();
      }
    } catch (err) {
      console.error('Error toggling tool:', err);
    }
  };

  const handlePingServer = async (serverId: string) => {
    setPingingServerId(serverId);
    try {
      const res = await fetchWithAuth('/api/v1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ping', serverId, tenantId }),
      });
      if (res.ok) {
        await fetchMcpServers();
      }
    } catch (err) {
      console.error('Error pinging server:', err);
    } finally {
      setPingingServerId(null);
    }
  };

  const handleExportChat = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(messages, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `omnirag-chat-${tenantId}-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Print goes through the native print dialog; PDF export generates a real
  // PDF file and downloads it directly (falls back to printing on failure).
  const handlePrintChat = useCallback(() => printChatTranscript(), []);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const handleExportPdf = useCallback(async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const currentConv = conversations.find((c) => c.id === activeConversationId);
      const ok = await exportChatAsPdf(currentConv?.title);
      if (!ok) printChatTranscript();
    } finally {
      setIsExportingPdf(false);
    }
  }, [isExportingPdf, conversations, activeConversationId]);

  // Save the current conversation into the knowledge base as a reference
  // document. The transcript is ingested through the documents API, which
  // creates a source connector, chunks the content and indexes it in Qdrant.
  const [isSavingToSources, setIsSavingToSources] = useState(false);
  const handleSaveToSources = useCallback(async () => {
    if (messages.length === 0 || isSavingToSources) return;
    setIsSavingToSources(true);
    try {
      const currentConv = conversations.find((c) => c.id === activeConversationId);
      const title =
        currentConv?.title ||
        (lang === 'ar'
          ? `محادثة OmniRAG — ${new Date().toLocaleDateString('ar')}`
          : `OmniRAG Chat — ${new Date().toLocaleDateString()}`);
      const content = buildTranscriptText(messages, title);

      const res = await fetchWithAuth('/api/v1/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: lang === 'ar' ? `مرجع محادثة: ${title}` : `Chat Reference: ${title}`,
          content,
          sourceType: 'custom_mcp',
          language: lang,
          collectionIds: selectedCollectionIds,
          sourceConfig: { origin: 'chat-studio', conversationId: activeConversationId },
        }),
      });

      if (res.ok) {
        setMcpApprovalSuccess(
          lang === 'ar'
            ? 'تم حفظ المحادثة في المصادر المعرفية كمرجع قابل للبحث.'
            : 'Conversation saved to knowledge sources as a searchable reference.',
        );
      } else {
        const data = await res.json().catch(() => ({}));
        setSecurityNotice(
          data.error || (lang === 'ar' ? 'تعذر حفظ المحادثة في المصادر.' : 'Could not save the chat to sources.'),
        );
      }
      setTimeout(() => {
        setMcpApprovalSuccess(null);
        setSecurityNotice(null);
      }, 4000);
    } catch {
      setSecurityNotice(lang === 'ar' ? 'حدث خطأ أثناء الحفظ في المصادر.' : 'Error while saving to sources.');
      setTimeout(() => setSecurityNotice(null), 4000);
    } finally {
      setIsSavingToSources(false);
    }
  }, [messages, isSavingToSources, conversations, lang, selectedCollectionIds, activeConversationId]);

  // Deterministic fallback suggestions for when AI suggestions are unavailable
  const getFallbackSuggestions = (msgList: Message[]): string[] => {
    if (!msgList || msgList.length <= 1) {
      return [
        lang === 'ar' ? 'ما هي شروط اتفاقية عدم الإفصاح NDA؟' : 'What are the NDA terms?',
        lang === 'ar'
          ? 'ابحث في الويب عن أحدث معايير الأمن السيبراني 2026'
          : 'Search the web for latest cybersecurity standards 2026',
        lang === 'ar' ? 'لخص أهم المستندات المتاحة' : 'Summarize the key available documents',
      ];
    }
    const lastAssistant = [...msgList].reverse().find((m) => m.role === 'assistant');
    const ctx = (lastAssistant?.content || '').toLowerCase();
    if (ctx.includes('nda') || ctx.includes('سرية') || ctx.includes('عقد')) {
      return [
        lang === 'ar'
          ? 'ما الغرامات المنصوص عليها عند الإخلال بالسرية؟'
          : 'What penalties apply for breach of confidentiality?',
        lang === 'ar'
          ? 'كم مدة سريان الالتزامات بعد انتهاء العقد؟'
          : 'How long do obligations last after contract end?',
        lang === 'ar' ? 'لخص أهم 3 نقاط جوهرية' : 'Summarize the 3 key terms',
      ];
    }
    return [
      lang === 'ar' ? 'لخص الإجابة السابقة في 3 نقاط' : 'Summarize the previous answer in 3 points',
      lang === 'ar' ? 'اشرح المزيد من التفاصيل التقنية' : 'Explain more technical details',
      lang === 'ar' ? 'أعطني أمثلة عملية لتوضيح الفكرة' : 'Give me practical examples',
    ];
  };

  const handleSendMessage = async (
    promptToSend?: string,
    approvedToolCall?: MCPToolCall,
    regenerate = false,
    historyBase?: Message[],
  ) => {
    const textPrompt = promptToSend || inputPrompt;
    if (!textPrompt.trim() || isLoading) return;

    setSecurityNotice(null);

    // Abort any in-flight generation before starting a new one.
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      tenantId,
      conversationId: activeConversationId,
      role: 'user',
      content: approvedToolCall
        ? `${lang === 'ar' ? '✓ موافقة وتفويض تشغيل أداة الـ MCP:' : '✓ Approved MCP Tool:'} ${approvedToolCall.scopedToolName}`
        : textPrompt,
      createdAt: new Date().toISOString(),
    };

    // Regeneration re-asks the last prompt without duplicating the user bubble.
    if (!regenerate) {
      setMessages((prev) => [...prev, userMsg]);
      if (!promptToSend) setInputPrompt('');
      // Persist user message
      fetchWithAuth('/api/v1/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_message', tenantId, message: userMsg }),
      }).catch((err) => console.error('PostgreSQL user message save error:', err));
    }
    setIsLoading(true);
    setAiSuggestions([]);

    // Build conversation history (last 10 messages) for memory. On regeneration
    // the base already ends with the user prompt, so we don't append it again.
    const baseMessages = historyBase ?? messages;
    const conversationHistory = (regenerate ? baseMessages : [...baseMessages, userMsg])
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetchWithAuth('/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        signal: controller.signal,
        body: JSON.stringify({
          tenantId,
          prompt: textPrompt,
          mode: selectedMode,
          collectionIds: selectedCollectionIds,
          approvedToolCall,
          conversationId: activeConversationId,
          conversationHistory,
          generateSuggestions: true,
        }),
      });

      const data = await res.json();

      // User pressed Stop — fetchWithAuth converts the AbortError into a 503
      // fallback response, so detect the abort via the controller signal.
      if (controller.signal.aborted) {
        const stoppedMsg: Message = {
          id: `msg-stopped-${Date.now()}`,
          tenantId,
          conversationId: activeConversationId,
          role: 'assistant',
          content: lang === 'ar' ? '⏹️ تم إيقاف التوليد بناءً على طلبك.' : '⏹️ Generation stopped.',
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, stoppedMsg]);
        setIsLoading(false);
        return;
      }

      if (!res.ok) {
        const blockedReason =
          data.error || (lang === 'ar' ? 'تم حظر الطلب بواسطة محرك الأمان.' : 'Request blocked by security engine.');
        setSecurityNotice(blockedReason);
        const blockedMsg: Message = {
          id: `msg-blocked-${Date.now()}`,
          tenantId,
          conversationId: activeConversationId,
          role: 'assistant',
          content: `🛑 [درع أمن OmniRAG]: ${blockedReason}`,
          createdAt: new Date().toISOString(),
          modelUsed: 'HookHarness Defense Engine',
        };
        setMessages((prev) => [...prev, blockedMsg]);
        fetchWithAuth('/api/v1/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_message', tenantId, message: blockedMsg }),
        }).catch(() => {});
        setIsLoading(false);
        return;
      }

      if (data.pendingToolCall) {
        setPendingToolApproval(data.pendingToolCall);
        setActiveRightTab('logs');
        setSessionToolCalls((prev) => {
          const exists = prev.some((tc) => tc.id === data.pendingToolCall.id);
          return exists ? prev : [...prev, data.pendingToolCall];
        });
      }

      if (data.toolCalls && data.toolCalls.length > 0) {
        setSessionToolCalls((prev) => {
          const existingIds = new Set(prev.map((t) => t.id));
          const newCalls = data.toolCalls.filter((tc: any) => !existingIds.has(tc.id));
          return [...prev, ...newCalls];
        });
        setActiveRightTab('logs');
      }

      const assistantMsg: Message = {
        id: `msg-${Date.now() + 1}`,
        tenantId,
        conversationId: activeConversationId,
        role: 'assistant',
        content: data.text,
        citations: data.citations,
        modelUsed: data.modelUsed,
        tokensUsed: data.tokensUsed,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Persist assistant message
      fetchWithAuth('/api/v1/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_message', tenantId, message: assistantMsg }),
      })
        .then(() => fetchConversations(false))
        .catch((err) => console.error('PostgreSQL assistant message save error:', err));

      // Update AI suggestions (fallback to deterministic if empty)
      const newSuggestions =
        data.suggestions && data.suggestions.length > 0
          ? data.suggestions
          : getFallbackSuggestions([...messages, userMsg, assistantMsg]);
      setAiSuggestions(newSuggestions);

      if (data.citations && data.citations.length > 0) {
        setActiveCitation(data.citations[0]);
      }
    } catch {
      if (controller.signal.aborted) {
        // Aborted mid-flight — the Stop handler already surfaced feedback.
      } else {
        setSecurityNotice(lang === 'ar' ? 'حدث خطأ في الاتصال بالخادم.' : 'Connection error.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Stop the in-flight generation.
  const handleStopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // Regenerate the last assistant answer by re-sending the last user prompt.
  const handleRegenerate = useCallback(() => {
    if (isLoading) return;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    // Drop the trailing assistant reply so the fresh answer replaces it, and use
    // the trimmed list as the memory base (it already ends with the user prompt).
    const base =
      messages.length > 0 && messages[messages.length - 1].role === 'assistant' ? messages.slice(0, -1) : messages;
    setMessages(base);
    handleSendMessage(lastUser.content, undefined, true, base);
  }, [messages, isLoading]);

  const handleApproveTool = (toolCall: MCPToolCall) => {
    const approvedCall = { ...toolCall, status: 'approved' as const };
    setMcpApprovalSuccess(
      lang === 'ar' ? 'تمت الموافقة على الأداة وتحديث سجلات التدقيق!' : 'Tool approved and authorized!',
    );
    setPendingToolApproval(null);
    setTimeout(() => setMcpApprovalSuccess(null), 4000);
    setSessionToolCalls((prev) => prev.map((t) => (t.id === toolCall.id ? { ...t, status: 'approved' } : t)));
    handleSendMessage(
      inputPrompt || (lang === 'ar' ? 'تأكيد موافقة أداة الـ MCP' : 'Confirm MCP tool approval'),
      approvedCall,
    );
  };

  const handleRejectTool = () => {
    setPendingToolApproval(null);
  };

  const activeConv = conversations.find((c) => c.id === activeConversationId);

  /* The chat surface (messages + input + sources modal). Rendered inside the
     resizable panel group normally, and on its own in focus-fullscreen mode so
     the conversation truly fills the whole screen. */
  const chatSurface = (
    <div
      className={`print-expand flex flex-col h-full bg-white ${isFullscreen ? '' : 'border-x border-slate-200/80 shadow-xs'} overflow-hidden relative`}
    >
      <ChatMain
        lang={lang}
        messages={messages}
        isLoading={isLoading}
        inputPrompt={inputPrompt}
        setInputPrompt={setInputPrompt}
        selectedMode={selectedMode}
        setSelectedMode={setSelectedMode}
        selectedCollectionIds={selectedCollectionIds}
        suggestions={aiSuggestions}
        securityNotice={securityNotice}
        mcpApprovalSuccess={mcpApprovalSuccess}
        pendingToolApproval={pendingToolApproval}
        onSendMessage={handleSendMessage}
        onStopGeneration={handleStopGeneration}
        onRegenerate={handleRegenerate}
        onApproveTool={handleApproveTool}
        onRejectTool={handleRejectTool}
        onCitationClick={handleCitationClick}
        onViewInKnowledge={handleViewInKnowledge}
        onExportChat={handleExportChat}
        onExportPdf={handleExportPdf}
        isExportingPdf={isExportingPdf}
        onPrintChat={handlePrintChat}
        onSaveToSources={handleSaveToSources}
        isSavingToSources={isSavingToSources}
        onOpenSourcesModal={() => setShowSourcesModal(true)}
        activeTitle={activeConv?.title}
        sidebarOpen={isSidebarOpen}
        onToggleSidebar={toggleSidebar}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      {/* Sources Modal (overlay inside the chat surface) */}
      {showSourcesModal && (
        <div
          className="absolute inset-0 z-20 bg-black/30 backdrop-blur-sm flex items-start justify-center p-4 pt-16 animate-fadeIn"
          onClick={() => setShowSourcesModal(false)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[70vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-amber-500" />
                <h4 className="text-sm font-bold text-slate-800">
                  {lang === 'ar' ? 'مصادر المعرفة النشطة' : 'Active Knowledge Sources'}
                </h4>
                <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-mono">
                  {selectedCollectionIds.length === 0
                    ? lang === 'ar'
                      ? 'شامل'
                      : 'All'
                    : `${selectedCollectionIds.length}`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAllCollections}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  {lang === 'ar' ? 'تحديد الكل' : 'Select All'}
                </button>
                <button
                  type="button"
                  onClick={handleClearAllCollections}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  {lang === 'ar' ? 'مسح' : 'Clear'}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {isLoadingCollections ? (
                <div className="py-8 text-center">
                  <RefreshCw className="w-5 h-5 animate-spin text-indigo-500 mx-auto" />
                </div>
              ) : availableCollections.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">
                  {lang === 'ar' ? 'لا توجد مجموعات معرفية.' : 'No collections configured.'}
                </p>
              ) : (
                availableCollections.map((col) => {
                  const isChecked = selectedCollectionIds.includes(col.id);
                  return (
                    <div
                      key={col.id}
                      onClick={() => handleToggleCollection(col.id)}
                      className={`p-3 rounded-xl border transition text-xs cursor-pointer flex items-start gap-2.5 ${
                        isChecked
                          ? 'bg-amber-50 border-amber-400 text-amber-900 ring-1 ring-amber-400/40'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="mt-0.5 rounded border-slate-300 text-amber-500 focus:ring-amber-500 shrink-0 cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className="font-bold truncate text-slate-800">{col.name}</span>
                          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono shrink-0">
                            {col.documentCount || 0} {lang === 'ar' ? 'مستند' : 'docs'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 line-clamp-2 leading-tight">
                          {col.description ||
                            (lang === 'ar' ? 'مجموعة معرفية مستوردة' : 'Imported knowledge collection')}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Focus fullscreen: the chat surface alone, covering the entire viewport.
  if (isFullscreen) {
    return (
      <div
        className="print-expand fixed inset-0 z-40 bg-white shadow-2xl animate-fadeIn"
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
      >
        {chatSurface}
      </div>
    );
  }

  return (
    <div className="print-expand flex h-full w-full overflow-hidden bg-white" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <Group orientation="horizontal" className="h-full w-full">
        {/* Conversation Sidebar — collapsible & drag-resizable */}
        <Panel
          id="sidebar"
          panelRef={sidebarPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize="19"
          minSize="13"
          maxSize="32"
          onResize={(size) => setIsSidebarOpen(size.asPercentage > 0.5)}
          className="no-print min-w-0"
        >
          <ChatSidebar
            conversations={conversations}
            activeConversationId={activeConversationId}
            isLoading={isLoadingConversations}
            lang={lang}
            isOpen={isSidebarOpen}
            onToggle={toggleSidebar}
            onSelectConversation={(convId) => {
              if (convId !== activeConversationId) {
                setActiveConversationId(convId);
                setAiSuggestions([]);
                fetchMessagesForConv(convId);
              }
            }}
            onCreateNew={handleCreateNewConversation}
            onDeleteConversation={handleDeleteConversation}
            onRenameConversation={handleRenameConversation}
          />
        </Panel>

        <Separator className="panel-resize-handle" />

        {/* Chat Surface — primary workspace, fills the remaining width */}
        <Panel id="chat" minSize="30" className="min-w-0">
          {chatSurface}
        </Panel>

        {/* Right Inspector (MCP, Citations, Logs) — collapsible & resizable, xl+ only */}
        {showRightInspector && (
          <>
            <Separator className="panel-resize-handle" />
            <Panel
              id="inspector"
              panelRef={inspectorPanelRef}
              collapsible
              collapsedSize={0}
              defaultSize="22"
              minSize="16"
              maxSize="36"
              onResize={(size) => setIsInspectorCollapsed(size.asPercentage <= 0.5)}
              className="no-print min-w-0"
            >
              <div className="h-full flex flex-col bg-slate-50 border-slate-200/80 p-4 overflow-hidden">
                <div className="flex flex-col h-full overflow-hidden">
                  {/* Tabs */}
                  <div className="flex border-b border-slate-200 gap-1 mb-4">
                    <button
                      onClick={() => {
                        setActiveRightTab('mcp');
                        inspectorPanelRef.current?.expand();
                      }}
                      className={`flex-1 py-1.5 text-center text-xs font-bold border-b-2 transition cursor-pointer flex items-center justify-center gap-1 ${
                        activeRightTab === 'mcp'
                          ? 'border-indigo-600 text-indigo-600'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <Plug className="w-3.5 h-3.5" />
                      <span>{lang === 'ar' ? 'البوابات' : 'MCP'}</span>
                    </button>
                    <button
                      onClick={() => {
                        setActiveRightTab('citations');
                        inspectorPanelRef.current?.expand();
                      }}
                      className={`flex-1 py-1.5 text-center text-xs font-bold border-b-2 transition cursor-pointer flex items-center justify-center gap-1 ${
                        activeRightTab === 'citations'
                          ? 'border-indigo-600 text-indigo-600'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>{lang === 'ar' ? 'المراجع' : 'Citations'}</span>
                    </button>
                    <button
                      onClick={() => {
                        setActiveRightTab('logs');
                        inspectorPanelRef.current?.expand();
                      }}
                      className={`flex-1 py-1.5 text-center text-xs font-bold border-b-2 transition cursor-pointer flex items-center justify-center gap-1 ${
                        activeRightTab === 'logs'
                          ? 'border-indigo-600 text-indigo-600'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <Activity className="w-3.5 h-3.5" />
                      <span>{lang === 'ar' ? 'السجل' : 'Log'}</span>
                      {sessionToolCalls.length > 0 && (
                        <span className="w-4 h-4 bg-amber-500 text-white rounded-full text-[9px] flex items-center justify-center font-bold">
                          {sessionToolCalls.length}
                        </span>
                      )}
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto min-h-0 space-y-4">
                    {/* TAB: MCP SERVERS */}
                    {activeRightTab === 'mcp' && (
                      <div className="space-y-4 animate-fadeIn">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            {lang === 'ar' ? 'خوادم MCP' : 'MCP Servers'}
                          </span>
                          <button
                            onClick={fetchMcpServers}
                            disabled={isRefreshingServers}
                            className="p-1 rounded-md text-slate-500 hover:bg-slate-200 transition"
                            title={lang === 'ar' ? 'تحديث' : 'Refresh'}
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingServers ? 'animate-spin' : ''}`} />
                          </button>
                        </div>

                        {mcpServers.length === 0 ? (
                          <p className="text-xs text-slate-400 bg-white p-4 rounded-xl border border-slate-200/60 text-center">
                            {lang === 'ar' ? 'لا توجد خوادم MCP مسجلة.' : 'No MCP servers registered.'}
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {mcpServers.map((server) => {
                              const isExpanded = expandedServerId === server.id;
                              return (
                                <div
                                  key={server.id}
                                  className="bg-white rounded-xl border border-slate-200 shadow-3xs overflow-hidden"
                                >
                                  <div className="p-3 flex items-center justify-between bg-slate-50/50">
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`w-2.5 h-2.5 rounded-full ${server.status === 'healthy' ? 'bg-emerald-500' : server.status === 'degraded' ? 'bg-amber-500' : 'bg-rose-500'}`}
                                      />
                                      <div>
                                        <h4 className="text-xs font-bold text-slate-800">{server.name}</h4>
                                        <span className="text-[10px] text-slate-400 font-mono">
                                          {server.latencyMs}ms
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        onClick={() => handlePingServer(server.id)}
                                        disabled={pingingServerId === server.id}
                                        className="p-1 rounded-md hover:bg-slate-200 text-slate-400 hover:text-indigo-600 transition"
                                        title={lang === 'ar' ? 'فحص' : 'Ping'}
                                      >
                                        <RefreshCw
                                          className={`w-3 h-3 ${pingingServerId === server.id ? 'animate-spin' : ''}`}
                                        />
                                      </button>
                                      <button
                                        onClick={() => setExpandedServerId(isExpanded ? null : server.id)}
                                        className="p-1 rounded-md hover:bg-slate-200 text-slate-500 transition"
                                      >
                                        {isExpanded ? (
                                          <ChevronUp className="w-3.5 h-3.5" />
                                        ) : (
                                          <ChevronDown className="w-3.5 h-3.5" />
                                        )}
                                      </button>
                                    </div>
                                  </div>

                                  {isExpanded && (
                                    <div className="p-3 border-t border-slate-100 bg-white space-y-2.5 animate-fadeIn">
                                      <p className="text-[11px] text-slate-500">{server.description}</p>
                                      <div className="pt-2 border-t border-slate-100">
                                        <span className="text-[10px] font-bold text-slate-400 block mb-1.5 uppercase">
                                          {lang === 'ar' ? 'الأدوات' : 'Tools'}
                                        </span>
                                        {server.enabledTools.length === 0 ? (
                                          <p className="text-[10px] text-slate-400 italic">
                                            {lang === 'ar' ? 'لا أدوات مفعلة.' : 'No tools enabled.'}
                                          </p>
                                        ) : (
                                          <div className="space-y-1.5">
                                            {server.enabledTools.map((tool) => {
                                              const isExternal = ['slack_', 'github_', 'web_', 'fetch_'].some((p) =>
                                                tool.startsWith(p),
                                              );
                                              const isBlocked = selectedMode === 'private' && isExternal;
                                              return (
                                                <div
                                                  key={tool}
                                                  className="flex items-center justify-between p-1.5 rounded-lg bg-slate-50/50 border border-slate-100 text-xs"
                                                >
                                                  <span
                                                    className={`font-mono text-[11px] font-semibold ${isBlocked ? 'line-through text-slate-400' : 'text-slate-700'}`}
                                                  >
                                                    {tool}
                                                  </span>
                                                  {isBlocked ? (
                                                    <span className="px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-600 text-[9px] font-bold border border-rose-100 flex items-center gap-0.5">
                                                      <Lock className="w-2.5 h-2.5" />
                                                      {lang === 'ar' ? 'محتوى' : 'Contained'}
                                                    </span>
                                                  ) : (
                                                    <button
                                                      onClick={() => handleToggleTool(server.id, tool)}
                                                      className="px-2 py-0.5 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[10px] transition border border-indigo-100 cursor-pointer"
                                                    >
                                                      {lang === 'ar' ? 'تعطيل' : 'Disable'}
                                                    </button>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB: CITATION INSPECTOR */}
                    {activeRightTab === 'citations' && (
                      <div className="space-y-4 animate-fadeIn">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                          {lang === 'ar' ? 'السياق والمصادر' : 'Source Verification'}
                        </span>
                        {activeCitation ? (
                          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-3xs space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-indigo-600">
                                {lang === 'ar'
                                  ? `المصدر [${activeCitation.index}]`
                                  : `Source [${activeCitation.index}]`}
                              </span>
                              <span className="text-[10px] font-mono bg-indigo-50 px-2 py-0.5 rounded-md text-indigo-700 font-bold border border-indigo-100">
                                Match: {(activeCitation.score * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-slate-800 font-semibold text-xs">
                              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                              <h4>{activeCitation.documentTitle}</h4>
                            </div>
                            <div className="text-[11px] font-mono text-slate-400 block">
                              {lang === 'ar'
                                ? `صفحة ${activeCitation.pageNumber || 1}`
                                : `Page ${activeCitation.pageNumber || 1}`}
                            </div>
                            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100 font-mono whitespace-pre-wrap">
                              &ldquo;{activeCitation.snippet}&rdquo;
                            </p>
                            {activeCitation.sourceUrl && (
                              <a
                                href={activeCitation.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>{lang === 'ar' ? 'فتح المصدر الأصلي' : 'Open Original Source'}</span>
                              </a>
                            )}
                            {onNavigateTab && (
                              <button
                                type="button"
                                onClick={() => onNavigateTab('knowledge')}
                                className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer border border-indigo-200/80"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>{lang === 'ar' ? 'عرض في مستودع المعرفة' : 'View in Knowledge Base'}</span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 leading-relaxed bg-white p-4 rounded-xl border border-slate-200/60 text-center">
                            {lang === 'ar'
                              ? 'اضغط على رقم المصدر [1] في الإجابة لمعاينة التفاصيل.'
                              : 'Click any [1] citation in the answer to view details.'}
                          </p>
                        )}
                      </div>
                    )}

                    {/* TAB: MCP LOGS */}
                    {activeRightTab === 'logs' && (
                      <div className="space-y-4 animate-fadeIn">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                          {lang === 'ar' ? 'سجل أدوات MCP' : 'MCP Execution Logs'}
                        </span>
                        {sessionToolCalls.length === 0 ? (
                          <p className="text-xs text-slate-400 bg-white p-4 rounded-xl border border-slate-200/60 text-center">
                            {lang === 'ar' ? 'لم يتم تشغيل أي أدوات بعد.' : 'No MCP tools executed yet.'}
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {sessionToolCalls.map((tc) => {
                              const isExpanded = expandedToolCallId === tc.id;
                              const isPending = tc.status === 'pending';
                              return (
                                <div
                                  key={tc.id}
                                  className={`rounded-xl border shadow-3xs overflow-hidden transition ${isPending ? 'bg-amber-50/50 border-amber-300' : tc.status === 'failed' || tc.status === 'rejected' ? 'bg-rose-50/50 border-rose-300' : 'bg-white border-slate-200'}`}
                                >
                                  <div className="p-3 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`w-2 h-2 rounded-full ${isPending ? 'bg-amber-500 animate-pulse' : tc.status === 'failed' || tc.status === 'rejected' ? 'bg-rose-500' : 'bg-emerald-500'}`}
                                      />
                                      <div>
                                        <span className="font-mono text-xs font-bold text-slate-800">
                                          {tc.scopedToolName}
                                        </span>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                          <span className="text-[9px] text-slate-400 font-mono">
                                            {tc.latencyMs || 0}ms
                                          </span>
                                          <span
                                            className={`text-[9px] px-1 rounded font-semibold ${isPending ? 'bg-amber-100 text-amber-800' : tc.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}
                                          >
                                            {tc.status}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => setExpandedToolCallId(isExpanded ? null : tc.id)}
                                      className="p-1 rounded-md hover:bg-slate-200/80 text-slate-500 transition"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  {isExpanded && (
                                    <div className="p-3 border-t border-slate-100 bg-slate-50/50 space-y-2.5 animate-fadeIn">
                                      <div>
                                        <span className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">
                                          {lang === 'ar' ? 'المدخلات:' : 'Inputs:'}
                                        </span>
                                        <pre className="bg-slate-800 text-slate-200 p-2 rounded-lg text-[10px] font-mono overflow-x-auto whitespace-pre-wrap max-h-40">
                                          {JSON.stringify(tc.inputParams, null, 2)}
                                        </pre>
                                      </div>
                                      {tc.outputResult && (
                                        <div>
                                          <span className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">
                                            {lang === 'ar' ? 'النتيجة:' : 'Result:'}
                                          </span>
                                          <pre className="bg-slate-900 text-indigo-200 p-2 rounded-lg text-[10px] font-mono overflow-x-auto whitespace-pre-wrap max-h-40 border border-slate-800">
                                            {JSON.stringify(tc.outputResult, null, 2)}
                                          </pre>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {isPending && (
                                    <div className="p-3 bg-amber-50/80 border-t border-amber-200 flex gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleApproveTool(tc)}
                                        className="flex-1 py-1 bg-emerald-600 text-white rounded-md text-[11px] font-bold hover:bg-emerald-700 transition cursor-pointer"
                                      >
                                        {lang === 'ar' ? 'موافقة' : 'Approve'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSessionToolCalls((prev) =>
                                            prev.map((t) => (t.id === tc.id ? { ...t, status: 'rejected' } : t)),
                                          );
                                          if (pendingToolApproval?.id === tc.id) setPendingToolApproval(null);
                                        }}
                                        className="flex-1 py-1 bg-slate-200 text-slate-700 rounded-md text-[11px] font-bold hover:bg-slate-300 transition cursor-pointer"
                                      >
                                        {lang === 'ar' ? 'رفض' : 'Deny'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Workspace Info Footer */}
                  <div className="pt-4 border-t border-slate-200 text-xs text-slate-500 shrink-0">
                    <p className="font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500" />
                      <span>{lang === 'ar' ? 'الوضع الفعلي' : 'Active Mode'}</span>
                    </p>
                    <p className="text-[11px] text-slate-600 leading-relaxed mb-2">{modeDescriptions[selectedMode]}</p>
                  </div>
                </div>
              </div>
            </Panel>
          </>
        )}
      </Group>

      <ConfirmDialog
        open={pendingDeleteConversationId !== null}
        title={lang === 'ar' ? 'حذف المحادثة' : 'Delete conversation'}
        message={
          lang === 'ar'
            ? 'هل أنت متأكد من حذف هذه المحادثة بالكامل من قاعدة البيانات؟'
            : 'Are you sure you want to delete this chat session?'
        }
        confirmLabel={lang === 'ar' ? 'حذف' : 'Delete'}
        cancelLabel={lang === 'ar' ? 'إلغاء' : 'Cancel'}
        variant="danger"
        loading={isDeletingConversation}
        onConfirm={() => pendingDeleteConversationId && confirmDeleteConversation(pendingDeleteConversationId)}
        onCancel={() => setPendingDeleteConversationId(null)}
      />
    </div>
  );
}
