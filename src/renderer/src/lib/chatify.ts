const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'CENTER', 'BLOCKQUOTE', 'PRE', 'TABLE']);

const BANNER = /^\s*(?:\[?external\]?[:\s-]*)?(?:caution|warning|attention|external (?:email|sender|message)|notice)\s*[:!-]\s*(?:this|the) (?:e-?mail|message)\b/i;
const BANNER_ANYWHERE = /\b(?:this (?:e-?mail|message) (?:originated|came|was sent) from outside|you don'?t often get email from|some people who received this message don'?t often get email)/i;
const MOBILE = /^(?:sent from (?:my )?(?:outlook|iphone|ipad|android|samsung|galaxy|huawei|mobile|mail for windows|blackberry|phone|yahoo mail)\b.*|get outlook for (?:ios|android)\b.*|sent via .{0,40}|sent with .{0,40}|أرسلت من .{0,40}|مرسل من .{0,40})$/i;
const CLASSIFICATION = /^(?:confidential|internal|public|restricted|general|highly confidential|sensitive|official use only|internal use only|non-business)(?:\s*[-–:|]\s*[\w .&()-]{0,40})?$/i;
const DISCLAIMER = /^(?:disclaimer\b|confidentiality notice|this (?:e-?mail|message|communication)(?: and any (?:files|attachments)(?: transmitted with it)?)? (?:is|are|may|contains|and its)|the information (?:contained|in this)|please consider the environment|this e-?mail has been scanned)/i;
const SIGNOFF = /^(?:regards|best regards|kind regards|warm regards|warmest regards|best wishes|best|many thanks|thanks|thank you|thanks a lot|thanks again|thanks and regards|thanks & regards|thank you & regards|cheers|br|b\.r|sincerely|yours sincerely|yours faithfully|respectfully|with regards|with thanks|appreciated|مع التحية|مع تحياتي|تحياتي|شكرا|شكراً|مع الشكر|مع خالص التحية|مع خالص الشكر|وتفضلوا بقبول فائق الاحترام|تحياتي لكم)\s*[,!.،]*\s*$/i;
const GREETING = /^(?:salam|salaam|assalamu? ?alaikum|hi|hello|hey|hiya|dear|good (?:morning|afternoon|evening|day)|greetings|مرحبا|مرحباً|السلام عليكم|اهلا|أهلا|عزيزي|عزيزتي|صباح الخير|مساء الخير)\b[^.!?\n]{0,48}[,!.،:]?\s*$/i;

