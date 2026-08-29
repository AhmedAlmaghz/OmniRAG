// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeSvg } from '../lib/security/svgSanitizer';

/**
 * XSS regression guard for the mermaid SVG sink (RichMessageRenderer).
 * Diagram code comes from chat/LLM output, and the rendered SVG is injected
 * via dangerouslySetInnerHTML — every payload class below must come out clean.
 */

describe('sanitizeSvg — mermaid XSS guard', () => {
  it('strips <script> elements entirely', () => {
    const dirty = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>ok</text></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('alert(1)');
    expect(clean).toContain('ok');
  });

  it('strips event-handler attributes (onload/onerror/onclick)', () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg"><g onload="alert(2)"></g><image onerror="alert(3)" href="https://x/y.png"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain('onload');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('alert');
  });

  it('strips javascript: and data: URIs from href/xlink:href/src', () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
      '<a xlink:href="javascript:alert(4)"><text>x</text></a>' +
      '<image href="data:image/svg+xml;base64,PHN2Zy8+" />' +
      '<image href="https://example.com/pic.png" />' +
      '</svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('data:image/svg');
    expect(clean).toContain('https://example.com/pic.png');
  });

  it('keeps benign mermaid output intact (nodes, edges, labels, styles as attributes)', () => {
    const benign =
      '<svg xmlns="http://www.w3.org/2000/svg" class="excalidraw-svg">' +
      '<g transform="translate(80,80)"><rect width="100" height="40" fill="#e2e8f0" rx="4"/>' +
      '<text text-anchor="middle" font-size="16">مرحبا</text></g>' +
      '<path d="M10 10 C 20 20, 40 20, 50 10" stroke="#64748b" fill="none" marker-end="url(#arrow)"/>' +
      '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"/>' +
      '</svg>';
    const clean = sanitizeSvg(benign);
    expect(clean).toContain('<rect');
    expect(clean).toContain('مرحبا');
    expect(clean).toContain('<path');
    expect(clean).toContain('<marker');
    expect(clean).toContain('transform="translate(80,80)"');
  });

  it('keeps foreignObject (mermaid HTML labels) while sanitizing its contents', () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div onload="alert(5)">label</div>' +
      '<script>alert(6)</script></foreignObject></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).toContain('foreignObject');
    expect(clean).toContain('label');
    expect(clean).not.toContain('onload');
    expect(clean).not.toContain('<script');
  });

  it('blocks iframe/object/embed escapes and inline style payloads', () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg"><iframe src="https://evil.example"></iframe>' +
      '<style>body{background:url(javascript:alert(7))}</style></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('<style');
  });

  it('returns empty string for null/undefined/empty input — never throws', () => {
    expect(sanitizeSvg(null)).toBe('');
    expect(sanitizeSvg(undefined)).toBe('');
    expect(sanitizeSvg('')).toBe('');
  });

  it('is idempotent — sanitizing twice does not change the result', () => {
    const dirty = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>x</text></svg>';
    const once = sanitizeSvg(dirty);
    const twice = sanitizeSvg(once);
    expect(twice).toBe(once);
  });
});
