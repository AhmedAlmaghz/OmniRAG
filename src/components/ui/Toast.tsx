'use client';

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';

/**
 * App-wide toast notification system.
 *
 * Replaces the scattered `alert()` calls and inline status banners with one
 * consistent, accessible, RTL-aware notification surface. Usage:
 *
 *   const { toast } = useToast();
 *   toast({ title: 'تم الحذف', variant: 'success' });
 *
 * Mount <ToastProvider /> once near the app root (MainApp). Toasts announce
 * themselves via an aria-live region, auto-dismiss, and can be closed manually.
 */

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  title: string;
  message?: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. Defaults to 4200. Pass 0 to keep it sticky. */
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastOptions, 'message'>> {
  id: number;
  message?: string;
  leaving: boolean;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fail loudly in development; silently no-op in production so a missing
    // provider never crashes the UI.
    if (process.env.NODE_ENV !== 'production') {
      throw new Error('useToast must be used within a <ToastProvider />');
    }
    return { toast: () => {} };
  }
  return ctx;
}

const VARIANT_STYLES: Record<ToastVariant, { icon: React.ElementType; accent: string; iconColor: string }> = {
  success: { icon: CheckCircle2, accent: 'border-emerald-300/70', iconColor: 'text-emerald-500' },
  error: { icon: XCircle, accent: 'border-rose-300/70', iconColor: 'text-rose-500' },
  warning: { icon: AlertTriangle, accent: 'border-amber-300/70', iconColor: 'text-amber-500' },
  info: { icon: Info, accent: 'border-indigo-300/70', iconColor: 'text-indigo-500' },
};

const DEFAULT_DURATION = 4200;
const EXIT_ANIMATION_MS = 200;
const MAX_VISIBLE_TOASTS = 4;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    // Mark as leaving so the exit animation plays, then remove.
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_ANIMATION_MS);
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      const item: ToastItem = {
        id,
        title: options.title,
        message: options.message,
        variant: options.variant || 'info',
        duration: options.duration ?? DEFAULT_DURATION,
        leaving: false,
      };
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLE_TOASTS - 1)), item]);
      if (item.duration > 0) {
        const timer = setTimeout(() => dismiss(id), item.duration);
        timers.current.set(id, timer);
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live region so screen readers announce notifications */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col-reverse gap-2 w-[min(92vw,380px)] pointer-events-none"
      >
        {toasts.map((t) => {
          const style = VARIANT_STYLES[t.variant];
          const Icon = style.icon;
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-3 bg-white dark:bg-slate-800 border ${style.accent} rounded-2xl shadow-lg px-4 py-3 toast-enter ${
                t.leaving ? 'toast-exit' : ''
              }`}
            >
              <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${style.iconColor}`} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">{t.title}</p>
                {t.message && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{t.message}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="إغلاق الإشعار"
                className="shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
