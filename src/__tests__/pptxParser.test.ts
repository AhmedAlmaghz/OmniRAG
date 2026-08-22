import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parsePptxLocally, extractSlideImagesFromPptx } from '../lib/services/pptxParser';

/** Builds a minimal in-memory .pptx with the given slides + media for tests. */
async function buildSyntheticPptx(slides: Array<{ text: string; embedImage?: Buffer }>): Promise<Buffer> {
  const zip = new JSZip();

  for (const [i, slide] of slides.entries()) {
    const n = i + 1;
    // Each line becomes its own DrawingML paragraph — mirrors real decks,
    // where a line break is a new <a:p>, not a second run in one paragraph.
    const paragraphs = slide.text
      .split('\n')
      .map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`)
      .join('');

    let picture = '';
    let rels =
      `<?xml version="1.0"?><Relationships>` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`;

    if (slide.embedImage) {
      const picXml = `<p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic>`;
      picture = picXml;
      rels += `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${n}.png"/>`;
      zip.file(`ppt/media/image${n}.png`, slide.embedImage);
    }
    rels += `</Relationships>`;

    const slideXml =
      `<?xml version="1.0"?>` +
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
      `<p:cSld><p:spTree>${picture}<p:sp><p:txBody>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

    zip.file(`ppt/slides/slide${n}.xml`, slideXml);
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, rels);
  }

  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>;
}

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080200000090775' +
    '3de0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082',
  'hex',
);

describe('parsePptxLocally', () => {
  it('extracts slide text as ordered markdown sections', async () => {
    const pptx = await buildSyntheticPptx([{ text: 'Title Slide' }, { text: 'Second Slide\nBullet point' }]);
    const result = await parsePptxLocally(pptx);

    expect(result.slideCount).toBe(2);
    expect(result.text).toContain('### Slide 1');
    expect(result.text).toContain('Title Slide');
    expect(result.text).toContain('### Slide 2');
    expect(result.text.indexOf('### Slide 1')).toBeLessThan(result.text.indexOf('### Slide 2'));
    expect(result.text).toContain('Second Slide\nBullet point');
  });

  it('orders slides numerically (slide10 after slide9, not lexically)', async () => {
    const pptx = await buildSyntheticPptx(Array.from({ length: 11 }, (_, i) => ({ text: `Slide number ${i + 1}` })));
    const result = await parsePptxLocally(pptx);
    expect(result.slideCount).toBe(11);
    expect(result.text.indexOf('Slide number 11')).toBeGreaterThan(result.text.indexOf('Slide number 10'));
    expect(result.text.indexOf('Slide number 10')).toBeGreaterThan(result.text.indexOf('Slide number 9'));
  });

  it('decodes XML entities inside text runs', async () => {
    const pptx = await buildSyntheticPptx([{ text: 'A &amp; B &lt;tag&gt; Caf&#233;' }]);
    const result = await parsePptxLocally(pptx);
    expect(result.text).toContain('A & B <tag> Café');
  });

  it('returns empty text for an image-only deck (no text runs)', async () => {
    const pptx = await buildSyntheticPptx([{ text: '', embedImage: TINY_PNG }]);
    const result = await parsePptxLocally(pptx);
    expect(result.slideCount).toBe(1);
    expect(result.text).toBe('');
  });
});

describe('extractSlideImagesFromPptx', () => {
  it('resolves slide pictures through their .rels in slide order', async () => {
    const pngA = Buffer.concat([TINY_PNG, Buffer.from('A')]);
    const pngB = Buffer.concat([TINY_PNG, Buffer.from('B')]);
    const pptx = await buildSyntheticPptx([
      { text: 'first', embedImage: pngA },
      { text: 'second', embedImage: pngB },
    ]);
    const images = await extractSlideImagesFromPptx(pptx);
    expect(images).toHaveLength(2);
    expect(images[0].equals(pngA)).toBe(true);
    expect(images[1].equals(pngB)).toBe(true);
  });

  it('returns an empty list when slides reference no media', async () => {
    const pptx = await buildSyntheticPptx([{ text: 'text only' }]);
    const images = await extractSlideImagesFromPptx(pptx);
    expect(images).toHaveLength(0);
  });
});
