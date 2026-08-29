/**
 * SVG sanitizer for model-generated diagram output (mermaid).
 *
 * Chat messages and ingested documents can embed diagram code, and the
 * rendered SVG is injected into the DOM via dangerouslySetInnerHTML. DOMPurify
 * is the sanitizer; this module centralizes the configuration so every sink
 * (today: MermaidBlock; future: other LLM-authored SVG) shares one audited
 * allow-list instead of per-call-site options drifting apart.
 *
 * Hard guarantees:
 *  - <script>, event-handler attributes (onload/...), and javascript:/vbscript:
 *    and data: URIs are removed by DOMPurify + the afterSanitizeAttributes
 *    hook below (jsdom coverage showed href/xlink:href data: URIs survive the
 *    default ALLOWED_URI_REGEXP, so the hook is belt-and-braces).
 *  - Only the SVG profile is allowed; foreignObject is whitelisted because
 *    mermaid emits it for labels, and its (HTML) children still pass through
 *    the same DOMPurify pass.
 *  - The sanitizer is idempotent: sanitize(sanitize(x)) === sanitize(x).
 */

import DOMPurify from 'dompurify';

/** URIs that must never survive sanitization in any href/src attribute. */
const DANGEROUS_URI_RE = /^\s*(javascript|vbscript|data):/i;

/** Attribute names whose values are URI-typed. */
const URI_ATTRS = new Set(['href', 'xlink:href', 'src', 'poster', 'background', 'cite', 'action', 'formaction']);

let hookInstalled = false;

/** Install the URI-scrubbing hook once per DOMPurify instance. */
function ensureHook(): void {
  if (hookInstalled) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // Element-only scrub; text nodes have no attributes.
    if (!node || typeof (node as Element).getAttribute !== 'function') return;
    const el = node as Element;
    for (const attr of Array.from(el.attributes)) {
      if (URI_ATTRS.has(attr.name.toLowerCase()) && DANGEROUS_URI_RE.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  hookInstalled = true;
}

/** DOMPurify configuration for LLM-authored SVG diagrams. */
const SANITIZE_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  // mermaid emits <foreignObject> for HTML labels; contents are still sanitized.
  ADD_TAGS: ['foreignObject'],
  // No data-* attributes are needed by mermaid output.
  ALLOW_DATA_ATTR: false,
  // Defense in depth beyond the hook: no <style> blocks (mermaid's strict mode
  // doesn't emit them, and inline styles inside SVG are attack surface).
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['style'],
};

/**
 * Sanitize a rendered SVG string (or any HTML fragment) so it is safe to
 * inject via dangerouslySetInnerHTML. Returns an empty string for nullish
 * input; never throws (a failed sanitize must degrade to "nothing rendered",
 * not to raw injection).
 */
export function sanitizeSvg(svg: string | null | undefined): string {
  if (!svg) return '';
  try {
    ensureHook();
    return DOMPurify.sanitize(svg, SANITIZE_CONFIG);
  } catch {
    // Sanitizer failure = render nothing. Never fall back to the unsanitized
    // string; an empty diagram is a visible-but-safe degradation.
    return '';
  }
}
