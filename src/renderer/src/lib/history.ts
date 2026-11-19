import type { ChatMessage, Person, ThreadDetail } from '../../../shared/types';

const FIELD = {
  from: /^(?:from|من|von|de)\s*[:：]\s*(.*)$/i,
  sent: /^(?:sent|date|تاريخ الإرسال|التاريخ|gesendet|envoyé)\s*[:：]\s*(.*)$/i,
  to: /^(?:to|إلى|الى|an|à)\s*[:：]\s*(.*)$/i,
  cc: /^(?:cc|نسخة|نسخة إلى)\s*[:：]\s*(.*)$/i,
  subject: /^(?:subject|الموضوع|betreff|objet)\s*[:：]\s*(.*)$/i
};

interface Header {
  from: Person;
  sentAt?: number;
  to: Person[];
  cc: Person[];
  subject: string;
}

interface Segment {
  header: Header;
  html: string;
}

function headerLines(element: Element): string[] {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  clone.querySelectorAll('p, div').forEach((block) => block.append('\n'));
  return (clone.textContent ?? '')
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parsePerson(raw: string): Person {
  const value = raw.trim().replace(/^["']|["']$/g, '');
  const angle = /^(.*?)\s*[<\[]\s*(?:mailto:)?([^<>\[\]\s]+@[^<>\[\]\s]+)\s*[>\]]$/.exec(value);
  if (angle) {
    const name = angle[1].trim().replace(/^["']|["']$/g, '');
    return { name: name || angle[2], email: angle[2].toLowerCase() };
  }
  if (/^[^\s@]+@[^\s@]+$/.test(value)) return { name: value, email: value.toLowerCase() };
  return { name: value, email: '' };
}

function parsePeople(raw: string): Person[] {
  if (!raw.trim()) return [];
  const parts = raw.includes(';') ? raw.split(';') : raw.split(/(?<=>)\s*,\s*/);
  return parts.map((part) => part.trim()).filter(Boolean).map(parsePerson);
}

function parseDate(raw: string): number | undefined {
  const cleaned = raw
    .replace(/^[A-Za-z]+,\s*/, '')
    .replace(/\s+at\s+/i, ' ')
    .replace(/\s+\([^)]*\)\s*$/, '')
    .trim();
  const time = Date.parse(cleaned);
  return Number.isFinite(time) ? time : undefined;
}

function parseHeader(element: Element): Header | undefined {
  const fields: Partial<Record<keyof typeof FIELD, string>> = {};
  let current: keyof typeof FIELD | undefined;
  for (const line of headerLines(element)) {
    const match = (Object.keys(FIELD) as (keyof typeof FIELD)[]).find((key) => FIELD[key].test(line));
    if (match) {
      current = match;
      fields[match] = FIELD[match].exec(line)![1];
    } else if (current && current !== 'from' && current !== 'sent') {
      fields[current] = `${fields[current] ?? ''} ${line}`;
    }
  }
  if (!fields.from) return undefined;
  return {
    from: parsePerson(fields.from),
    sentAt: fields.sent ? parseDate(fields.sent) : undefined,
    to: parsePeople(fields.to ?? ''),
    cc: parsePeople(fields.cc ?? ''),
    subject: (fields.subject ?? '').trim()
  };
}

function looksLikeHeader(element: Element): boolean {
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  return /^(?:from|من|von|de)\s*[:：]/i.test(text) && /(?:sent|date|تاريخ الإرسال|التاريخ|gesendet|envoyé)\s*[:：]/i.test(text) && text.length < 1500;
}

function findHeaders(body: HTMLElement): Element[] {
  const found: Element[] = [];
  const add = (element: Element | null) => {
    if (!element || found.some((existing) => existing === element || existing.contains(element) || element.contains(existing))) return;
    found.push(element);
  };
  body.querySelectorAll('[id$="divRplyFwdMsg"]').forEach(add);
  body.querySelectorAll('div[style*="border-top"]').forEach((div) => {
    const style = (div.getAttribute('style') ?? '').replace(/\s+/g, '').toLowerCase();
    if ((style.includes('border-top:solid#e1e1e1') || style.includes('border-top:solid#b5c4df') || style.includes('border-top:1ptsolid')) && looksLikeHeader(div)) add(div);
  });
  body.querySelectorAll('p, div').forEach((element) => {
    if (element.querySelector('p, div')) return;
    if (looksLikeHeader(element)) add(element);
  });
  return found.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

function segmentsOf(html: string): Segment[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const headers = findHeaders(doc.body);
  if (headers.length === 0) return [];
  const parsed: Header[] = [];
  headers.forEach((element, index) => {
    const header = parseHeader(element);
    if (!header) return;
    const previous = element.previousElementSibling ?? element.parentElement?.previousElementSibling;
    if (previous?.tagName === 'HR') previous.remove();
    const marker = doc.createElement('span');
    marker.setAttribute('data-mc-split', String(parsed.length));
    element.replaceWith(marker);
    parsed.push(header);
    void index;
  });
  const parts = doc.body.innerHTML.split(/<span data-mc-split="\d+"><\/span>/);
  return parsed.map((header, index) => ({
    header,
    html: (parts[index + 1] ?? '').replace(/<hr[^>]*>\s*$/i, '').trim()
  }));
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/caution:.*?infosec@\S+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function plain(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent ?? '';
}

function sameMessage(segment: Segment, message: ChatMessage): boolean {
  const a = normalize(plain(segment.html));
  const b = normalize(plain(message.html));
  const probeA = a.slice(0, 80);
  const probeB = b.slice(0, 80);
  if (probeA.length >= 20 && probeB.length >= 20 && (b.includes(probeA) || a.includes(probeB))) return true;
  const sameSender =
    (segment.header.from.email && segment.header.from.email === message.from.email.toLowerCase()) ||
    segment.header.from.name.toLowerCase() === message.from.name.toLowerCase();
  const close = segment.header.sentAt !== undefined && Math.abs(segment.header.sentAt - Date.parse(message.sentAt)) < 5 * 60_000;
  return Boolean(sameSender && close);
}

export function withHistory(detail: ThreadDetail, me: Set<string>, meName: string): { messages: ChatMessage[]; added: number } {
  const real = detail.messages;
  if (real.length === 0) return { messages: real, added: 0 };
  const candidates = real.map((message) => ({ message, count: (message.fullHtml.match(/divRplyFwdMsg|border-top:\s*solid\s*#E1E1E1|(?:From|من)\s*:\s*<\/b>/gi) ?? []).length }));
  const source = candidates.reduce((best, item) => (item.count > best.count || (item.count === best.count && Date.parse(item.message.sentAt) > Date.parse(best.message.sentAt)) ? item : best));
  if (source.count === 0) return { messages: real, added: 0 };
  const segments = segmentsOf(source.message.fullHtml);
  const sourceTime = Date.parse(source.message.sentAt);
  const history: ChatMessage[] = [];
  let ceiling = sourceTime;
  segments.forEach((segment, index) => {
    const match = real.find((message) => sameMessage(segment, message));
    if (match) {
      ceiling = Math.min(ceiling, Date.parse(match.sentAt));
      return;
    }
    if (plain(segment.html).trim().length === 0) return;
    const parsed = segment.header.sentAt;
    const time = parsed !== undefined && parsed < ceiling ? parsed : ceiling - 60_000;
    ceiling = time;
    const from = segment.header.from;
    const fromMe = (from.email && me.has(from.email)) || from.name.toLowerCase() === meName.toLowerCase();
    history.push({
      id: `history:${source.message.id}:${index}`,
      threadId: detail.id,
      from,
      fromMe: Boolean(fromMe),
      to: segment.header.to,
      cc: segment.header.cc,
      sentAt: new Date(time).toISOString(),
      isRead: true,
      kind: /^\s*(?:fw|fwd)\s*:/i.test(segment.header.subject) ? 'forward' : 'mail',
      subject: segment.header.subject,
      html: segment.html,
      fullHtml: segment.html,
      preview: plain(segment.html).slice(0, 200),
      hasAttachments: false,
      importance: 'normal',
      historical: true
    });
  });
  const merged = [...history, ...real].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
  return { messages: merged, added: history.length };
}
