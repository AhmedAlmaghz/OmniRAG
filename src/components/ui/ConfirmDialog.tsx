'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, HelpCircle, Trash2 } from 'lucide-react';

/**
 * Accessible confirmation dialog replacing native `confirm()`.
 *
 * Native confirm dialogs are unstyled, untranslatable in tone, and block the
 * main thread. This component matches the app's design language, supports RTL,
 * traps focus while open, closes on Escape/backdrop click, and restores focus
 * to the invoking element on close.
 *
 * Usage:
 *   <ConfirmDialog
 *     open={!!pendingDelete}
 *     title="حذف المستند"
 *     message="هل تود حذف هذا المستند نهائياً؟"
 *     confirmLabel="حذف"
 *     variant="danger"
 *     onConfirm={() => doDelete()}
 *     onCancel={() => setPendingDelete(null)}
 *   />
 */

export type ConfirmVariant = 'danger' | 'warning' | 'default';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  /** When true the confirm button shows a spinner and is disabled. */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const VARIANT_CONFIG: Record<ConfirmVariant, { icon: React.ElementType; iconWrap: string; confirmBtn: string }> = {
  danger: {
    icon: Trash2,
    iconWrap: 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400',
    confirmBtn: 'bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600',
  },
  warning: {
    icon: AlertTriangle,
    iconWrap: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
    confirmBtn: 'bg-amber-600 hover:bg-amber-700 focus-visible:outline-amber-600',
  },
  default: {
    icon: HelpCircle,
    iconWrap: 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    confirmBtn: 'bg-indigo-600 hover:bg-indigo-700 focus-visible:outline-indigo-600',
  },
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  variant = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Focus the confirm button on open; restore focus on close.
  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement;
      // Delay one frame so the element is mounted before focusing.
      requestAnimationFrame(() => confirmBtnRef.current?.focus());
    } else if (previouslyFocused.current) {
      previouslyFocused.current.focus?.();
      previouslyFocused.current = null;
    }
  }, [open]);

  // Escape closes; Tab is trapped inside the dialog.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!loading) onCancel();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [loading, onCancel],
  );

  if (!open) return null;

  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onKeyDown={handleKeyDown}
        className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-3xl border border-slate-200/80 dark:border-slate-700 shadow-xl p-6 modal-enter"
      >
        <div className="flex items-start gap-4">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${config.iconWrap}`}>
            <Icon className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="confirm-dialog-title" className="text-base font-extrabold text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            <p id="confirm-dialog-message" className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
              {message}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 ${config.confirmBtn} text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-2xs disabled:opacity-60 flex items-center gap-1.5`}
          >
            {loading && (
              <span
                className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"
                aria-hidden="true"
              />
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
