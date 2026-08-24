'use client';

/**
 * Clipboard write with a legacy fallback and honest success reporting.
 *
 * The knowledge-module components used to call `navigator.clipboard.writeText`
 * bare: the call REJECTS on permission denial or insecure (http) contexts, so
 * users saw a "copied!" toast while nothing was copied. Every UI copy action
 * should go through this helper and only celebrate when it actually worked.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
