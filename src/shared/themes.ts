import type { ThemeName } from './types';

export const THEME_NAMES: readonly ThemeName[] = ['system', 'light', 'dark', 'midnight', 'ocean', 'forest', 'sunset'];

export const THEME_PALETTES: Record<Exclude<ThemeName, 'system'>, { mode: 'light' | 'dark'; bg: string }> = {
  light: { mode: 'light', bg: '#f4f4f7' },
  dark: { mode: 'dark', bg: '#0f0f14' },
  midnight: { mode: 'dark', bg: '#07080f' },
  ocean: { mode: 'light', bg: '#eef6fa' },
  forest: { mode: 'dark', bg: '#0c130f' },
  sunset: { mode: 'light', bg: '#fdf3ec' }
};

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEME_NAMES as readonly string[]).includes(value);
}

export function themeSource(theme: ThemeName): 'system' | 'light' | 'dark' {
  return theme === 'system' ? 'system' : THEME_PALETTES[theme].mode;
}

export function themeBackground(theme: ThemeName, systemDark: boolean): string {
  if (theme === 'system') return systemDark ? THEME_PALETTES.dark.bg : THEME_PALETTES.light.bg;
  return THEME_PALETTES[theme].bg;
}