function lines(element: Element): string[] {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  clone.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6').forEach((block) => block.append('\n'));
  return (clone.textContent ?? '')
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function textOf(node: Node): string {
  return (node.textContent ?? '').replace(/[\s ​‌‍﻿]+/g, ' ').trim();
}

function leafBlocks(root: Element): Element[] {
  return Array.from(root.querySelectorAll('*')).filter((element) => {
    if (!BLOCK_TAGS.has(element.tagName)) return false;
    if (element.tagName === 'TABLE') return !element.parentElement?.closest('table');
    if (element.closest('table')) return false;
    return !Array.from(element.querySelectorAll('*')).some((child) => BLOCK_TAGS.has(child.tagName));
  });
}

function hasMedia(element: Element): boolean {
  return Boolean(element.querySelector('img, table')) || element.tagName === 'IMG';
}

function removeUpwards(element: Element, root: Element): void {
  let target: Element = element;
  while (target.parentElement && target.parentElement !== root && textOf(target.parentElement) === textOf(target) && !hasMedia(target.parentElement)) {
    target = target.parentElement;
  }
  target.remove();
}

const BANNER_FULL =
  /^\s*(?:\[?external\]?[:\s-]*)?(?:caution|warning|attention|external (?:email|sender|message)|notice)\s*[:!-]\s*(?:this|the) (?:e-?mail|message)[\s\S]{0,400}?(?:report|contact)[^.]{0,160}?@[\w.-]+\.\w+\.?/i;
const BANNER_SENTENCE =
  /^\s*(?:\[?external\]?[:\s-]*)?(?:caution|warning|attention|external (?:email|sender|message)|notice)\s*[:!-]\s*(?:this|the) (?:e-?mail|message)[^.]{0,300}\./i;

function bannerLength(text: string): number {
  return (BANNER_FULL.exec(text) ?? BANNER_SENTENCE.exec(text))?.[0].length ?? text.length;
}

function stripLeadingText(element: Element, count: number): void {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let remaining = count;
  for (const node of nodes) {
    if (remaining <= 0) break;
    const visible = node.data.replace(/[\s ]+/g, ' ').trim();
    if (!visible) continue;
    if (visible.length <= remaining) {
      node.data = '';
      remaining -= visible.length + 1;
      continue;
    }
    const raw = node.data;
    let index = 0;
    let seen = 0;
    while (index < raw.length && /[\s ]/.test(raw[index])) index++;
    while (index < raw.length && seen < remaining) {
      if (/[\s ]/.test(raw[index])) {
        while (index < raw.length && /[\s ]/.test(raw[index])) index++;
      } else {
        index++;
      }
      seen++;
    }
    node.data = raw.slice(index).replace(/^[\s ]+/, '');
    remaining = 0;
  }
}

function removeBanners(root: Element): boolean {
  let removed = false;
  const matches = Array.from(root.querySelectorAll('p, div, table, td, span')).filter((element) => {
    const text = textOf(element);
    return text.length > 0 && (BANNER.test(text) || (BANNER_ANYWHERE.test(text) && text.length < 400));
  });
  const deepest = matches.filter((element) => !matches.some((other) => other !== element && element.contains(other)));
  for (const element of deepest) {
    if (!root.contains(element)) continue;
    const text = textOf(element);
    const span = bannerLength(text);
    if (text.length - span > 30 && BANNER.test(text)) {
      stripLeadingText(element, span);
      removed = true;
      continue;
    }
    let target: Element = element;
    while (target.parentElement && target.parentElement !== root && textOf(target.parentElement).length <= text.length + 12) target = target.parentElement;
    if (target.tagName === 'TD' || target.tagName === 'TR') target = target.closest('table') ?? target;
    target.remove();
    removed = true;
  }
  return removed;
}

function isJunkLine(line: string): boolean {
  return MOBILE.test(line) || CLASSIFICATION.test(line) || DISCLAIMER.test(line);
}

function trimTrailingJunk(root: Element): boolean {
  let removed = false;
  for (let guard = 0; guard < 25; guard++) {
    const blocks = leafBlocks(root);
    const last = blocks[blocks.length - 1];
    if (!last) break;
    const blockLines = lines(last);
    if (blockLines.length === 0 && !hasMedia(last)) {
      removeUpwards(last, root);
      continue;
    }
    if (blockLines.length > 0 && blockLines.every(isJunkLine) && !last.querySelector('img')) {
      removeUpwards(last, root);
      removed = true;
      continue;
    }
    break;
  }
  return removed;
}

function trimSignoff(root: Element): boolean {
  const blocks = leafBlocks(root);
  const window = blocks.slice(-14);
  for (let index = window.length - 1; index >= 0; index--) {
    const block = window[index];
    const blockLines = lines(block);
    if (blockLines.length === 0 || !SIGNOFF.test(blockLines[0])) continue;
    const before = blocks.slice(0, blocks.length - window.length + index);
    const content = before.map(textOf).join(' ').trim();
    if (content.replace(GREETING, '').length < 2 && !before.some(hasMedia)) return false;
    const range = document.createRange();
    range.setStartBefore(block);
    range.setEndAfter(root.lastChild ?? block);
    range.deleteContents();
    return true;
  }
  return false;
}

function trimGreeting(root: Element): boolean {
  const blocks = leafBlocks(root);
  const first = blocks[0];
  if (!first || blocks.length < 2 || hasMedia(first)) return false;
  const firstLines = lines(first);
  if (firstLines.length !== 1 || !GREETING.test(firstLines[0])) return false;
  removeUpwards(first, root);
  return true;
}

function trimLooseLines(root: Element): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  const last = [...texts].reverse().find((node) => textOf(node));
  if (last && isJunkLine(textOf(last)) && last.parentElement && textOf(last.parentElement) !== textOf(root)) {
    const parent = last.parentElement;
    if (parent.tagName === 'A' || parent.tagName === 'SPAN' || parent.tagName === 'B') {
      const block = parent.closest('p, div, li') ?? parent;
      if (lines(block).every(isJunkLine)) block.remove();
    } else {
      last.remove();
    }
  }
}

export function chatify(root: Element): void {
  removeBanners(root);
  trimTrailingJunk(root);
  trimLooseLines(root);
  if (trimSignoff(root)) trimTrailingJunk(root);
  trimGreeting(root);
  trimTrailingJunk(root);
}
