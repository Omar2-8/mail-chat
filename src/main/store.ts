import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { ReplyMode, Settings, SignatureLayout, SignatureMode } from '../shared/types';
import { isThemeName } from '../shared/themes';

export const DEFAULT_SETTINGS: Settings = {
  historyDays: 30,
  signature: '',
  signatureMode: 'simple',
  signatureHtml: '',
  signatureSource: '',
  signatureLogo: '',
  signatureLogoHeight: 48,
  signatureLogoRatio: 1,
  signatureLogoLink: '',
  signatureLayout: 'below',
  notifications: true,
  dndUntil: '',
  quietHours: false,
  quietFrom: '19:00',
  quietTo: '08:00',
  quietDays: [],
  silenceOther: true,
  silenceFyi: false,
  silenceExternal: false,
  silenceMeetings: false,
  silenceAutomated: false,
  mutedSenders: [],
  mutedKeywords: [],
  vipSenders: [],
  startWithWindows: false,
  closeToTray: true,
  aiEnabled: true,
  aiModel: 'haiku',
  claudePath: '',
  theme: 'system',
  defaultReplyMode: 'all',
  chatTrim: true
};

export function cleanList(list: unknown, lower = true): string[] {
  if (!Array.isArray(list)) return [];
  const values = list.map((item) => String(item).trim()).filter(Boolean).map((item) => (lower ? item.toLowerCase() : item));
  return [...new Set(values)].slice(0, 500);
}

function text(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null || typeof value === 'object') return fallback;
  return String(value);
}

function flag(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'false' || value === '0') return false;
  if (value === 'true' || value === '1') return true;
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function clamped(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function clock(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim()) ? value.trim() : fallback;
}

export function normalizeSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const days = Array.isArray(input.quietDays)
    ? [...new Set(input.quietDays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
    : base.quietDays;
  const ratio = Number(input.signatureLogoRatio);
  return {
    historyDays: clamped(input.historyDays, 3, 365, base.historyDays),
    signature: text(input.signature, base.signature),
    signatureMode: oneOf<SignatureMode>(input.signatureMode, ['none', 'simple', 'html'], base.signatureMode),
    signatureHtml: text(input.signatureHtml, base.signatureHtml),
    signatureSource: text(input.signatureSource, base.signatureSource),
    signatureLogo: text(input.signatureLogo, base.signatureLogo),
    signatureLogoHeight: clamped(input.signatureLogoHeight, 16, 160, base.signatureLogoHeight),
    signatureLogoRatio: Number.isFinite(ratio) && ratio > 0 ? ratio : base.signatureLogoRatio,
    signatureLogoLink: text(input.signatureLogoLink, base.signatureLogoLink),
    signatureLayout: oneOf<SignatureLayout>(input.signatureLayout, ['below', 'left'], base.signatureLayout),
    notifications: flag(input.notifications, base.notifications),
    dndUntil: text(input.dndUntil, base.dndUntil),
    quietHours: flag(input.quietHours, base.quietHours),
    quietFrom: clock(input.quietFrom, base.quietFrom),
    quietTo: clock(input.quietTo, base.quietTo),
    quietDays: days,
    silenceOther: flag(input.silenceOther, base.silenceOther),
    silenceFyi: flag(input.silenceFyi, base.silenceFyi),
    silenceExternal: flag(input.silenceExternal, base.silenceExternal),
    silenceMeetings: flag(input.silenceMeetings, base.silenceMeetings),
    silenceAutomated: flag(input.silenceAutomated, base.silenceAutomated),
    mutedSenders: 'mutedSenders' in input ? cleanList(input.mutedSenders) : base.mutedSenders,
    mutedKeywords: 'mutedKeywords' in input ? cleanList(input.mutedKeywords, false) : base.mutedKeywords,
    vipSenders: 'vipSenders' in input ? cleanList(input.vipSenders) : base.vipSenders,
    startWithWindows: flag(input.startWithWindows, base.startWithWindows),
    closeToTray: flag(input.closeToTray, base.closeToTray),
    aiEnabled: flag(input.aiEnabled, base.aiEnabled),
    aiModel: oneOf(input.aiModel, ['haiku', 'sonnet', 'opus'] as const, base.aiModel as 'haiku'),
    claudePath: text(input.claudePath, base.claudePath),
    theme: isThemeName(input.theme) ? input.theme : base.theme,
    defaultReplyMode: oneOf<ReplyMode>(input.defaultReplyMode, ['all', 'sender'], base.defaultReplyMode),
    chatTrim: flag(input.chatTrim, base.chatTrim)
  };
}

export interface GroupPrefs {
  silent: boolean;
}

export interface ThreadPrefs {
  pinned: string[];
  muted: string[];
  archived: Record<string, string>;
  groups: Record<string, GroupPrefs>;
}

export const DEFAULT_PREFS: ThreadPrefs = { pinned: [], muted: [], archived: {}, groups: {} };

export class JsonFile<T extends object> {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly fallback: T,
    private readonly codec?: { encode: (text: string) => Buffer; decode: (data: Buffer) => string },
    private readonly normalize?: (raw: unknown) => T
  ) {}

  async load(): Promise<T> {
    const bytes = await readFile(this.path).catch(() => undefined);
    if (!bytes?.length) return structuredClone(this.fallback);
    try {
      const body = this.codec ? this.codec.decode(bytes) : bytes.toString('utf8');
      const parsed: unknown = JSON.parse(body);
      if (this.normalize) return this.normalize(parsed);
      return { ...structuredClone(this.fallback), ...(parsed as Partial<T>) };
    } catch {
      return structuredClone(this.fallback);
    }
  }

  save(value: T): Promise<void> {
    this.queue = this.queue.then(() => this.write(value)).catch(() => undefined);
    return this.queue;
  }

  private async write(value: T): Promise<void> {
    const text = JSON.stringify(value);
    const data = this.codec ? this.codec.encode(text) : Buffer.from(text, 'utf8');
    const temp = `${this.path}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(temp, data);
    await rename(temp, this.path).catch(async () => {
      await writeFile(this.path, data);
      await rm(temp, { force: true });
    });
  }
}
