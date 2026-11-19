import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { chatify } from './chatify';

const ALLOWED_TAGS = [
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark', 'sub', 'sup', 'small', 'big', 'font',
  'p', 'div', 'span', 'br', 'hr', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'img', 'center'
];
const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'style', 'dir', 'align', 'color', 'width', 'height', 'start'];
const KEPT_STYLES = ['color', 'background-color', 'background', 'font-weight', 'font-style', 'text-decoration', 'text-align'];
const BLOCKS = new Set(['P', 'DIV', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'CENTER']);

const colorCache = new Map<string, [number, number, number] | null>();
let colorContext: CanvasRenderingContext2D | null | undefined;

function parseColor(value: string): [number, number, number] | null {
  const key = value.trim().toLowerCase();
  if (!key || key === 'transparent' || key === 'inherit' || key === 'initial' || key === 'windowtext' || key === 'auto') return null;
  const cached = colorCache.get(key);
  if (cached !== undefined) return cached;
  colorContext ??= document.createElement('canvas').getContext('2d');
  let result: [number, number, number] | null = null;
  if (colorContext) {
    colorContext.fillStyle = '#010203';
    colorContext.fillStyle = key;
    const normalized = String(colorContext.fillStyle);
    if (normalized !== '#010203' || key === '#010203') {
      const hex = /^#([0-9a-f]{6})$/i.exec(normalized);
      const rgba = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/i.exec(normalized);
      if (hex) result = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as [number, number, number];
      else if (rgba && (rgba[4] === undefined || Number(rgba[4]) > 0.1)) result = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
    }
  }
  colorCache.set(key, result);
  return result;
}

function saturation([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function luminance([r, g, b]: [number, number, number]): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function cleanStyle(element: HTMLElement): void {
  const style = element.style;
  const kept: string[] = [];
  const color = parseColor(style.color || element.getAttribute('color') || '');
  const background = parseColor(style.backgroundColor || (style.background && !style.background.includes('url(') ? style.background : ''));
  const hasBackground = background !== null && !(luminance(background) > 0.94 && saturation(background) < 0.08);
  if (hasBackground && background) {
    kept.push(`background-color: rgb(${background.join(',')})`);
    kept.push(`color: ${luminance(background) > 0.55 ? '#111' : '#fff'}`);
    kept.push('border-radius: 3px');
  } else if (color && saturation(color) > 0.35 && luminance(color) > 0.12 && luminance(color) < 0.9) {
    kept.push(`color: rgb(${color.join(',')})`);
  }
  for (const property of KEPT_STYLES.slice(3)) {
    const value = style.getPropertyValue(property);
    if (value && property === 'font-weight' && /^(bold|bolder|[6-9]00)$/.test(value)) kept.push(`font-weight: 700`);
    if (value && property === 'font-style' && value === 'italic') kept.push('font-style: italic');
    if (value && property === 'text-decoration' && /underline|line-through/.test(value)) kept.push(`text-decoration: ${value}`);
    if (value && property === 'text-align' && /^(center|right|left)$/.test(value) && BLOCKS.has(element.tagName)) kept.push(`text-align: ${value}`);
  }
  if (kept.length > 0) element.setAttribute('style', kept.join('; '));
  else element.removeAttribute('style');
  element.removeAttribute('color');
}

function isBlank(element: Element): boolean {
  if (element.querySelector('img, table, hr')) return false;
  return (element.textContent ?? '').replace(/[\s ​‌‍﻿]/g, '') === '';
}

function trimEdges(root: Element): void {
  for (const edge of ['firstElementChild', 'lastElementChild'] as const) {
    let node = root[edge];
    while (node && BLOCKS.has(node.tagName) && isBlank(node)) {
      const next = edge === 'firstElementChild' ? node.nextElementSibling : node.previousElementSibling;
      node.remove();
      node = next;
    }
    if (node && (node.tagName === 'DIV' || node.tagName === 'SPAN') && root.children.length === 1) trimEdges(node);
  }
  while (root.lastChild && root.lastChild.nodeName === 'BR') root.lastChild.remove();
  while (root.firstChild && root.firstChild.nodeName === 'BR') root.firstChild.remove();
}

function collapseBlankRuns(root: Element): void {
  let previousBlank = false;
  for (const element of Array.from(root.querySelectorAll('p, div'))) {
    if (element.children.length > 0 && !isBlank(element)) {
      previousBlank = false;
      continue;
    }
    const blank = isBlank(element);
    if (blank && previousBlank) element.remove();
    else if (blank) element.replaceChildren(document.createElement('br'));
    previousBlank = blank;
  }
}

export interface CleanResult {
  html: string;
  hasCid: boolean;
}

export function cleanEmailHtml(input: string, inlineImages: Record<string, string> = {}, options: { trim?: boolean } = {}): CleanResult {
  let hasCid = false;
  const fragment = DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|data:image\/|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    RETURN_DOM_FRAGMENT: true
  }) as DocumentFragment;
  const root = document.createElement('div');
  root.append(fragment);
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (element.hasAttribute('style') || element.hasAttribute('color')) cleanStyle(element);
    if (element.tagName === 'A') {
      const href = element.getAttribute('href') ?? '';
      if (!/^(https?:|mailto:|tel:)/i.test(href)) element.removeAttribute('href');
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
      if (href) element.setAttribute('title', href);
    }
    if (element.tagName === 'IMG') {
      const src = element.getAttribute('src') ?? '';
      const width = Number(element.getAttribute('width') || 0);
      const height = Number(element.getAttribute('height') || 0);
      if ((width > 0 && width <= 2) || (height > 0 && height <= 2)) {
        element.remove();
        continue;
      }
      if (/^cid:/i.test(src)) {
        hasCid = true;
        const id = src.slice(4).replace(/^<|>$/g, '');
        const resolved = inlineImages[id] ?? inlineImages[`name:${id.split('@')[0]}`];
        if (resolved) element.setAttribute('src', resolved);
        else element.classList.add('img-pending');
      }
      element.setAttribute('loading', 'lazy');
      element.setAttribute('referrerpolicy', 'no-referrer');
      element.removeAttribute('height');
      if (width > 0) element.setAttribute('style', `max-width: min(100%, ${width}px)`);
      element.removeAttribute('width');
    }
    if (element.tagName === 'TABLE') {
      element.removeAttribute('width');
      if (!element.parentElement?.classList.contains('table-scroll')) {
        const wrap = document.createElement('div');
        wrap.className = 'table-scroll';
        element.replaceWith(wrap);
        wrap.append(element);
      }
    }
    if (element.tagName === 'TD' || element.tagName === 'TH' || element.tagName === 'COL') {
      element.removeAttribute('width');
      element.removeAttribute('height');
    }
  }
  if (options.trim) chatify(root);
  collapseBlankRuns(root);
  trimEdges(root);
  return { html: root.innerHTML, hasCid };
}

export function markdownToHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['p', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'code', 'a', 'h3', 'h4'], ALLOWED_ATTR: ['href'] });
}

export function plainText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = DOMPurify.sanitize(html);
  return (div.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function sanitizeSignature(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS, 'tbody', 'img'],
    ALLOWED_ATTR: [...ALLOWED_ATTR, 'cellpadding', 'cellspacing', 'border', 'valign', 'bgcolor', 'target'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|data:image\/(?:png|jpeg|jpg|gif);base64,|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
  });
  return clean.replace(/\s*data-[a-z-]+="[^"]*"/gi, '').trim();
}
