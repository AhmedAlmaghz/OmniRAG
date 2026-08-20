/**
 * rehypeKatexArabic.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * A rehype plugin that renders math nodes (`$…$`, `$$…$$`, ```math fences)
 * with the KaTeX4Arabic engine — Arabic-Indic numerals, translated function
 * and variable names (sin → جا, x → س), RTL mirroring — directly inside the
 * markdown AST.
 *
 * It mirrors the structure of `rehype-katex` (same node classes produced by
 * `remark-math`: `math-inline` / `math-display`, plus `language-math` code
 * fences) so it is a drop-in replacement. Rendering happens automatically at
 * parse time — no user interaction or post-mount DOM patching is required.
 *
 * The plugin is fully isomorphic: KaTeX itself renders to a plain HTML
 * string (no DOM required) and `fromHtmlIsomorphic` parses it on both the
 * server and the client, so SSR output and hydration stay identical.
 */

import type { Root, Element, ElementContent, Parent } from 'hast';
import { toText } from 'hast-util-to-text';
import { fromHtmlIsomorphic } from 'hast-util-from-html-isomorphic';
import { SKIP, visitParents } from 'unist-util-visit-parents';
import { renderArabicWithMeta, type PartialArabicOptions } from 'katex4arabic';

export interface RehypeKatexArabicOptions extends PartialArabicOptions {
  /** Color used for the inline error message when rendering fails. */
  errorColor?: string;
}

const EMPTY_CLASSES: readonly string[] = [];

export default function rehypeKatexArabic(options: RehypeKatexArabicOptions = {}) {
  const { errorColor = '#ef4444', ...arabicOptions } = options;

  return function transform(tree: Root) {
    visitParents(tree, 'element', (element, ancestors) => {
      const classes = Array.isArray(element.properties?.className)
        ? (element.properties.className as string[])
        : EMPTY_CLASSES;

      const languageMath = classes.includes('language-math');
      const mathDisplay = classes.includes('math-display');
      const mathInline = classes.includes('math-inline');
      if (!languageMath && !mathDisplay && !mathInline) return;

      let parent: Parent | undefined = ancestors[ancestors.length - 1];
      let scope: Element = element;
      let displayMode = mathDisplay;

      // ```math code fences: replace the whole <pre> and render as display.
      if (
        element.tagName === 'code' &&
        languageMath &&
        parent &&
        parent.type === 'element' &&
        (parent as Element).tagName === 'pre'
      ) {
        scope = parent as Element;
        parent = ancestors[ancestors.length - 2];
        displayMode = true;
      }
      if (!parent || parent.type !== 'element') return;
      const parentElement = parent as Element;

      const latex = toText(scope, { whitespace: 'pre' }).trim();
      if (!latex) return;

      const { html, error } = renderArabicWithMeta(latex, {
        ...arabicOptions,
        displayMode,
        throwOnError: false,
      });

      let result: ElementContent[];
      if (!error) {
        const fragment = fromHtmlIsomorphic(html, { fragment: true });
        result = fragment.children as ElementContent[];
      } else {
        // Graceful degradation: show the raw LaTeX with a visible hint so a
        // broken formula never disappears silently.
        result = [
          {
            type: 'element',
            tagName: 'span',
            properties: {
              className: ['katex-arabic-error'],
              dir: 'ltr',
              title: error,
              style: `color:${errorColor};font-family:ui-monospace,monospace;font-size:0.9em;`,
            },
            children: [{ type: 'text', value: latex }],
          },
        ];
      }

      const index = parentElement.children.indexOf(scope);
      if (index === -1) return;
      parentElement.children.splice(index, 1, ...result);
      return SKIP;
    });
  };
}
