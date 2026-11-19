import type { ChatMessage, Person, ReplyMode } from '../../../shared/types';

export function key(person: Person): string {
  return person.email.trim().toLowerCase();
}

export function uniquePeople(people: Person[], exclude: Set<string> = new Set()): Person[] {
  const seen = new Map<string, Person>();
  for (const person of people) {
    const id = key(person);
    if (!id || exclude.has(id) || seen.has(id)) continue;
    seen.set(id, person);
  }
  return [...seen.values()];
}

export interface Recipients {
  to: Person[];
  cc: Person[];
}

export function replyTarget(messages: ChatMessage[], mode: ReplyMode, replyToId?: string): ChatMessage | undefined {
  if (replyToId) {
    const chosen = messages.find((message) => message.id === replyToId);
    if (chosen) return chosen;
  }
  if (mode === 'sender') return [...messages].reverse().find((message) => !message.fromMe) ?? messages[messages.length - 1];
  return messages[messages.length - 1];
}

export function replyRecipients(target: ChatMessage | undefined, mode: ReplyMode, me: Set<string>): Recipients {
  if (!target) return { to: [], cc: [] };
  if (target.fromMe) {
    if (mode === 'sender') return { to: uniquePeople(target.to, me).slice(0, 1), cc: [] };
    return { to: uniquePeople(target.to, me), cc: uniquePeople(target.cc, me) };
  }
  if (mode === 'sender') return { to: [target.from], cc: [] };
  const to = uniquePeople([target.from, ...target.to], me);
  const toKeys = new Set(to.map(key));
  return { to, cc: uniquePeople(target.cc, new Set([...me, ...toKeys])) };
}

export interface MembershipChange {
  actor: Person;
  actorIsMe: boolean;
  added: Person[];
  dropped: Person[];
}

function audience(message: ChatMessage): Map<string, Person> {
  const map = new Map<string, Person>();
  for (const person of [message.from, ...message.to, ...message.cc]) {
    const id = key(person);
    if (id && !map.has(id)) map.set(id, person);
  }
  return map;
}

export function membershipChange(previous: ChatMessage | undefined, current: ChatMessage, me: Set<string>): MembershipChange | undefined {
  if (!previous) return undefined;
  const before = audience(previous);
  const after = audience(current);
  const shared = [...after.keys()].filter((id) => before.has(id) && !me.has(id));
  if (shared.length === 0) return undefined;
  const actor = key(current.from);
  const added = [...after.entries()].filter(([id]) => !before.has(id) && id !== actor).map(([, person]) => person);
  const dropped = [...before.entries()].filter(([id]) => !after.has(id)).map(([, person]) => person);
  if (added.length === 0 && dropped.length === 0) return undefined;
  return { actor: current.from, actorIsMe: current.fromMe, added, dropped };
}

export type Audience = 'direct' | 'cc' | 'only-you' | 'bcc' | 'none';

export function myAudience(message: ChatMessage, me: Set<string>, threadSize: number): Audience {
  if (message.fromMe) return 'none';
  const inTo = message.to.some((person) => me.has(key(person)));
  const inCc = message.cc.some((person) => me.has(key(person)));
  const others = uniquePeople([...message.to, ...message.cc], new Set([...me, key(message.from)]));
  if ((inTo || inCc) && others.length === 0 && threadSize > 2) return 'only-you';
  if (inTo) return 'direct';
  if (inCc) return 'cc';
  return 'bcc';
}
