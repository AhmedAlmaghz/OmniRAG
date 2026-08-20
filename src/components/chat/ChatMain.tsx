'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Send,
  Sparkles,
  Lock,
  Globe,
  Cpu,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Download,
  FolderKanban,
  PanelLeftOpen,
  Maximize2,
  Minimize2,
  ArrowDown,
  ArrowUp,
  Square,
  RotateCcw,
  Printer,
  FileDown,
  BookmarkPlus,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Message, ChatMode, Citation, MCPToolCall } from '@/lib/types/omnirag';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { FollowUpSuggestions } from '@/components/chat/FollowUpSuggestions';
import { QuestionNavigator } from '@/components/chat/QuestionNavigator';

interface ChatMainProps {
  lang: 'ar' | 'en';
  messages: Message[];
  isLoading: boolean;
  inputPrompt: string;
  setInputPrompt: (v: string) => void;
  selectedMode: ChatMode;
  setSelectedMode: (m: ChatMode) => void;
  selectedCollectionIds: string[];
  suggestions: string[];
  securityNotice: string | null;
  mcpApprovalSuccess: string | null;
  pendingToolApproval: MCPToolCall | null;
  onSendMessage: (prompt?: string, approvedToolCall?: MCPToolCall) => void;
  onStopGeneration?: () => void;
  onRegenerate?: () => void;
  onApproveTool: (tc: MCPToolCall) => void;
  onRejectTool: () => void;
  onCitationClick: (c: Citation) => void;
  onViewInKnowledge?: () => void;
  onExportChat: () => void;
  onExportPdf: () => void;
  onPrintChat: () => void;
  onSaveToSources?: () => void;
  isSavingToSources?: boolean;
  onOpenSourcesModal: () => void;
  activeTitle?: string;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

const modeIcon = (m: ChatMode) => {
  if (m === 'hybrid') return <Sparkles className="w-5 h-5 text-indigo-500" />;
  if (m === 'private') return <Lock className="w-5 h-5 text-emerald-500" />;
  if (m === 'general') return <Globe className="w-5 h-5 text-blue-500" />;
  return <Cpu className="w-5 h-5 text-purple-500" />;
};

const modeLabel = (m: ChatMode, lang: 'ar' | 'en') => {
  const ar: Record<ChatMode, string> = {
    hybrid: 'هجين RRF',
    private: 'خاص مغلق',
    general: 'عام مباشر',
    analysis: 'تحليل متقدم',
  };
  const en: Record<ChatMode, string> = {
    hybrid: 'RRF Hybrid',
    private: 'Private',
    general: 'General',
    analysis: 'Advanced Analysis',
  };
  return lang === 'ar' ? ar[m] : en[m];
};

export const ChatMain: React.FC<ChatMainProps> = ({
  lang,
  messages,
  isLoading,
  inputPrompt,
  setInputPrompt,
  selectedMode,
  setSelectedMode,
  selectedCollectionIds,
  suggestions,
  securityNotice,
  mcpApprovalSuccess,
  pendingToolApproval,
  onSendMessage,
  onStopGeneration,
  onRegenerate,
  onApproveTool,
  onRejectTool,
  onCitationClick,
  onViewInKnowledge,
  onExportChat,
  onExportPdf,
  onPrintChat,
  onSaveToSources,
  isSavingToSources = false,
  onOpenSourcesModal,
  activeTitle,
  sidebarOpen = true,
  onToggleSidebar,
  isFullscreen = false,
  onToggleFullscreen,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [showJumpToTop, setShowJumpToTop] = useState(false);
  // Transcript zoom level for the fullscreen floating bar (0 = normal).
  const [zoomLevel, setZoomLevel] = useState(0);
  // Track whether the user is near the bottom so we only auto-scroll when they
  // are following the conversation (not reading history further up).
  const isNearBottomRef = useRef(true);

  // Memoize the rendered message list. With stable citation callbacks from the
  // parent, this means typing in the input box never re-creates or re-parses
  // any message — only the input itself re-renders.
  const messageList = useMemo(
    () =>
      messages.map((msg) => (
        <ChatMessage
          key={msg.id}
          message={msg}
          lang={lang}
          onCitationClick={onCitationClick}
          onViewInKnowledge={onViewInKnowledge}
        />
      )),
    [messages, lang, onCitationClick, onViewInKnowledge],
  );

  // Smart auto-scroll: only when the user is already near the bottom.
  useEffect(() => {
    if (isNearBottomRef.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, isLoading, pendingToolApproval]);

  // Show the jump-to-bottom / jump-to-top buttons based on scroll position.
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 120;
    setShowJumpToBottom(distanceFromBottom > 240);
    setShowJumpToTop(el.scrollTop > 240);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    isNearBottomRef.current = true;
    setShowJumpToBottom(false);
  }, []);

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setShowJumpToTop(false);
  }, []);

  /** Scroll the stream so a specific message (by id) is visible near the top. */
  const jumpToMessage = useCallback((messageId: string) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!target) return;
    const top = target.offsetTop - container.offsetTop - 12;
    container.scrollTo({ top, behavior: 'smooth' });
    // Brief highlight so the user can spot the landed message.
    target.classList.add('ring-2', 'ring-indigo-400', 'ring-offset-2');
    window.setTimeout(() => target.classList.remove('ring-2', 'ring-indigo-400', 'ring-offset-2'), 1600);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [inputPrompt]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50/30 relative" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Compact Toolbar */}
      <div className="no-print p-2 border-b border-slate-200 bg-white/80 backdrop-blur-sm flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Sidebar toggle — visible when the history column is collapsed */}
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className={`p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-indigo-600 transition-all duration-200 cursor-pointer shrink-0 ${
                sidebarOpen ? 'opacity-0 pointer-events-none w-0 p-0 overflow-hidden border-0' : 'opacity-100'
              }`}
              title={lang === 'ar' ? 'فتح سجل المحادثات' : 'Open history'}
              aria-hidden={sidebarOpen}
            >
              <PanelLeftOpen className={`w-4 h-4 ${lang === 'ar' ? 'rtl:-scale-x-100' : ''}`} />
            </button>
          )}
          {activeTitle && <span className="text-xs font-bold text-slate-700 truncate px-2">{activeTitle}</span>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Sources Filter Quick Access */}
          <button
            type="button"
            onClick={onOpenSourcesModal}
            className={`p-1.5 rounded-lg border transition cursor-pointer flex items-center justify-center relative ${
              selectedCollectionIds.length > 0
                ? 'bg-amber-100 text-amber-700 border-amber-300'
                : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
            }`}
            title={lang === 'ar' ? 'تخصيص مصادر المعرفة' : 'Active Sources'}
          >
            <FolderKanban className="w-4 h-4" />
            {selectedCollectionIds.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-amber-600 text-white text-[9px] w-3.5 h-3.5 flex items-center justify-center rounded-full font-bold">
                {selectedCollectionIds.length}
              </span>
            )}
          </button>

          {/* Save conversation to knowledge sources */}
          {onSaveToSources && (
            <button
              type="button"
              onClick={onSaveToSources}
              disabled={isSavingToSources || messages.length === 0}
              className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 text-slate-600 transition cursor-pointer flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              title={lang === 'ar' ? 'حفظ المحادثة في المصادر كمرجع' : 'Save chat to sources as reference'}
            >
              {isSavingToSources ? (
                <RotateCcw className="w-4 h-4 animate-spin" />
              ) : (
                <BookmarkPlus className="w-4 h-4" />
              )}
            </button>
          )}

          {/* Print transcript */}
          <button
            type="button"
            onClick={onPrintChat}
            className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 transition cursor-pointer flex items-center justify-center"
            title={lang === 'ar' ? 'طباعة المحادثة' : 'Print Chat'}
          >
            <Printer className="w-4 h-4" />
          </button>

          {/* Export as PDF (via print → Save as PDF) */}
          <button
            type="button"
            onClick={onExportPdf}
            className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 transition cursor-pointer flex items-center justify-center"
            title={lang === 'ar' ? 'تصدير المحادثة كملف PDF' : 'Export Chat as PDF'}
          >
            <FileDown className="w-4 h-4" />
          </button>

          {/* Export JSON */}
          <button
            type="button"
            onClick={onExportChat}
            className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 transition cursor-pointer flex items-center justify-center"
            title={lang === 'ar' ? 'تصدير المحادثة (JSON)' : 'Export Chat (JSON)'}
          >
            <Download className="w-4 h-4" />
          </button>

          {/* Fullscreen Toggle */}
          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-indigo-600 transition cursor-pointer flex items-center justify-center"
              title={
                isFullscreen
                  ? lang === 'ar'
                    ? 'الخروج من ملء الشاشة (Esc)'
                    : 'Exit Fullscreen (Esc)'
                  : lang === 'ar'
                    ? 'ملء الشاشة'
                    : 'Fullscreen'
              }
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Security Notices */}
      {securityNotice && (
        <div className="mx-4 mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2 animate-fadeIn">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span className="font-medium">{securityNotice}</span>
        </div>
      )}

      {mcpApprovalSuccess && (
        <div className="mx-4 mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-medium">{mcpApprovalSuccess}</span>
        </div>
      )}

      {/* Messages Stream */}
      <div className="relative flex-1 min-h-0 print-expand">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="print-chat-stream chat-stream-zoom h-full overflow-y-auto px-4 sm:px-6 py-6 space-y-5 lazy-scroll"
          data-zoom={zoomLevel}
        >
          {messageList}

          {/* Pending Tool Approval Card */}
          {pendingToolApproval && (
            <div className="my-3 p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl shadow-sm text-slate-800 animate-fadeIn">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-amber-900">
                      {lang === 'ar' ? 'طلب موافقة لتشغيل أداة MCP' : 'Human Approval Required'}
                    </h4>
                    <p className="text-[11px] text-amber-800">
                      {lang === 'ar'
                        ? 'الأداة ذات أثر جانبي وتتطلب تفويضاً'
                        : 'Tool has side effects and needs authorization'}
                    </p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-200 text-amber-900">
                  {pendingToolApproval.scopedToolName}
                </span>
              </div>
              <div className="bg-white/80 p-2.5 rounded-xl border border-amber-200 text-xs font-mono text-slate-700 mb-3 overflow-x-auto">
                <span className="font-bold text-amber-900 text-[10px] block mb-1">
                  {lang === 'ar' ? 'البرامترات:' : 'Input Arguments:'}
                </span>
                <pre className="text-[11px] whitespace-pre-wrap">
                  {JSON.stringify(pendingToolApproval.inputParams, null, 2)}
                </pre>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onRejectTool}
                  className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold transition cursor-pointer flex items-center gap-1"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={() => onApproveTool(pendingToolApproval)}
                  className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{lang === 'ar' ? 'تأكيد التشغيل' : 'Authorize'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Loading Indicator — modern typing dots */}
          {isLoading && (
            <div className="flex items-center gap-3 text-xs text-slate-500 animate-message-appear">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-md">
                <Sparkles className="w-4 h-4 animate-pulse" />
              </div>
              <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm">
                <span
                  className="w-2 h-2 rounded-full bg-indigo-400 animate-typing-dot"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="w-2 h-2 rounded-full bg-indigo-400 animate-typing-dot"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="w-2 h-2 rounded-full bg-indigo-400 animate-typing-dot"
                  style={{ animationDelay: '300ms' }}
                />
                <span className="text-[11px] text-slate-500 ml-1">{lang === 'ar' ? 'يفكر...' : 'Thinking...'}</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} className="h-2" />
        </div>

        {/* Question navigator rail — one tick per user question, click to jump */}
        <QuestionNavigator messages={messages} lang={lang} onJumpToMessage={jumpToMessage} />

        {/* Jump-to-top / jump-to-bottom buttons — appear based on scroll position */}
        <div className="no-print absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5">
          {showJumpToTop && (
            <button
              type="button"
              onClick={scrollToTop}
              className="w-9 h-9 rounded-full bg-white border border-slate-200 shadow-lg hover:bg-indigo-50 hover:border-indigo-300 text-slate-600 hover:text-indigo-600 flex items-center justify-center transition-all cursor-pointer animate-fadeIn"
              title={lang === 'ar' ? 'الانتقال إلى الأعلى' : 'Jump to top'}
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
          {showJumpToBottom && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="w-9 h-9 rounded-full bg-white border border-slate-200 shadow-lg hover:bg-indigo-50 hover:border-indigo-300 text-slate-600 hover:text-indigo-600 flex items-center justify-center transition-all cursor-pointer animate-fadeIn"
              title={lang === 'ar' ? 'الانتقال إلى الأسفل' : 'Jump to bottom'}
            >
              <ArrowDown className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Fullscreen floating action bar — print, PDF export, text zoom, exit.
          Positioned just under the toolbar so it floats over the message
          stream without covering any existing controls. */}
      {isFullscreen && (
        <div
          className="no-print absolute top-14 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 px-2 py-1.5 rounded-2xl bg-slate-900/90 backdrop-blur-md border border-slate-700/60 shadow-2xl animate-fadeIn"
          role="toolbar"
          aria-label={lang === 'ar' ? 'أدوات ملء الشاشة' : 'Fullscreen tools'}
        >
          <button
            type="button"
            onClick={onPrintChat}
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-700/70 transition cursor-pointer"
            title={lang === 'ar' ? 'طباعة المحادثة' : 'Print chat'}
          >
            <Printer className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onExportPdf}
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-700/70 transition cursor-pointer"
            title={lang === 'ar' ? 'تصدير كملف PDF' : 'Export as PDF'}
          >
            <FileDown className="w-4 h-4" />
          </button>

          <span className="w-px h-5 bg-slate-700 mx-0.5" />

          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(0, z - 1))}
            disabled={zoomLevel === 0}
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-700/70 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title={lang === 'ar' ? 'تصغير الخط' : 'Decrease text size'}
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[10px] font-mono font-bold text-indigo-300 w-8 text-center select-none">
            {100 + zoomLevel * 12}%
          </span>
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(3, z + 1))}
            disabled={zoomLevel === 3}
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-700/70 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title={lang === 'ar' ? 'تكبير الخط' : 'Increase text size'}
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <span className="w-px h-5 bg-slate-700 mx-0.5" />

          <button
            type="button"
            onClick={onToggleFullscreen}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold transition cursor-pointer"
            title={lang === 'ar' ? 'الخروج من ملء الشاشة (Esc)' : 'Exit fullscreen (Esc)'}
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span>{lang === 'ar' ? 'خروج' : 'Exit'}</span>
          </button>
        </div>
      )}

      {/* Follow-up Suggestions Bar */}
      {suggestions.length > 0 && !isLoading && (
        <div className="no-print px-4 py-2 bg-white/60 border-t border-slate-200/80 shrink-0">
          <FollowUpSuggestions
            suggestions={suggestions}
            lang={lang}
            onSuggestionClick={(q) => {
              setInputPrompt(q);
              onSendMessage(q);
            }}
            isLoading={isLoading}
          />
        </div>
      )}

      {/* Modern Input Bar */}
      <div className="no-print p-4 pt-2 bg-gradient-to-t from-white via-white to-transparent shrink-0">
        <div className="max-w-4xl mx-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSendMessage();
            }}
            className="relative flex items-end bg-white rounded-3xl shadow-md border border-slate-200 focus-within:ring-4 focus-within:ring-indigo-500/15 focus-within:border-indigo-400 transition-all group"
          >
            {/* Mode Selector */}
            <div className="relative group/mode ml-2 rtl:ml-0 rtl:mr-2 mb-1">
              <button
                type="button"
                onClick={() => setShowModeMenu(!showModeMenu)}
                className="w-10 h-10 rounded-full hover:bg-slate-100 transition flex items-center justify-center shrink-0 cursor-pointer"
                title={lang === 'ar' ? 'وضع المحادثة' : 'Chat Mode'}
              >
                {modeIcon(selectedMode)}
              </button>
              {showModeMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowModeMenu(false)} />
                  <div
                    className={`absolute bottom-full mb-2 p-2 bg-white rounded-xl shadow-xl border border-slate-200 w-52 z-30 animate-fadeIn ${
                      lang === 'ar' ? 'left-0' : 'left-0'
                    }`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1.5 px-2">
                      {lang === 'ar' ? 'وضع المحادثة' : 'Chat Mode'}
                    </div>
                    {(['hybrid', 'private', 'general', 'analysis'] as ChatMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setSelectedMode(m);
                          setShowModeMenu(false);
                        }}
                        className={`w-full px-2.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
                          selectedMode === m ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        {modeIcon(m)}
                        <span className="truncate">{modeLabel(m, lang)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={
                lang === 'ar'
                  ? 'اكتب سؤالك هنا... (Enter للإرسال، Shift+Enter لسطر جديد)'
                  : 'Type your question... (Enter to send, Shift+Enter for new line)'
              }
              className="flex-1 px-2 py-3.5 bg-transparent focus:outline-none text-sm text-slate-900 placeholder:text-slate-400 font-medium resize-none max-h-[200px] leading-relaxed"
              style={{ minHeight: '44px' }}
            />

            {/* Send / Stop Button */}
            {isLoading && onStopGeneration ? (
              <button
                type="button"
                onClick={onStopGeneration}
                className="w-10 h-10 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center transition-all shadow-sm cursor-pointer shrink-0 mb-1 mr-1 rtl:mr-0 rtl:ml-1 animate-pulse"
                title={lang === 'ar' ? 'إيقاف التوليد' : 'Stop generating'}
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!inputPrompt.trim()}
                className="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white flex items-center justify-center transition-all shadow-sm cursor-pointer disabled:cursor-not-allowed group-focus-within:scale-105 shrink-0 mb-1 mr-1 rtl:mr-0 rtl:ml-1"
              >
                <Send className={`w-4 h-4 ${lang === 'ar' ? 'rtl:-scale-x-100' : ''}`} />
              </button>
            )}
          </form>
          <div className="mt-2 text-center text-[10px] text-slate-400 font-mono flex items-center justify-center gap-1.5">
            <Sparkles className="w-3 h-3 text-indigo-400" />
            <span>{lang === 'ar' ? 'OmniRAG — ذاكرة المحادثة نشطة' : 'OmniRAG — Conversation memory active'}</span>
            {/* Regenerate last answer */}
            {onRegenerate && !isLoading && messages.some((m) => m.role === 'assistant') && (
              <button
                type="button"
                onClick={onRegenerate}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 text-slate-500 transition cursor-pointer"
                title={lang === 'ar' ? 'إعادة توليد آخر إجابة' : 'Regenerate last answer'}
              >
                <RotateCcw className="w-3 h-3" />
                <span>{lang === 'ar' ? 'إعادة التوليد' : 'Regenerate'}</span>
              </button>
            )}
            {/* Character counter */}
            {inputPrompt.length > 0 && <span className="text-slate-400 tabular-nums">{inputPrompt.length}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};
