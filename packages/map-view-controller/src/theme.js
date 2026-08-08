/**
 * Theme tokens for the toolbar. Everything is a CSS colour/length string, so a
 * consumer can theme the toolbar to their own product without touching CSS.
 * These defaults are deliberately generic — no brand colours ship in the lib.
 */
export const DEFAULT_THEME = {
  accent: '#E8A820',          // active icon + highlight
  accentContrast: '#0E1535',  // text/icon drawn on top of the accent
  surface: 'rgba(14, 21, 53, 0.72)', // toolbar background
  surfaceHover: 'rgba(255, 255, 255, 0.08)',
  border: 'rgba(255, 255, 255, 0.14)',
  icon: 'rgba(255, 255, 255, 0.74)',
  iconActive: '#0E1535',
  tooltipBg: 'rgba(9, 13, 33, 0.94)',
  tooltipText: 'rgba(255, 255, 255, 0.92)',
  radius: '12px',
  buttonSize: '38px',
  gap: '4px',
  padding: '5px',
  shadow: '0 8px 28px rgba(0, 0, 0, 0.34)',
  backdropFilter: 'blur(10px)',
  fontFamily: 'inherit',
};

export const POSITIONS = {
  'bottom-right': { bottom: '16px', right: '16px' },
  'bottom-left': { bottom: '16px', left: '16px' },
  'top-right': { top: '16px', right: '16px' },
  'top-left': { top: '16px', left: '16px' },
};

export function resolveTheme(theme) {
  return { ...DEFAULT_THEME, ...(theme || {}) };
}
