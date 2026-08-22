import zlib from 'node:zlib';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFArray, PDFRef, decodePDFRawStream } from 'pdf-lib';

/**
 * LOCAL OCR fallback — zero network APIs, zero cloud keys.
 *
 * Serves two purposes in the ingestion pipeline:
 *  1. Scanned / image-only PDFs: extracts the embedded page images straight
 *     from the PDF object tree (no renderer needed), feeds them to the
 *     WebAssembly Tesseract engine, and returns plain text.
 *  2. Standalone image files: OCR applied directly to the buffer.
 *
 * Quality note: Tesseract offline output is weaker than Mistral/Gemini OCR —
 * it is deliberately wired as the LAST fallback so cloud engines keep
 * priority whenever their keys are configured.
 */

// ---------------------------------------------------------------------------
// PNG construction (for FlateDecode image XObjects)
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let crcTable: Int32Array | null = null;
function getCrcTable(): Int32Array {
  if (crcTable) return crcTable;
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  crcTable = table;
  return table;
}

function crc32(buf: Buffer): number {
  const table = getCrcTable();
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

/** Wraps raw 8-bit gray/RGB pixel rows into a valid PNG buffer. */
function buildPng(width: number, height: number, isRgb: boolean, rawPixels: Buffer): Buffer {
  const bytesPerPixel = isRgb ? 3 : 1;
  const bytesPerRow = width * bytesPerPixel;
  if (rawPixels.length < bytesPerRow * height) {
    throw new Error(`Pixel buffer too small: ${rawPixels.length} < ${bytesPerRow * height}`);
  }

  // PNG scanlines are prefixed with a filter-type byte (0 = None).
  const scanlines = Buffer.alloc((bytesPerRow + 1) * height);
  for (let y = 0; y < height; y++) {
    const dst = y * (bytesPerRow + 1);
    scanlines[dst] = 0;
    rawPixels.copy(scanlines, dst + 1, y * bytesPerRow, (y + 1) * bytesPerRow);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = isRgb ? 2 : 0; // color type: 2 = truecolor RGB, 0 = grayscale
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Image XObject extraction from PDF pages
// ---------------------------------------------------------------------------

/** Resolves a stream filter name to 'jpeg' | 'flate' | 'jpx' | 'other'. */
function classifyFilter(filter: unknown): 'jpeg' | 'flate' | 'jpx' | 'other' {
  const names: string[] = [];
  if (filter instanceof PDFArray) {
    for (let i = 0; i < filter.size(); i++) names.push(String(filter.get(i)));
  } else if (filter) {
    names.push(String(filter));
  }
  if (names.some((n) => n.includes('DCTDecode'))) return 'jpeg';
  if (names.some((n) => n.includes('JPXDecode'))) return 'jpx';
  if (names.some((n) => n.includes('FlateDecode'))) return 'flate';
  return 'other';
}

/**
 * Extracts every image drawn by each page, in page order, as PNG/JPEG
 * buffers ready for OCR.
 *
 * Draw order is recovered from the page content streams (`/Name Do`
 * operators) so shared resource dictionaries don't scramble page order, and
 * object refs are deduplicated so an image drawn on many pages is captured
 * once.
 */
export async function extractImagesFromPdf(pdfBuffer: Buffer, maxImages = 200): Promise<Buffer[]> {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const images: Buffer[] = [];
  const seenRefs = new Set<string>();

  for (const page of doc.getPages()) {
    if (images.length >= maxImages) break;

    // Concatenate the page's content streams to find drawn XObject names.
    let contentText = '';
    const contentsRaw = page.node.get(PDFName.of('Contents'));
    const contentsResolved = contentsRaw ? doc.context.lookup(contentsRaw) : undefined;
    const contentItems: unknown[] = [];
    if (contentsResolved instanceof PDFArray) {
      for (let i = 0; i < contentsResolved.size(); i++) contentItems.push(contentsResolved.get(i));
    } else if (contentsResolved instanceof PDFRawStream) {
      contentItems.push(contentsResolved);
    } else if (contentsRaw) {
      contentItems.push(contentsRaw);
    }
    for (const item of contentItems) {
      const stream = doc.context.lookup(item as PDFRef);
      if (stream instanceof PDFRawStream) {
        try {
          contentText += Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
        } catch {
          // Undecodable content stream — fall back to dictionary order below.
        }
      }
    }

    const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
    if (!xobjects) continue;

    const drawnNames = [...contentText.matchAll(/\/([\w\-.+]+)\s+Do/g)].map((m) => m[1]);
    const allNames = xobjects.entries().map(([name]) => name.toString().replace(/^\//, ''));
    const namesToTry = drawnNames.length > 0 ? drawnNames : allNames;

    for (const name of namesToTry) {
      if (images.length >= maxImages) break;
      const value = xobjects.get(PDFName.of(name));
      if (!(value instanceof PDFRef)) continue;
      const dedupeKey = `${value.objectNumber}:${value.generationNumber}`;
      if (seenRefs.has(dedupeKey)) continue;

      const stream = doc.context.lookup(value);
      if (!(stream instanceof PDFRawStream)) continue;
      if (stream.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;

      const width = Number(stream.dict.get(PDFName.of('Width'))?.toString() || 0);
      const height = Number(stream.dict.get(PDFName.of('Height'))?.toString() || 0);
      const bpc = Number(stream.dict.get(PDFName.of('BitsPerComponent'))?.toString() || 8);
      const colorSpace = stream.dict.get(PDFName.of('ColorSpace'))?.toString() || '';
      const filterKind = classifyFilter(stream.dict.get(PDFName.of('Filter')));

      // Skip masks, tiny decorations, CMYK and 1-bit images Tesseract can't use.
      const isMask = stream.dict.get(PDFName.of('ImageMask')) !== undefined;
      const usableColor =
        colorSpace.includes('DeviceRGB') ||
        colorSpace.includes('DeviceGray') ||
        colorSpace.includes('CalRGB') ||
        colorSpace.includes('CalGray');
      if (isMask || width < 50 || height < 50 || bpc !== 8) continue;

      try {
        if (filterKind === 'jpeg') {
          // DCTDecode streams ARE JPEG bytes.
          images.push(Buffer.from(stream.contents));
          seenRefs.add(dedupeKey);
        } else if (filterKind === 'flate' && usableColor) {
          const raw = zlib.inflateSync(Buffer.from(stream.contents));
          const isRgb = colorSpace.includes('RGB') || colorSpace.includes('CalRGB');
          if (isRgb || colorSpace.includes('Gray') || colorSpace.includes('CalGray')) {
            images.push(buildPng(width, height, isRgb, raw));
            seenRefs.add(dedupeKey);
          }
        }
        // 'jpx' (JPEG2000) and exotic filters are skipped — cloud OCR covers them.
      } catch (err: any) {
        console.warn(`[localOcr] Failed to convert image ${name}:`, err?.message);
      }
    }
  }

  return images;
}

// ---------------------------------------------------------------------------
// Tesseract worker (singleton — model init is expensive)
// ---------------------------------------------------------------------------

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>;

let workerPromise: Promise<TesseractWorker> | null = null;

/**
 * Lazily boots a shared Tesseract worker. Arabic + English covers the app's
 * bilingual documents (Arabic prose + Latin/numeric formulas). Uses the
 * default `fast` trained models — downloaded once and cached; the `best`
 * variants were evaluated and rejected (2–3× slower for marginal gains).
 */
async function getTesseractWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js')
      .then(({ createWorker }) => createWorker('ara+eng'))
      .catch((err) => {
        workerPromise = null; // allow a later retry
        throw err;
      });
  }
  return workerPromise;
}

/** OCRes a single image buffer (PNG/JPEG) to plain text. */
export async function ocrImageBuffer(image: Buffer): Promise<string> {
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(image);
  return (data.text || '').trim();
}

/**
 * LOCAL OCR for a PDF buffer: extracts page images and recognizes them
 * sequentially. Returns '' when the PDF carries no usable raster images.
 */
export async function ocrPdfLocally(pdfBuffer: Buffer, opts: { maxPages?: number } = {}): Promise<string> {
  const images = await extractImagesFromPdf(pdfBuffer, opts.maxPages ?? 200);
  if (images.length === 0) return '';

  const texts: string[] = [];
  for (let i = 0; i < images.length; i++) {
    try {
      const text = await ocrImageBuffer(images[i]);
      if (text) texts.push(`### [صفحة ${i + 1}]\n${text}`);
    } catch (err: any) {
      console.warn(`[localOcr] Page ${i + 1} recognition failed:`, err?.message);
    }
  }
  return texts.join('\n\n');
}
