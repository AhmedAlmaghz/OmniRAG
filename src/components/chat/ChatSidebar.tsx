'use client';

import React, { useState, useMemo } from 'react';
import { Plus, MessageSquare, Pencil, Trash2, Check, X, Search, PanelLeftClose, Sparkles } from 'lucide-react';
import { Conversation } from '@/lib/types/omnirag';

interface ChatSidebarProps {
  conversations: Conversation[];
  activeConversationId: string;
  isLoading: boolean;
  lang: 'ar' | 'en';
  isOpen: boolean;
  onToggle: () => void;
  onSelectConversation: (convId: string) => void;
  onCreateNew: () => void;
  onDeleteConversation: (convId: string, e: React.MouseEvent) => void;
  onRenameConversation: (convId: string, newTitle: string) => void;
}

/**
 * Inline conversation sidebar. When `isOpen` is true, the column takes
 * 300px; when false, it collapses to 0 with a smooth width transition so
 * the chat surface always fills the remaining viewport.
 */
export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  conversations,
  activeConversationId,
  isLoading,
  lang,
  isOpen,
  onToggle,
  onSelectConversation,
  onCreateNew,
  onDeleteConversation,
  onRenameConversation,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const isRtl = lang === 'ar';

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (diffDays === 1) {
      return lang === 'ar' ? 'أمس' : 'Yesterday';
    }
    if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const handleStartRename = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingConvId(conv.id);
    setEditingTitle(conv.title);
  };

  const handleSaveRename = (convId: string) => {
    if (editingTitle.trim()) {
      onRenameConversation(convId, editingTitle.trim());
    }
    setEditingConvId(null);
  };

  const handleCancelRename = () => {
    setEditingConvId(null);
    setEditingTitle('');
  };

  return (
    <aside
      className={`flex flex-col h-full bg-slate-50 border-slate-200 overflow-hidden transition-all duration-300 ease-in-out shrink-0 ${
        isOpen ? 'w-[300px] opacity-100' : 'w-0 opacity-0'
      } ${isRtl ? 'border-l' : 'border-r'}`}
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      aria-hidden={!isOpen}
    >
      {/* Sidebar Header */}
      <div className="p-3 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-sm shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold text-slate-800 truncate">OmniRAG</span>
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer shrink-0"
            title={lang === 'ar' ? 'طي الشريط الجانبي' : 'Collapse sidebar'}
          >
            <PanelLeftClose className={`w-4 h-4 text-slate-500 ${isRtl ? 'rtl:-scale-x-100' : ''}`} />
          </button>
        </div>

        {/* New Chat Button */}
        <button
          type="button"
          onClick={onCreateNew}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>{lang === 'ar' ? 'محادثة جديدة' : 'New Chat'}</span>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-slate-100 shrink-0">
        <div className="relative">
          <Search
            className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 ${isRtl ? 'right-3' : 'left-3'}`}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={lang === 'ar' ? 'بحث في المحادثات...' : 'Search conversations...'}
            className={`w-full bg-white border border-slate-200 text-xs placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 transition py-2 ${
              isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'
            }`}
          />
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {isLoading ? (
          <div className="py-8 text-center">
            <div className="w-6 h-6 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin mx-auto mb-2" />
            <p className="text-[11px] text-slate-400">{lang === 'ar' ? 'جاري التحميل...' : 'Loading...'}</p>
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="py-8 text-center px-4">
            <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400">
              {searchQuery
                ? lang === 'ar'
                  ? 'لا توجد نتائج مطابقة'
                  : 'No matching results'
                : lang === 'ar'
                  ? 'لا توجد محادثات بعد'
                  : 'No conversations yet'}
            </p>
          </div>
        ) : (
          filteredConversations.map((conv) => {
            const isActive = conv.id === activeConversationId;
            const isEditing = editingConvId === conv.id;

            return (
              <div
                key={conv.id}
                onClick={() => {
                  if (!isEditing) {
                    onSelectConversation(conv.id);
                  }
                }}
                className={`group relative rounded-xl px-3 py-2.5 cursor-pointer transition-all duration-200 ${
                  isActive ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-white text-slate-700 hover:shadow-sm'
                }`}
              >
                {isActive && (
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 w-1 h-8 bg-white/90 rounded-full ${
                      isRtl ? 'right-0 rounded-l-full' : 'left-0 rounded-r-full'
                    }`}
                  />
                )}

                {isEditing ? (
                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(conv.id);
                        if (e.key === 'Escape') handleCancelRename();
                      }}
                      className={`flex-1 px-2 py-1 rounded-lg text-xs border focus:outline-none ${
                        isActive
                          ? 'bg-indigo-700 border-indigo-500 text-white'
                          : 'bg-white border-slate-200 text-slate-800'
                      }`}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveRename(conv.id)}
                      className={`p-1 rounded-md transition cursor-pointer ${
                        isActive
                          ? 'bg-emerald-500 hover:bg-emerald-400 text-white'
                          : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelRename}
                      className={`p-1 rounded-md transition cursor-pointer ${
                        isActive
                          ? 'bg-indigo-500 hover:bg-indigo-400 text-white'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-500'
                      }`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <MessageSquare
                        className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-200' : 'text-slate-400'}`}
                      />
                      <span className={`text-xs font-semibold truncate flex-1 ${isActive ? 'text-white' : ''}`}>
                        {conv.title}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          isActive ? 'bg-indigo-500/40 text-indigo-100' : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        {conv.mode}
                      </span>
                      <span className={`text-[10px] ${isActive ? 'text-indigo-200' : 'text-slate-400'}`}>
                        {formatDate(conv.updatedAt)}
                      </span>
                    </div>

                    <div
                      className={`absolute top-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 ${
                        isRtl ? 'left-2' : 'right-2'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => handleStartRename(conv, e)}
                        className={`p-1 rounded-md transition cursor-pointer ${
                          isActive ? 'hover:bg-indigo-500 text-indigo-200' : 'hover:bg-slate-200 text-slate-500'
                        }`}
                        title={lang === 'ar' ? 'إعادة تسمية' : 'Rename'}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => onDeleteConversation(conv.id, e)}
                        className={`p-1 rounded-md transition cursor-pointer ${
                          isActive
                            ? 'hover:bg-rose-500 text-indigo-200'
                            : 'hover:bg-rose-100 text-slate-500 hover:text-rose-600'
                        }`}
                        title={lang === 'ar' ? 'حذف' : 'Delete'}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Sidebar Footer */}
      <div className="p-3 border-t border-slate-200 bg-white shrink-0">
        <p className="text-[10px] text-slate-400 text-center font-mono">
          {lang === 'ar' ? 'حفظ تلقائي في PostgreSQL' : 'Auto-saved to PostgreSQL'}
        </p>
      </div>
    </aside>
  );
};
