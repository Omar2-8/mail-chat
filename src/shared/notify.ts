import type { Settings } from './types';

export interface NotifyFacts {
  email: string;
  name: string;
  subject: string;
  preview: string;
  other: boolean;
  addressedToMe: boolean;
  external: boolean;
  meeting: boolean;
}

const AUTOMATED = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?|automated|system|azuredevops|devops|jira|github|calendar-notification)([+._-].*)?$/i;

export function normalizeEntry(entry: string): string {
  return entry.trim().toLowerCase().replace(/^\*?@/, '@');
}

export function matchesSender(list: string[], email: string): boolean {
  const address = email.trim().toLowerCase();
  if (!address) return false;
  const domain = address.split('@')[1] ?? '';
  return list.some((raw) => {
    const entry = normalizeEntry(raw);
    if (!entry) return false;
    if (entry.startsWith('@')) return domain === entry.slice(1) || domain.endsWith(`.${entry.slice(1)}`);
    if (!entry.includes('@')) return domain === entry || domain.endsWith(`.${entry}`);
    return address === entry;
  });
}

export function isAutomated(email: string, name: string): boolean {
  const local = email.split('@')[0] ?? '';
  return AUTOMATED.test(local) || /\b(no-?reply|notifications?|alerts?)\b/i.test(name);
}

export function isVip(settings: Settings, email: string): boolean {
  return matchesSender(settings.vipSenders, email);
}

export function silenceReason(settings: Settings, facts: NotifyFacts): string | undefined {
  if (isVip(settings, facts.email)) return undefined;
  if (matchesSender(settings.mutedSenders, facts.email)) return `You muted ${facts.email.includes('@') ? facts.email : facts.name}`;
  const text = `${facts.subject} ${facts.preview}`.toLowerCase();
  const keyword = settings.mutedKeywords.find((word) => word.trim() && text.includes(word.trim().toLowerCase()));
  if (keyword) return `Contains muted word "${keyword.trim()}"`;
  if (settings.silenceOther && facts.other) return 'Newsletters and bots are silenced';
  if (settings.silenceAutomated && isAutomated(facts.email, facts.name)) return 'Automated senders are silenced';
  if (settings.silenceFyi && !facts.addressedToMe) return "CC'd emails are silenced";
  if (settings.silenceExternal && facts.external) return 'External senders are silenced';
  if (settings.silenceMeetings && facts.meeting) return 'Meeting invites are silenced';
  return undefined;
}

function minutesOf(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

export function pausedReason(settings: Settings, now = new Date()): string | undefined {
  if (!settings.notifications) return 'Notifications are off';
  if (settings.dndUntil && (settings.dndUntil === 'forever' || Date.parse(settings.dndUntil) > now.getTime())) return 'Do not disturb';
  if (settings.quietDays.includes(now.getDay())) return 'Quiet day';
  if (settings.quietHours) {
    const current = now.getHours() * 60 + now.getMinutes();
    const from = minutesOf(settings.quietFrom);
    const to = minutesOf(settings.quietTo);
    const inside = from <= to ? current >= from && current < to : current >= from || current < to;
    if (inside) return 'Quiet hours';
  }
  return undefined;
}
