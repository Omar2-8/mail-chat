export const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
export const MOD = IS_MAC ? '⌘' : 'Ctrl';
