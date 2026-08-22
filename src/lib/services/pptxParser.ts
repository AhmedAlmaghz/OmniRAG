import JSZip from 'jszip';

/**
 * LOCAL PowerPoint (.pptx) parser — zero network, zero API keys.
 *
 * A .pptx file is a ZIP archive of XML parts. Slide text lives in
 * `ppt/slides/slideN.xml` as DrawingML: paragraphs `<a:p>` containing runs
 * `<a:r>` whose text sits in `<a:t>…</a:t>`. Speaker notes live in
 * `ppt/notesSlides/notesSlideN.xml` with the same vocabulary.
 *
 * The parser walks the archive, orders slides numerically, and emits clean
 * Markdown (`### Slide N` headers) so the output feeds the normal chunking
 * pipeline exactly like any other extracted document.
 */

const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;
const NOTES_RE = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/;

/** Decodes XML entities (&amp; last so `&amp;lt;` stays `&lt;`, not `<`). */
function decodeXmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Extracts readable text from a DrawingML part. Paragraph boundaries
 * (`</a:p>`) become line breaks; `<a:br/>` also forces a line break.
 */
function extractDrawingMlText(xml: string): string {
  const withBreaks = xml.replace(/<a:br\s*\/>/g, '\n');
  const lines: string[] = [];
  for (const paragraph of withBreaks.split(/<\/a:p>/)) {
    const runs = [...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
    const line = runs
      .join('')
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

export interface LocalPptxResult {
  text: string;
  slideCount: number;
}

/**
 * Extracts all slide + speaker-note text from a .pptx buffer as Markdown.
 * Returns an empty string when the archive contains no readable text.
 */
export async function parsePptxLocally(fileBuffer: Buffer): Promise<LocalPptxResult> {
  const zip = await JSZip.loadAsync(fileBuffer);

  const slides = new Map<number, string>(); // slideNumber → xml
  const notes = new Map<number, string>();
  for (const name of Object.keys(zip.files)) {
    const slideMatch = SLIDE_RE.exec(name);
    if (slideMatch) {
      slides.set(parseInt(slideMatch[1], 10), name);
      continue;
    }
    const notesMatch = NOTES_RE.exec(name);
    if (notesMatch) notes.set(parseInt(notesMatch[1], 10), name);
  }

  const sections: string[] = [];
  const orderedSlideNumbers = [...slides.keys()].sort((a, b) => a - b);

  for (const slideNumber of orderedSlideNumbers) {
    const slideXml = await zip.files[slides.get(slideNumber)!].async('string');
    const slideText = extractDrawingMlText(slideXml);

    let notesText = '';
    const notesName = notes.get(slideNumber);
    if (notesName) {
      const notesXml = await zip.files[notesName].async('string');
      notesText = extractDrawingMlText(notesXml);
    }

    if (slideText.trim() || notesText.trim()) {
      const parts: string[] = [];
      if (slideText.trim()) parts.push(slideText.trim());
      if (notesText.trim()) parts.push(`> ${langNotesLabel()}\n> ${notesText.trim().replace(/\n/g, '\n> ')}`);
      sections.push(`### Slide ${slideNumber}\n\n${parts.join('\n\n')}`);
    }
  }

  return { text: sections.join('\n\n'), slideCount: orderedSlideNumbers.length };
}

function langNotesLabel(): string {
  return 'Speaker Notes / ملاحظات المتحدث';
}

// ---------------------------------------------------------------------------
// Slide image extraction (for image-only decks exported as pictures)
// ---------------------------------------------------------------------------

/**
 * Extracts the media images referenced by each slide, in slide order.
 *
 * Some decks (design-tool exports) contain ZERO text — every slide is just a
 * full-bleed picture. For those, the local text parser finds nothing and the
 * fallback path OCRs these images instead.
 */
export async function extractSlideImagesFromPptx(fileBuffer: Buffer): Promise<Buffer[]> {
  const zip = await JSZip.loadAsync(fileBuffer);

  const slideNumbers = Object.keys(zip.files)
    .map((name) => SLIDE_RE.exec(name)?.[1])
    .filter((n): n is string => !!n)
    .map((n) => parseInt(n, 10))
    .sort((a, b) => a - b);

  const images: Buffer[] = [];
  for (const slideNumber of slideNumbers) {
    const slideXml = await zip.files[`ppt/slides/slide${slideNumber}.xml`].async('string');

    // Blip embed ids point at relationships in the slide's .rels part.
    const embedIds = [...slideXml.matchAll(/r:embed="(rId\d+)"/g)].map((m) => m[1]);
    if (embedIds.length === 0) continue;

    const relsName = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
    const relsFile = zip.files[relsName];
    if (!relsFile) continue;
    const relsXml = await relsFile.async('string');

    for (const rId of embedIds) {
      const relElement = [...relsXml.matchAll(/<Relationship\b[^>]*>/g)]
        .map((m) => m[0])
        .find((el) => el.includes(`Id="${rId}"`));
      if (!relElement) continue;
      const targetMatch = /Target="([^"]+)"/.exec(relElement);
      if (!targetMatch) continue;
      const mediaPath = 'ppt/' + targetMatch[1].replace(/^(\.\.\/)+/, '');
      const mediaFile = zip.files[mediaPath];
      if (!mediaFile) continue;
      const data = await mediaFile.async('nodebuffer');
      if (data.length > 0) images.push(Buffer.from(data));
    }
  }

  return images;
}
