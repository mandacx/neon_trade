/**
 * Pure text helpers for news articles (no imports, so scripts can load it directly).
 *
 * The news feed returns `content` as the publisher's HTML: paragraphs, links and bold text, but also
 * tables, figures, embedded widgets (`script`, `iframe`) and entity-encoded characters. We never render
 * that HTML. `newsExcerpt` turns it into plain text and cuts it on a sentence boundary, so the client
 * only ever receives text.
 */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…',
};

/** Decodes named and numeric HTML entities (`&#39;`, `&#x2019;`, `&amp;`); unknown ones are left as they are. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g: string) => {
    if (g[0] === '#') {
      const code = g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[g.toLowerCase()] ?? m;
  });
}

/** Blocks removed together with everything inside them: widgets, embeds, tables, figures and captions. */
const DROP_BLOCKS = ['script', 'style', 'iframe', 'figure', 'table', 'noscript', 'svg', 'blockquote'];

/** Paragraph-level text of the HTML: one string per `<p>`/heading/list item, entities decoded, whitespace collapsed. */
export function htmlParagraphs(html: string): string[] {
  let h = html;
  for (const tag of DROP_BLOCKS) h = h.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), ' ');
  // `div` blocks in the feed are ad / screener widgets, not prose; drop them with their contents.
  h = h.replace(/<div\b[\s\S]*?<\/div\s*>/gi, ' ');
  h = h.replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|h[1-6]|li|ul|ol)\s*>/gi, '\n');
  h = h.replace(/<[^>]*>/g, '');
  return decodeEntities(h)
    .split('\n')
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0);
}

const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length;

/** Lines that are credits or boilerplate rather than article text. */
const BOILERPLATE = /^(image:|photo:|see also:|see more:|read next:|also read:|<?\s*chart)/i;

/** A section heading in the flattened text: a few words with no sentence-ending punctuation. */
const isHeadingLike = (p: string) => wordCount(p) <= 12 && !/[.!?:"”’)]$/.test(p);

export interface Excerpt { text: string; words: number; truncated: boolean }

/**
 * Plain-text excerpt of about `target` words, never more than `max`. Whole paragraphs are taken until the
 * target is reached; if the next paragraph would overshoot `max`, it is cut at the last sentence end that
 * keeps the total within `max` (or at `max` words with an ellipsis when it has no sentence end).
 * `maxWords` <= 0 returns an empty excerpt (the feature is switched off).
 */
export function newsExcerpt(html: string, target: number, max: number): Excerpt {
  if (!html || max <= 0) return { text: '', words: 0, truncated: false };
  const paras = htmlParagraphs(html).filter(p => !BOILERPLATE.test(p));
  const out: string[] = [];
  let words = 0;
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const w = wordCount(p);
    if (words + w <= max) {
      out.push(p);
      words += w;
      if (words >= target) {
        // Don't end on a section heading (short, no closing punctuation): it would dangle above the cut.
        while (out.length > 1 && isHeadingLike(out[out.length - 1])) words -= wordCount(out.pop() as string);
        return { text: out.join('\n\n'), words, truncated: i < paras.length - 1 || out.length < i + 1 };
      }
      continue;
    }
    // Overshoots `max`: keep whole sentences that fit.
    const room = max - words;
    const sentences = p.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [p];
    let part = '';
    for (const s of sentences) {
      const next = part + s;
      if (wordCount(next) > room) break;
      part = next;
    }
    part = part.trim();
    if (part && words + wordCount(part) >= Math.min(target, max) * 0.6) {
      out.push(part);
      words += wordCount(part);
    } else if (!out.length) {
      part = p.split(/\s+/).slice(0, room).join(' ');
      out.push(part + '…');
      words += room;
    }
    return { text: out.join('\n\n'), words, truncated: true };
  }
  return { text: out.join('\n\n'), words, truncated: false };
}

/** Plain text of a short HTML-ish field (headline, summary). */
export function plainText(s: string | null | undefined): string {
  return s ? decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
}
