/**
 * chatExport.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Chat transcript export utilities.
 *
 * PDF export is implemented through the browser's native print pipeline
 * (`window.print()` + "Save as PDF"): it is dependency-free, renders the
 * already-styled message stream (math, code, tables) exactly as on screen,
 * and works offline. The dedicated `@media print` rules in globals.css hide
 * all app chrome and force light, ink-friendly colors.
 */

import type { Message } from '@/lib/types/omnirag';

/**
 * Print the current chat transcript. The print stylesheet scopes output to
 * the `.print-chat-stream` container, so only the conversation is printed.
 *
 * A short delay lets the browser finish any pending layout (e.g. lazy-loaded
 * code highlighting) before opening the print dialog.
 */
export function printChatTranscript() {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => window.print(), 150);
}

/**
 * Export the transcript as a PDF file via the native print dialog.
 * Functionally identical to printing — the user picks "Save as PDF" as the
 * destination — but kept as a distinct entry point so the UI can label the
 * action correctly and so a future server-side renderer can replace it
 * without touching call sites.
 */
export function exportChatAsPdf() {
  printChatTranscript();
}

/**
 * Build a plain-text transcript (used for copy-to-clipboard and fallback
 * downloads). Keeps role labels bilingual-safe.
 */
export function buildTranscriptText(messages: Message[], title?: string): string {
  const lines: string[] = [];
  if (title) {
    lines.push(title, '='.repeat(Math.min(title.length, 60)), '');
  }
  for (const msg of messages) {
    const role = msg.role === 'user' ? '👤' : msg.role === 'assistant' ? '🤖' : '⚙️';
    const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : '';
    lines.push(`${role} ${time}`.trim());
    lines.push(msg.content);
    lines.push('');
  }
  return lines.join('\n');
}
