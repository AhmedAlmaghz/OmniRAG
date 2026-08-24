'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog (visible or visually-hidden). */
  ariaLabel?: string;
  /** id of the visible title element, wired via aria-labelledby. */
  ariaLabelledBy?: string;
  /** Max width utility class for the panel, e.g. 'max-w-2xl'. */
  maxWidthClass?: string;
  /** Close on Escape + backdrop click. Default true. */
  dismissible?: boolean;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Single accessible modal shell for the whole app.
 *
 * Before this primitive existed the identical shell — fixed overlay +
 * `rounded-3xl` panel + header X — was copy-pasted in 9 dialogs, each with a
 * DIFFERENT level of accessibility: most had no Escape handling, no backdrop
 * dismissal, no focus trap and no `role="dialog"`/`aria-modal`. This component
 * centralizes all of it:
 *
 *  - `role="dialog"` + `aria-modal` + label wiring
 *  - Escape-to-close and optional backdrop-click dismissal
 *  - a real focus trap cycling Tab within the dialog
 *  - focus moves to the panel on open and is RESTORED to the previously
 *    focused element on close
 *  - body scroll lock while open
 */
export function Modal({
  open,
  onClose,
  ariaLabel,
  ariaLabelledBy,
  maxWidthClass = 'max-w-2xl',
  dismissible = true,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Remember the trigger so focus returns to it on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Escape to close.
  useEffect(() => {
    if (!open || !dismissible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, dismissible, onClose]);

  // Body scroll lock while any modal is open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const handleTabKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null,
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={-1}
        onKeyDown={handleTabKey}
        autoFocus
        className={`bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full ${maxWidthClass} max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 outline-none`}
      >
        {children}
      </div>
    </div>
  );
}

/** Standard close (X) button used in modal headers. */
export function ModalCloseButton({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button
      onClick={onClose}
      aria-label={label}
      className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-slate-500 hover:text-slate-800 transition cursor-pointer"
    >
      <X className="w-4 h-4" />
    </button>
  );
}
