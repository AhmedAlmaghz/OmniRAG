/**
 * Office document generation engines for the create_office_document /
 * build_report / create_tutorial_guide skills.
 *
 * Every builder is a pure function: structured spec in, file bytes out.
 * Heavy packages (docx, exceljs, pptxgenjs, jspdf) are lazy-imported inside
 * the builders so the MCP registry module graph stays light.
 *
 * Honesty rule: jsPDF's built-in fonts cannot shape Arabic script, so PDF
 * generation refuses Arabic content with a readable error that recommends
 * DOCX (Word renders Arabic natively) instead of emitting a garbled file.
 */

export type OfficeFormat = 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'md';

export interface DocumentSlide {
  title: string;
  bullets: string[];
}

export interface DocumentTable {
  columns: string[];
  rows: Array<Array<string | number>>;
}

export interface OfficeDocumentSpec {
  format: OfficeFormat;
  title: string;
  /** Markdown-lite body for text formats (docx / pdf / md). */
  content?: string;
  /** Spreadsheet data (xlsx). Parsed from `content` markdown tables when absent. */
  table?: DocumentTable;
  /** Presentation slides (pptx). Derived from `content` headings when absent. */
  slides?: DocumentSlide[];
  author?: string;
}

export const OFFICE_MIME_TYPES: Record<OfficeFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8',
};

export const OFFICE_EXTENSIONS: Record<OfficeFormat, string> = {
  docx: '.docx',
  xlsx: '.xlsx',
  pptx: '.pptx',
  pdf: '.pdf',
  md: '.md',
};

const ARABIC_PATTERN = /[\u0600-\u06FF\u0750-\u077F]/;

/** True when the text contains Arabic script characters. */
export function containsArabic(text: string): boolean {
  return ARABIC_PATTERN.test(text || '');
}

/** Strips inline markdown markers (**bold**, *italic*, `code`, [text](url)). */
function stripInlineMarkdown(text: string): string {
  return (text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .trim();
}

interface ParsedBlock {
  kind: 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'paragraph';
  text: string;
}

/** Minimal markdown block parser shared by the DOCX / PDF / PPTX builders. */
export function parseMarkdownBlocks(content: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  for (const rawLine of (content || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      blocks.push({ kind: (['h1', 'h2', 'h3'] as const)[h[1].length - 1], text: stripInlineMarkdown(h[2]) });
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      blocks.push({ kind: 'bullet', text: stripInlineMarkdown(bullet[1]) });
      continue;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      blocks.push({ kind: 'numbered', text: stripInlineMarkdown(numbered[1]) });
      continue;
    }
    blocks.push({ kind: 'paragraph', text: stripInlineMarkdown(line) });
  }
  return blocks;
}

/** Extracts the FIRST markdown table found in the content, if any. */
export function parseMarkdownTable(content: string): DocumentTable | null {
  const lines = (content || '').split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i].trim();
    const separator = lines[i + 1]?.trim() || '';
    if (!header.startsWith('|') || !/^\|?[\s:|-]+\|?$/.test(separator) || !separator.includes('-')) continue;

    const splitRow = (row: string) =>
      row
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => stripInlineMarkdown(c));

    const columns = splitRow(header);
    const rows: Array<Array<string | number>> = [];
    for (let j = i + 2; j < lines.length; j++) {
      const row = lines[j].trim();
      if (!row.startsWith('|')) break;
      rows.push(
        splitRow(row).map((cell) => {
          const num = Number(cell.replace(/,/g, ''));
          return cell !== '' && !isNaN(num) && /^-?[\d,.]+$/.test(cell.replace(/,/g, '')) ? num : cell;
        }),
      );
    }
    if (columns.length > 0) return { columns, rows };
  }
  return null;
}

/** Derives presentation slides from markdown headings (`##` starts a slide). */
export function deriveSlides(title: string, content: string): DocumentSlide[] {
  const blocks = parseMarkdownBlocks(content);
  const slides: DocumentSlide[] = [];
  let current: DocumentSlide | null = null;

  for (const block of blocks) {
    if (block.kind === 'h1' || block.kind === 'h2') {
      current = { title: block.text, bullets: [] };
      slides.push(current);
    } else if (block.kind === 'bullet' || block.kind === 'numbered' || block.kind === 'paragraph') {
      if (!current) {
        current = { title, bullets: [] };
        slides.push(current);
      }
      current.bullets.push(block.text);
    }
  }

  if (slides.length === 0) {
    slides.push({ title, bullets: blocks.map((b) => b.text).filter(Boolean) });
  }
  return slides;
}

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

