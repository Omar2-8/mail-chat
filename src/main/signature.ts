import { nativeImage } from 'electron';
import { readdir, readFile, stat } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import type { OutlookSignature, PickedImage, Settings } from '../shared/types';
import { hasSignature, signatureHtml } from '../shared/signature';

export { hasSignature };

export interface InlineImage {
  contentId: string;
  name: string;
  contentType: string;
  bytes: Buffer;
}

export interface BuiltSignature {
  html: string;
  images: InlineImage[];
}

const MAX_IMAGE_BYTES = 1_500_000;
const DATA_IMAGE = /(src\s*=\s*)(["'])data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)\2/gi;

export function buildSignature(settings: Settings): BuiltSignature {
  if (!hasSignature(settings)) return { html: '', images: [] };
  const images: InlineImage[] = [];
  const html = signatureHtml(settings);
  const withCids = html.replace(DATA_IMAGE, (_match, prefix: string, quote: string, contentType: string, data: string) => {
    const index = images.length;
    const extension = contentType.split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'png';
    const contentId = `mailchat-sig-${index}@mailchat.local`;
    images.push({ contentId, name: `signature-${index + 1}.${extension}`, contentType, bytes: Buffer.from(data.replace(/\s+/g, ''), 'base64') });
    return `${prefix}${quote}cid:${contentId}${quote}`;
  });
  return { html: `<div class="mailchat-signature">${withCids}</div>`, images };
}

function imageSize(dataUrl: string): { width: number; height: number } | undefined {
  try {
    const size = nativeImage.createFromDataURL(dataUrl).getSize();
    return size.width > 0 && size.height > 0 ? size : undefined;
  } catch {
    return undefined;
  }
}

export async function readImage(path: string): Promise<PickedImage> {
  const info = await stat(path);
  if (info.size > MAX_IMAGE_BYTES) throw new Error('That image is over 1.5 MB. Pick a smaller logo (under 200 KB is ideal for email).');
  const bytes = await readFile(path);
  const contentType = imageType(path, bytes);
  if (!contentType) throw new Error('Use a PNG, JPG or GIF image.');
  const dataUrl = `data:${contentType};base64,${bytes.toString('base64')}`;
  const size = imageSize(dataUrl) ?? { width: 0, height: 0 };
  return { dataUrl, width: size.width, height: size.height, bytes: bytes.length };
}

function imageType(path: string, bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (/\.png$/i.test(path)) return 'image/png';
  return undefined;
}

function signaturesDir(): string {
  return join(process.env.APPDATA ?? '', 'Microsoft', 'Signatures');
}

export async function listOutlookSignatures(): Promise<OutlookSignature[]> {
  const dir = signaturesDir();
  const names = await readdir(dir).catch(() => [] as string[]);
  const result: OutlookSignature[] = [];
  for (const file of names.filter((name) => /\.html?$/i.test(name))) {
    const info = await stat(join(dir, file)).catch(() => undefined);
    if (info?.isFile()) result.push({ name: file.replace(/\.html?$/i, ''), modified: info.mtime.toISOString() });
  }
  return result.sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
}

export async function readOutlookSignature(name: string): Promise<string> {
  const dir = signaturesDir();
  const names = await readdir(dir);
  const file = names.find((entry) => entry.replace(/\.html?$/i, '') === name && /\.html?$/i.test(entry));
  if (!file) throw new Error(`Signature "${name}" not found.`);
  const path = join(dir, file);
  const html = decodeHtml(await readFile(path));
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  return inlineLocalImages(body, dirname(path));
}

function decodeHtml(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  const head = bytes.subarray(0, 4096).toString('latin1');
  const charset = /charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(head)?.[1]?.toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

async function inlineLocalImages(html: string, baseDir: string): Promise<string> {
  const pattern = /(src\s*=\s*)(["'])(?!data:|https?:|cid:)([^"']+)\2/gi;
  const replacements = new Map<string, string>();
  for (const match of html.matchAll(pattern)) {
    const relative = decodeURIComponent(match[3]);
    const target = resolve(baseDir, relative);
    if (!target.startsWith(resolve(baseDir)) || replacements.has(match[3])) continue;
    const image = await readImage(target).catch(() => undefined);
    if (image) replacements.set(match[3], image.dataUrl);
  }
  return html.replace(pattern, (whole, prefix: string, quote: string, src: string) => {
    const data = replacements.get(src);
    return data ? `${prefix}${quote}${data}${quote}` : whole;
  });
}
