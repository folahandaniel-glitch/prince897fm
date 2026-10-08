import JSZip from 'jszip';

/**
 * Pulls plain text out of an uploaded Word (.docx), PowerPoint (.pptx) or PDF file. The file type is decided from the content,
 * not the name. Nothing is executed; only text is read.
 */
export const MAX_DOC_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 600_000;

export type DocKind = 'docx' | 'pptx' | 'pdf';

const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

/** WordprocessingML / DrawingML paragraphs to lines of text. */
function xmlToLines(xml: string, para: 'w:p' | 'a:p'): string {
  const end = new RegExp(`</${para}>`, 'g');
  return decode(xml
    .replace(/<w:tab\/>|<a:tab\/>/g, ' ')
    .replace(/<w:br[^>]*\/>|<a:br[^>]*\/>/g, '\n')
    .replace(end, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n');
}

export async function sniffDoc(buf: Buffer): Promise<DocKind | null> {
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    try {
      const zip = await JSZip.loadAsync(buf);
      if (zip.file('word/document.xml')) return 'docx';
      if (Object.keys(zip.files).some((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) return 'pptx';
    } catch { return null; }
  }
  return null;
}

export async function extractText(buf: Buffer): Promise<{ kind: DocKind; text: string }> {
  if (buf.length === 0) throw new Error('The file is empty.');
  if (buf.length > MAX_DOC_BYTES) throw new Error('That file is larger than 5 MB.');
  const kind = await sniffDoc(buf);
  if (!kind) throw new Error('Use a Word (.docx), PowerPoint (.pptx) or PDF file. Older .doc and .ppt files must be saved in the newer format first.');
  let text = '';
  if (kind === 'pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const out = await pdfText(pdf, { mergePages: true });
    text = Array.isArray(out.text) ? out.text.join('\n') : out.text;
  } else {
    const zip = await JSZip.loadAsync(buf);
    const size = (f: any) => Number(f?._data?.uncompressedSize ?? 0);
    if (kind === 'docx') {
      const f = zip.file('word/document.xml')!;
      if (size(f) > 40_000_000) throw new Error('That document is too large to read.');
      text = xmlToLines(await f.async('string'), 'w:p');
    } else {
      const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1])).slice(0, 400);
      const parts: string[] = [];
      for (const n of slides) { const f = zip.file(n)!; if (size(f) > 10_000_000) continue; parts.push(xmlToLines(await f.async('string'), 'a:p')); }
      text = parts.join('\n\n'); // a blank line between slides: each slide is its own block
    }
  }
  text = text.replace(/ /g, ' ').replace(/\r/g, '');
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
  return { kind, text };
}