async function buildDocx(spec: OfficeDocumentSpec): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } =
    await import('docx');

  const children: Array<InstanceType<typeof Paragraph | typeof Table>> = [];
  for (const block of parseMarkdownBlocks(spec.content || '')) {
    if (block.kind === 'h1') {
      children.push(new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_1 }));
    } else if (block.kind === 'h2') {
      children.push(new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_2 }));
    } else if (block.kind === 'h3') {
      children.push(new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_3 }));
    } else if (block.kind === 'bullet') {
      children.push(new Paragraph({ text: block.text, bullet: { level: 0 } }));
    } else if (block.kind === 'numbered') {
      children.push(new Paragraph({ children: [new TextRun(block.text)] }));
    } else {
      children.push(new Paragraph({ children: [new TextRun(block.text)] }));
    }
  }

  if (spec.table) {
    const { columns, rows } = spec.table;
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: columns.map((c) => new TableCell({ children: [new Paragraph({ text: String(c) })] })),
          }),
          ...rows.map(
            (row) =>
              new TableRow({
                children: columns.map((_, ci) => new TableCell({ children: [new Paragraph(String(row[ci] ?? ''))] })),
              }),
          ),
        ],
      }),
    );
  }

  const doc = new Document({
    creator: spec.author || 'OmniRAG',
    title: spec.title,
    sections: [{ children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function buildXlsx(spec: OfficeDocumentSpec): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = spec.author || 'OmniRAG';
  const sheet = workbook.addWorksheet(spec.title.slice(0, 31) || 'Sheet1');

  const table = spec.table || parseMarkdownTable(spec.content || '');
  if (table) {
    sheet.addRow(table.columns);
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    for (const row of table.rows) sheet.addRow(row);
    sheet.columns.forEach((col) => {
      col.width = Math.min(
        60,
        Math.max(12, ...(col.values || []).map((v) => String(v ?? '').length + 2).filter((n) => !isNaN(n))),
      );
    });
  } else {
    // No tabular data: write the plain-text content, one line per row.
    for (const line of (spec.content || spec.title).split(/\r?\n/)) sheet.addRow([stripInlineMarkdown(line)]);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildPptx(spec: OfficeDocumentSpec): Promise<Buffer> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.author = spec.author || 'OmniRAG';
  pptx.title = spec.title;

  const slides = spec.slides && spec.slides.length > 0 ? spec.slides : deriveSlides(spec.title, spec.content || '');
  const isArabic = containsArabic(spec.title + ' ' + JSON.stringify(slides));

  for (const slideSpec of slides) {
    const slide = pptx.addSlide();
    slide.addText(slideSpec.title, {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.9,
      fontSize: 28,
      bold: true,
      color: '1e1b4b',
      align: isArabic ? 'right' : 'left',
      rtlMode: isArabic,
    });
    if (slideSpec.bullets.length > 0) {
      slide.addText(
        slideSpec.bullets.map((b) => ({ text: b, options: { bullet: { code: '2022' }, breakLine: true } })),
        {
          x: 0.5,
          y: 1.5,
          w: 9,
          h: 5.2,
          fontSize: 16,
          color: '334155',
          align: isArabic ? 'right' : 'left',
          rtlMode: isArabic,
          valign: 'top',
        },
      );
    }
  }

  return Buffer.from((await pptx.write({ outputType: 'nodebuffer' })) as Buffer);
}

async function buildPdf(spec: OfficeDocumentSpec): Promise<Buffer> {
  const fullText = `${spec.title}\n${spec.content || ''}`;
  if (containsArabic(fullText)) {
    throw new Error(
      'توليد PDF بنصوص عربية غير مدعوم على الخادم (خطوط jsPDF القياسية لا تدعم تشكيل الحروف العربية). استخدم صيغة docx بدلًا منها — Word يعرض العربية بشكل كامل.',
    );
  }

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  for (const line of doc.splitTextToSize(spec.title, maxWidth)) {
    ensureSpace(24);
    doc.text(line, margin, y);
    y += 24;
  }
  y += 8;

  for (const block of parseMarkdownBlocks(spec.content || '')) {
    const style =
      block.kind === 'h1'
        ? { size: 16, bold: true, gap: 22 }
        : block.kind === 'h2'
          ? { size: 14, bold: true, gap: 20 }
          : block.kind === 'h3'
            ? { size: 12, bold: true, gap: 18 }
            : { size: 11, bold: false, gap: 16 };
    doc.setFont('helvetica', style.bold ? 'bold' : 'normal');
    doc.setFontSize(style.size);
    const prefix = block.kind === 'bullet' ? '-  ' : '';
    for (const line of doc.splitTextToSize(prefix + block.text, maxWidth)) {
      ensureSpace(style.gap);
      doc.text(line, margin, y);
      y += style.gap;
    }
    y += 4;
  }

  return Buffer.from(doc.output('arraybuffer') as ArrayBuffer);
}

function buildMarkdown(spec: OfficeDocumentSpec): Buffer {
  const parts = [`# ${spec.title}`];
  if (spec.content?.trim()) parts.push(spec.content.trim());
  if (spec.table) {
    const { columns, rows } = spec.table;
    parts.push(`| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`);
    for (const row of rows) parts.push(`| ${row.join(' | ')} |`);
  }
  return Buffer.from(parts.join('\n\n'), 'utf-8');
}

/**
 * Builds the requested file format and returns its bytes.
 * Throws readable errors for unsupported/invalid combinations — callers
 * surface them to the model verbatim (honest degradation).
 */
export async function buildOfficeDocument(spec: OfficeDocumentSpec): Promise<Buffer> {
  if (!spec.title?.trim()) throw new Error('عنوان المستند (title) مطلوب');
  const hasContent = Boolean(spec.content?.trim());
  const hasTable = Boolean(spec.table && spec.table.columns.length > 0);
  const hasSlides = Boolean(spec.slides && spec.slides.length > 0);
  if (!hasContent && !hasTable && !hasSlides) {
    throw new Error('لا يوجد محتوى للتوليد: مرّر content أو table أو slides');
  }

  switch (spec.format) {
    case 'docx':
      return buildDocx(spec);
    case 'xlsx':
      return buildXlsx(spec);
    case 'pptx':
      return buildPptx(spec);
    case 'pdf':
      return buildPdf(spec);
    case 'md':
      return buildMarkdown(spec);
    default:
      throw new Error(`صيغة غير مدعومة: ${String((spec as any).format)}`);
  }
}
