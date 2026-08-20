/**
 * chatExport.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Chat transcript export utilities.
 *
 * Two distinct outputs:
 *  • `printChatTranscript()` — opens the native print dialog (window.print),
 *    styled by the `@media print` rules in globals.css.
 *  • `exportChatAsPdf()` — generates a real PDF file and downloads it
 *    directly (no print dialog). The transcript is cloned into an off-screen,
 *    light-themed, fixed-width container, rasterized with html2canvas-pro
 *    (oklch-aware, so Tailwind v4 colors work), then sliced into A4 pages
 *    with jsPDF.
 */

import type { Message } from '@/lib/types/omnirag';

/** A4 portrait dimensions in points (jsPDF's default unit). */
const PAGE_WIDTH_PT = 595.28;
const PAGE_HEIGHT_PT = 841.89;
const PAGE_MARGIN_PT = 36;
/** Off-screen render width in px — roughly matches A4's printable width. */
const RENDER_WIDTH_PX = 794;

/**
 * Print the current chat transcript via the native print dialog.
 * A short delay lets the browser finish pending layout before printing.
 */
export function printChatTranscript() {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => window.print(), 150);
}

/**
 * Build an off-screen clone of the message stream prepared for PDF capture:
 * light theme forced, fixed page-like width, no zoom, no scroll clipping.
 */
function buildPdfClone(): HTMLElement | null {
  const stream = document.querySelector<HTMLElement>('.print-chat-stream');
  if (!stream) return null;

  const host = document.createElement('div');
  host.className = 'pdf-export-host';
  host.style.cssText = [
    'position:fixed',
    'top:0',
    'left:-99999px',
    `width:${RENDER_WIDTH_PX}px`,
    'background:#ffffff',
    'color:#0f172a',
    'z-index:-1',
    'pointer-events:none',
  ].join(';');

  const clone = stream.cloneNode(true) as HTMLElement;
  clone.style.cssText = [
    'height:auto',
    'max-height:none',
    'overflow:visible',
    'padding:24px 28px',
    'background:#ffffff',
    'color:#0f172a',
    'zoom:1',
  ].join(';');
  clone.removeAttribute('data-zoom');

  host.appendChild(clone);
  document.body.appendChild(host);
  return host;
}

/**
 * Export the transcript as a real PDF file (downloaded directly).
 *
 * Returns `true` on success, `false` when the stream is missing or the
 * capture failed (callers can then fall back to the print dialog).
 */
export async function exportChatAsPdf(title?: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const host = buildPdfClone();
  if (!host) return false;

  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);

    // Give web fonts a beat to settle inside the clone before rasterizing.
    await document.fonts?.ready?.catch(() => {});
    await new Promise((r) => setTimeout(r, 120));

    const canvas = await html2canvas(host, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: RENDER_WIDTH_PX,
    });
    if (canvas.width === 0 || canvas.height === 0) return false;

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    const contentWidthPt = PAGE_WIDTH_PT - PAGE_MARGIN_PT * 2;
    const contentHeightPt = PAGE_HEIGHT_PT - PAGE_MARGIN_PT * 2;

    // Pixels of source canvas that fit on one page, preserving aspect ratio.
    const pxPerPt = canvas.width / contentWidthPt;
    const sliceHeightPx = Math.floor(contentHeightPt * pxPerPt);

    let renderedPx = 0;
    let pageIndex = 0;
    while (renderedPx < canvas.height) {
      const currentSlicePx = Math.min(sliceHeightPx, canvas.height - renderedPx);

      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = currentSlicePx;
      const ctx = pageCanvas.getContext('2d');
      if (!ctx) return false;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, renderedPx, canvas.width, currentSlicePx, 0, 0, canvas.width, currentSlicePx);

      if (pageIndex > 0) pdf.addPage();
      const sliceHeightPt = currentSlicePx / pxPerPt;
      pdf.addImage(
        pageCanvas.toDataURL('image/jpeg', 0.92),
        'JPEG',
        PAGE_MARGIN_PT,
        PAGE_MARGIN_PT,
        contentWidthPt,
        sliceHeightPt,
      );

      renderedPx += currentSlicePx;
      pageIndex += 1;
    }

    const safeName = (title || 'omnirag-chat').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);
    pdf.save(`${safeName}-${new Date().toISOString().slice(0, 10)}.pdf`);
    return true;
  } catch (err) {
    console.error('PDF export failed:', err);
    return false;
  } finally {
    host.remove();
  }
}

/**
 * Build a plain-text transcript (used for copy-to-clipboard and fallback
 * downloads).
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
