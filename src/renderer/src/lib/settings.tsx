import { createContext, useContext, type ReactNode } from 'react';
import type { Person, Settings } from '../../../shared/types';
import { api } from '../api';

interface SettingsContextValue {
  settings: Settings;
  me?: Person;
  update: (patch: Partial<Settings>) => Promise<Settings>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ settings, me, children }: { settings: Settings; me?: Person; children: ReactNode }) {
  const value: SettingsContextValue = { settings, me, update: (patch) => api.saveSettings(patch) };
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('SettingsProvider missing');
  return value;
}

export function dndActive(settings: Settings, now = Date.now()): boolean {
  return Boolean(settings.dndUntil) && (settings.dndUntil === 'forever' || Date.parse(settings.dndUntil) > now);
}

export function dndLabel(settings: Settings): string {
  if (settings.dndUntil === 'forever') return 'Paused until you resume';
  const until = new Date(settings.dndUntil);
  const sameDay = until.toDateString() === new Date().toDateString();
  const time = until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `Paused until ${sameDay ? time : `${until.toLocaleDateString([], { weekday: 'short' })} ${time}`}`;
}

export function pauseUntil(kind: '1h' | '3h' | 'tomorrow' | 'forever'): string {
  if (kind === 'forever') return 'forever';
  const now = new Date();
  if (kind === '1h') return new Date(now.getTime() + 3600_000).toISOString();
  if (kind === '3h') return new Date(now.getTime() + 3 * 3600_000).toISOString();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0);
  return tomorrow.toISOString();
}

export function senderDomain(email: string): string {
  return (email.split('@')[1] ?? '').toLowerCase();
}

export function toggleEntry(list: string[], entry: string, on: boolean): string[] {
  const value = entry.trim().toLowerCase();
  const without = list.filter((item) => item.trim().toLowerCase() !== value);
  return on ? [...without, value] : without;
}
