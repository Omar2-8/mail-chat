const SUBJECT_PREFIX = /^\s*(?:(?:re|fw|fwd|aw|wg|tr|sv|vs|rv|enc|antw|odp|رد|ر|إعادة توجيه|توجيه|إعادة إرسال)\s*(?:\[\d+\])?\s*[:：]\s*)+/i;
const EXTERNAL_TAG = /^\s*\[(?:external|ext)\]\s*/i;

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•'
};

export function normalizeSubject(subject: string | null | undefined): string {
  let value = (subject ?? '').trim();
  for (let i = 0; i < 6; i++) {
    const next = value.replace(EXTERNAL_TAG, '').replace(SUBJECT_PREFIX, '').trim();
    if (next === value) break;
    value = next;
  }
  return value || '(no subject)';
}

export function isForwardSubject(subject: string | null | undefined): boolean {
  return /^\s*(?:\[(?:external|ext)\]\s*)?(?:fw|fwd|wg|tr|توجيه|إعادة توجيه)\s*[:：]/i.test(subject ?? '');
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function htmlToText(html: string): string {
  const text = html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, ' | ')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function collapse(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export { escapeHtml, textToHtml } from '../shared/signature';
